-- Likes anónimos del feed de videos (fase 2, nivel C). Ficha: agile/cambios/likes-del-feed.md · ADR 0031 (enmienda).
--
-- Aditiva: una tabla sin permisos para la API, una columna pública (`like_count`), un trigger, la función de escritura pública
-- `set_video_like` y la bandera `likes_enabled` en `resolve_table_qr`. No toca datos existentes.
-- Las sentencias van en una transacción explícita porque el CLI las ejecuta una por una.
--
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos, en UNA transacción (los likes ya dados se pierden):
--   1. volver a aplicar `public.resolve_table_qr` con la definición de 20261023100000_desactivar_sucursales.sql;
--   2. drop function public.set_video_like(text, uuid, boolean, text, text, timestamptz);
--   3. drop table public.video_likes;  (borra el trigger y su función con ella: `drop function private.sync_video_like_count();`)
--   4. revoke select (like_count) on public.menu_videos from anon;  alter table public.menu_videos drop column like_count;
--
-- Reglas de fondo:
--  * La única puerta de escritura es `set_video_like`. `video_likes` tiene RLS activada, sin políticas, y ningún permiso para
--    `anon` ni `authenticated`: ni leer las claves ni escribir.
--  * Un like es (video, `device_key`): a lo sumo uno por dispositivo y video (clave primaria). `device_key` y `rate_key` los arma
--    el servidor (HMAC de un código aleatorio del navegador y de la IP, con prefijos distintos); la base solo valida el formato.
--  * `like_count` lo mantiene un trigger: siempre igual a las filas del video. `anon` lo lee; nadie lo escribe por la API.
--  * `rate_key` (de la IP) se borra pasada 1 hora, de forma oportunista en cada alta (ver `set_video_like`).
--  * Se acepta o rechaza en vivo, sin caché: mesa y sucursal activas, organización activa, `has_feature(video_feed)` y
--    `org_can_write` (en solo lectura se apagan los likes), y el video publicado y listo de esa organización.

begin;

alter table public.menu_videos
  add column like_count integer not null default 0 check (like_count >= 0);
comment on column public.menu_videos.like_count is
  'Likes del video: lo mantiene el trigger de video_likes (nunca se escribe a mano). Es público en el feed.';

grant select (like_count) on table public.menu_videos to anon;

create table public.video_likes (
  video_id uuid not null,
  organization_id uuid not null,
  device_key text not null check (device_key ~ '^[0-9a-f]{32}$'),
  rate_key text check (rate_key is null or rate_key ~ '^[0-9a-f]{32}$'),
  created_at timestamptz not null default now(),
  primary key (video_id, device_key),
  foreign key (video_id, organization_id)
    references public.menu_videos (id, organization_id) on delete cascade
);
comment on table public.video_likes is
  'Likes anónimos del feed (ADR 0031). Sin permisos para la API: solo set_video_like escribe. device_key y rate_key son HMAC armados por el servidor; no hay mesa, sucursal ni IP.';

-- Límite por cliente (últimas altas de un rate_key) y limpieza de los rate_key vencidos.
create index video_likes_rate_idx on public.video_likes (rate_key, created_at) where rate_key is not null;
create index video_likes_rate_cleanup_idx on public.video_likes (created_at) where rate_key is not null;

alter table public.video_likes enable row level security;
revoke all on table public.video_likes from anon, authenticated;

-- ---------------------------------------------------------------------------
-- like_count = filas de video_likes
-- ---------------------------------------------------------------------------

create function private.sync_video_like_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.menu_videos set like_count = like_count + 1 where id = new.video_id;
  else
    -- Si el video se está borrando (cascada), su fila ya no existe y esto no hace nada.
    update public.menu_videos set like_count = greatest(like_count - 1, 0) where id = old.video_id;
  end if;
  return null;
end;
$$;

create trigger video_likes_sync_count
  after insert or delete on public.video_likes
  for each row execute function private.sync_video_like_count();

revoke all on function private.sync_video_like_count() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Escritura pública
-- ---------------------------------------------------------------------------

create function public.set_video_like(
  p_token text,
  p_video uuid,
  p_liked boolean,
  p_device text,
  p_rate text default null,
  p_visit_started_at timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_table record;
  v_branch_active boolean;
  v_visit timestamptz;
  v_rate text;
  v_count integer;
  v_oldest timestamptz;
  v_retry integer;
  v_total integer;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$'
     or p_video is null or p_liked is null
     or p_device is null or p_device !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('status', 'not_found');
  end if;

  select t.id, t.organization_id, t.branch_id, t.is_active
    into v_table
  from public.tables t
  join public.organizations o on o.id = t.organization_id
  where t.qr_token = p_token
    and o.is_active;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- La sucursal se lee con FOR SHARE: una desactivación en curso (que necesita el bloqueo exclusivo de la fila) espera a que este
  -- pedido termine, o ya fue confirmada y se ve acá.
  select b.is_active into v_branch_active
  from public.branches b
  where b.id = v_table.branch_id
  for share;

  if not v_table.is_active
     or not coalesce(v_branch_active, false)
     or not private.has_feature(v_table.organization_id, 'video_feed')
     or not private.org_can_write(v_table.organization_id) then
    return jsonb_build_object('status', 'unavailable');
  end if;

  -- Solo un video publicado y listo de la organización de la mesa. Cualquier otro caso es «no disponible», sin distinguir cuál.
  if not exists (
    select 1 from public.menu_videos v
    where v.id = p_video
      and v.organization_id = v_table.organization_id
      and v.status = 'published'
      and v.mux_status = 'ready'
  ) then
    return jsonb_build_object('status', 'unavailable');
  end if;

  -- Verosímil = de las últimas 24 horas y no del futuro; si no, NULL (mismo criterio que create_waiter_call).
  v_visit := case
    when p_visit_started_at >= now() - interval '24 hours' and p_visit_started_at <= now() + interval '1 minute'
      then p_visit_started_at
  end;

  -- Sesión cerrada: el personal atendió «Pedir la cuenta» de esta mesa después de emitido el ticket y pasaron más de 10 minutos.
  if v_visit is not null and exists (
    select 1 from public.waiter_calls
    where table_id = v_table.id
      and kind = 'bill'
      and status = 'attended'
      and attended_at >= v_visit + interval '1 second'
      and attended_at <= now() - interval '10 minutes'
  ) then
    return jsonb_build_object('status', 'session_closed');
  end if;

  if not p_liked then
    delete from public.video_likes where video_id = p_video and device_key = p_device;
    select like_count into v_total from public.menu_videos where id = p_video;
    return jsonb_build_object('status', 'ok', 'liked', false, 'count', coalesce(v_total, 0));
  end if;

  -- Ya estaba: no consume el límite ni cambia nada.
  if exists (select 1 from public.video_likes where video_id = p_video and device_key = p_device) then
    select like_count into v_total from public.menu_videos where id = p_video;
    return jsonb_build_object('status', 'ok', 'liked', true, 'count', coalesce(v_total, 0));
  end if;

  -- Los rate_key de más de una hora ya no sirven (el límite mira 10 minutos): se borran de a pocos, sin esperar ni competir.
  update public.video_likes l
  set rate_key = null
  where (l.video_id, l.device_key) in (
    select o.video_id, o.device_key
    from public.video_likes o
    where o.rate_key is not null
      and o.created_at < now() - interval '1 hour'
    order by o.created_at
    limit 500
    for update skip locked
  );

  -- Límite por cliente. Un valor ausente o con otro formato no se cuenta. El lock serializa las altas del mismo cliente: sin él,
  -- dos pedidos simultáneos leerían el mismo conteo y pasarían ambos.
  v_rate := case when p_rate ~ '^[0-9a-f]{32}$' then p_rate end;
  if v_rate is not null then
    perform pg_advisory_xact_lock(hashtextextended('video_like_rate:' || v_rate, 0));

    select count(*), min(created_at) into v_count, v_oldest
    from public.video_likes
    where rate_key = v_rate
      and created_at > now() - interval '10 minutes';

    if v_count >= 60 then
      v_retry := greatest(1, ceil(extract(epoch from (v_oldest + interval '10 minutes' - now())))::integer);
      return jsonb_build_object('status', 'rate_limited', 'retry_after_seconds', v_retry);
    end if;
  end if;

  insert into public.video_likes (video_id, organization_id, device_key, rate_key)
  values (p_video, v_table.organization_id, p_device, v_rate)
  on conflict (video_id, device_key) do nothing;

  select like_count into v_total from public.menu_videos where id = p_video;
  return jsonb_build_object('status', 'ok', 'liked', true, 'count', coalesce(v_total, 0));
end;
$$;
comment on function public.set_video_like(text, uuid, boolean, text, text, timestamptz) is
  'Única puerta de escritura de video_likes (ADR 0031). Público: valida token, mesa y sucursal activas, plan (video_feed), cuenta que escribe, video publicado y listo de la organización, sesión cerrada y límite por cliente. p_liked pone o quita el like (idempotente).';

revoke all on function public.set_video_like(text, uuid, boolean, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.set_video_like(text, uuid, boolean, text, text, timestamptz) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- resolve_table_qr: suma `likes_enabled` (la pantalla no ofrece un botón que va a fallar). Idéntica a la de
-- 20261023100000_desactivar_sucursales.sql salvo esa clave. La verdad sigue estando en set_video_like.
-- ---------------------------------------------------------------------------

create or replace function public.resolve_table_qr(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'org_slug', o.slug,
    'org_name', o.name,
    'branch_slug', b.slug,
    'table_label', t.label,
    'table_active', t.is_active,
    'status', case
      when not private.org_is_published(o.id) then 'suspended'
      when not b.is_active then 'inactive'
      else 'available'
    end,
    'calls_enabled', (
      t.is_active
      and b.is_active
      and (t.muted_until is null or t.muted_until <= now())
      and private.has_feature(o.id, 'waiter_call')
    ),
    'likes_enabled', (
      t.is_active
      and b.is_active
      and private.has_feature(o.id, 'video_feed')
      and private.org_can_write(o.id)
    )
  )
  from public.tables t
  join public.branches b on b.id = t.branch_id
  join public.organizations o on o.id = t.organization_id
  where p_token ~ '^[0-9a-f]{32}$'
    and t.qr_token = p_token
    and o.is_active;
$$;

commit;

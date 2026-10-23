-- Comentarios con aprobación previa en el feed de videos (fase 2, nivel C). Ficha: agile/cambios/comentarios-del-feed.md · ADR 0031 (enmienda).
--
-- Aditiva: una tabla, una columna pública (`comment_count`), tres funciones privadas, dos triggers, la función de escritura pública
-- `submit_video_comment`, la de purga `purge_video_comments` y la bandera `comments_enabled` en `resolve_table_qr`. No toca datos existentes.
-- Las sentencias van en una transacción explícita porque el CLI las ejecuta una por una.
--
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos, en UNA transacción (los comentarios se pierden):
--   1. volver a aplicar `public.resolve_table_qr` con la definición de 20261114100000_likes_del_feed.sql;
--   2. drop function public.submit_video_comment(text, uuid, text, text, text, timestamptz);
--      drop function public.purge_video_comments(interval, interval, integer);
--   3. drop table public.video_comments;  drop function private.sync_video_comment_count(), private.enforce_comment_moderation(),
--      private.video_is_public(uuid);
--   4. revoke select (comment_count) on public.menu_videos from anon;  alter table public.menu_videos drop column comment_count;
--
-- Reglas de fondo:
--  * La única puerta de alta es `submit_video_comment`. `anon` y `authenticated` no insertan ni borran. La fila nace `pending`.
--  * `anon` lee solo comentarios `approved` de un video público (publicado, listo y con el feed vigente) y solo cinco columnas:
--    nunca `rate_key`, nunca el estado de moderación. Dueño y Staff leen todos los de su organización (sin `rate_key`) y solo pueden
--    cambiar `status`, entre `approved` y `rejected`. Aprobar exige `org_can_write`; rechazar o retirar no (sacar contenido ajeno
--    de la carta no se bloquea por mora).
--  * Topes que no dependen del cliente (la función es pública y `p_rate`/`p_visit_started_at` los arma el servidor): 30 comentarios por
--    organización cada 10 minutos y 100 pendientes. Además, 10 por conexión cada 10 minutos cuando hay `p_rate`.
--  * El texto, el alias y el video son inmutables (un trigger lo exige también para service_role). `pending` no se vuelve a alcanzar.
--  * `comment_count` (público) = comentarios `approved` del video, mantenido por trigger; nadie lo escribe por la API.
--  * `rate_key` (de la IP) se pone en NULL pasada 1 hora, de forma oportunista en cada envío.
--  * Retención: `purge_video_comments` borra rechazados (por `moderated_at`) y pendientes (por `created_at`) viejos, nunca aprobados.
--    Solo service_role. No se programa acá (docs/produccion.md).

begin;

alter table public.menu_videos
  add column comment_count integer not null default 0 check (comment_count >= 0);
comment on column public.menu_videos.comment_count is
  'Comentarios aprobados del video: lo mantiene el trigger de video_comments (nunca se escribe a mano). Es público en el feed.';

grant select (comment_count) on table public.menu_videos to anon;

create table public.video_comments (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null,
  organization_id uuid not null,
  body text not null
    check (char_length(body) between 1 and 280 and body = btrim(body) and body !~ '[[:cntrl:]]'),
  alias text
    check (alias is null or (char_length(alias) between 1 and 30 and alias = btrim(alias) and alias !~ '[[:cntrl:]]')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  rate_key text check (rate_key is null or rate_key ~ '^[0-9a-f]{32}$'),
  created_at timestamptz not null default now(),
  moderated_at timestamptz,
  foreign key (video_id, organization_id)
    references public.menu_videos (id, organization_id) on delete cascade,
  -- Pendiente = nunca moderado.
  check ((status = 'pending') = (moderated_at is null))
);
comment on table public.video_comments is
  'Comentarios del feed con aprobación previa (ADR 0031). Sin alta por la API: solo submit_video_comment. rate_key es un HMAC de la IP que se borra a la hora; no hay mesa, sucursal ni dispositivo.';

-- Lista de moderación del panel, lectura pública de aprobados, límite por cliente, limpieza de rate_key y purga.
create index video_comments_queue_idx on public.video_comments (organization_id, status, created_at desc);
create index video_comments_public_idx on public.video_comments (video_id, created_at desc, id desc) where status = 'approved';
create index video_comments_rate_idx on public.video_comments (rate_key, created_at) where rate_key is not null;
create index video_comments_rate_cleanup_idx on public.video_comments (created_at) where rate_key is not null;
create index video_comments_purge_pending_idx on public.video_comments (created_at) where status = 'pending';
create index video_comments_purge_rejected_idx on public.video_comments (moderated_at) where status = 'rejected';

alter table public.video_comments enable row level security;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Moderación: solo cambia el estado (y el rate_key lo borra la función de envío); nada vuelve a «pendiente».
create function private.enforce_comment_moderation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id
     or new.video_id <> old.video_id
     or new.organization_id <> old.organization_id
     or new.body <> old.body
     or new.alias is distinct from old.alias
     or new.created_at <> old.created_at then
    raise exception 'comment_immutable' using errcode = '55000',
      hint = 'El texto, el alias y el video de un comentario no se cambian.';
  end if;
  if new.status <> old.status then
    if new.status = 'pending' then
      raise exception 'comment_back_to_pending' using errcode = '55000',
        hint = 'Un comentario moderado no vuelve a pendiente.';
    end if;
    new.moderated_at := now();
  else
    new.moderated_at := old.moderated_at;
  end if;
  return new;
end;
$$;

create trigger video_comments_enforce_moderation
  before update on public.video_comments
  for each row execute function private.enforce_comment_moderation();

-- comment_count = aprobados del video. SECURITY DEFINER: quien modera no tiene permiso de columna sobre `comment_count`.
create function private.sync_video_comment_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'approved' then
      update public.menu_videos set comment_count = comment_count + 1 where id = new.video_id;
    end if;
  elsif tg_op = 'DELETE' then
    -- Si el video se está borrando (cascada), su fila ya no existe y esto no hace nada.
    if old.status = 'approved' then
      update public.menu_videos set comment_count = greatest(comment_count - 1, 0) where id = old.video_id;
    end if;
  elsif new.status is distinct from old.status then
    if new.status = 'approved' then
      update public.menu_videos set comment_count = comment_count + 1 where id = new.video_id;
    elsif old.status = 'approved' then
      update public.menu_videos set comment_count = greatest(comment_count - 1, 0) where id = new.video_id;
    end if;
  end if;
  return null;
end;
$$;

create trigger video_comments_sync_count
  after insert or delete or update of status on public.video_comments
  for each row execute function private.sync_video_comment_count();

revoke all on function private.enforce_comment_moderation(), private.sync_video_comment_count() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Lectura y moderación
-- ---------------------------------------------------------------------------

-- Para la política pública: `has_feature` es interna y `anon` no lee las columnas de estado de `menu_videos`, así que la política
-- consulta este envoltorio, que solo contesta sí o no: ¿el video se ve hoy en el feed?
create function private.video_is_public(p_video uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.menu_videos v
    where v.id = p_video
      and v.status = 'published'
      and v.mux_status = 'ready'
      and private.has_feature(v.organization_id, 'video_feed')
  );
$$;

revoke all on function private.video_is_public(uuid) from public, anon, authenticated;
grant execute on function private.video_is_public(uuid) to anon, authenticated;

create policy "video_comments: lectura pública de aprobados de videos públicos"
  on public.video_comments for select
  to anon, authenticated
  using (status = 'approved' and private.video_is_public(video_id));

create policy "video_comments: lectura de miembros"
  on public.video_comments for select
  to authenticated
  using (private.is_org_member(organization_id));

create policy "video_comments: los miembros moderan; aprobar exige la cuenta al día"
  on public.video_comments for update
  to authenticated
  using (private.is_org_member(organization_id))
  with check (
    private.is_org_member(organization_id)
    and (status = 'rejected' or private.org_can_write(organization_id))
  );

revoke all on table public.video_comments from anon, authenticated;
grant select (id, video_id, body, alias, created_at) on table public.video_comments to anon;
grant select (id, video_id, organization_id, body, alias, status, created_at, moderated_at) on table public.video_comments to authenticated;
grant update (status) on table public.video_comments to authenticated;

-- ---------------------------------------------------------------------------
-- Escritura pública
-- ---------------------------------------------------------------------------

create function public.submit_video_comment(
  p_token text,
  p_video uuid,
  p_body text,
  p_alias text default null,
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
  v_body text;
  v_alias text;
  v_rate text;
  v_count integer;
  v_oldest timestamptz;
  v_retry integer;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' or p_video is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  select t.id, t.organization_id, t.branch_id, t.is_active
    into v_table
  from public.tables t
  join public.organizations o on o.id = t.organization_id
  where t.qr_token = p_token
    and o.is_active
  for share of t;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- La mesa (arriba, `FOR SHARE OF t`) y la sucursal se leen con FOR SHARE: una desactivación en curso espera a que este pedido
  -- termine, o ya fue confirmada y se ve acá. Sin esto, un envío que espera un lock insertaría con el estado de antes.
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

  -- Verosímil = de las últimas 24 horas y no del futuro; si no, NULL (mismo criterio que create_waiter_call y set_video_like).
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

  -- Texto: la base no recorta ni arregla nada; lo que no cumple el formato no se guarda.
  v_body := btrim(coalesce(p_body, ''));
  v_alias := nullif(btrim(coalesce(p_alias, '')), '');
  if char_length(v_body) not between 1 and 280
     or v_body ~ '[[:cntrl:]]'
     or (v_alias is not null and (char_length(v_alias) > 30 or v_alias ~ '[[:cntrl:]]')) then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- El lock por conexión serializa los envíos del mismo cliente: sin él, dos pedidos simultáneos leerían el mismo conteo y pasarían
  -- ambos. Un valor ausente o con otro formato no se cuenta (no hay lock, límite ni deduplicación).
  v_rate := case when p_rate ~ '^[0-9a-f]{32}$' then p_rate end;
  if v_rate is not null then
    perform pg_advisory_xact_lock(hashtextextended('video_comment_rate:' || v_rate, 0));

    -- Reenvío idéntico (doble toque, reintento tras un corte): ya estaba. Se mira DESPUÉS del lock, para que el segundo de dos
    -- pedidos simultáneos vea la fila que acaba de crear el primero.
    if exists (
      select 1 from public.video_comments
      where rate_key = v_rate
        and video_id = p_video
        and body = v_body
        and alias is not distinct from v_alias
        and created_at > now() - interval '10 minutes'
    ) then
      return jsonb_build_object('status', 'ok');
    end if;
  end if;

  -- Los rate_key de más de una hora ya no sirven (el límite mira 10 minutos): se borran de a pocos, sin esperar ni competir.
  update public.video_comments c
  set rate_key = null
  where c.id in (
    select o.id
    from public.video_comments o
    where o.rate_key is not null
      and o.created_at < now() - interval '1 hour'
    order by o.created_at
    limit 500
    for update skip locked
  );

  if v_rate is not null then
    select count(*), min(created_at) into v_count, v_oldest
    from public.video_comments
    where rate_key = v_rate
      and created_at > now() - interval '10 minutes';

    if v_count >= 10 then
      v_retry := greatest(1, ceil(extract(epoch from (v_oldest + interval '10 minutes' - now())))::integer);
      return jsonb_build_object('status', 'rate_limited', 'retry_after_seconds', v_retry);
    end if;
  end if;

  -- Topes por organización: no dependen de nada que mande el cliente. `p_rate` y `p_visit_started_at` los arma la acción de servidor
  -- (la base no puede verificar la IP ni la firma del ticket): quien llama a la función directamente con la clave pública puede
  -- omitirlos o inventarlos. Estos dos topes acotan ese caso: nada se publica sin aprobación, y lo que puede acumular son 30
  -- comentarios cada 10 minutos y 100 pendientes. El lock evita pasarse con dos altas simultáneas (siempre se toma después del lock
  -- por conexión: mismo orden en todos los pedidos).
  perform pg_advisory_xact_lock(hashtextextended('video_comment_queue:' || v_table.organization_id::text, 0));

  select count(*), min(created_at) into v_count, v_oldest
  from public.video_comments
  where organization_id = v_table.organization_id
    and created_at > now() - interval '10 minutes';
  if v_count >= 30 then
    v_retry := greatest(1, ceil(extract(epoch from (v_oldest + interval '10 minutes' - now())))::integer);
    return jsonb_build_object('status', 'rate_limited', 'retry_after_seconds', v_retry);
  end if;

  if (select count(*) from public.video_comments where organization_id = v_table.organization_id and status = 'pending') >= 100 then
    return jsonb_build_object('status', 'queue_full');
  end if;

  insert into public.video_comments (video_id, organization_id, body, alias, rate_key)
  values (p_video, v_table.organization_id, v_body, v_alias, v_rate);

  return jsonb_build_object('status', 'ok');
end;
$$;
comment on function public.submit_video_comment(text, uuid, text, text, text, timestamptz) is
  'Única puerta de alta de video_comments (ADR 0031). Público: valida token, mesa y sucursal activas, plan (video_feed), cuenta que escribe, video publicado y listo de la organización, sesión cerrada, formato, límite por cliente y tope de pendientes. El comentario nace pendiente.';

revoke all on function public.submit_video_comment(text, uuid, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.submit_video_comment(text, uuid, text, text, text, timestamptz) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Purga (retención)
-- ---------------------------------------------------------------------------

create function public.purge_video_comments(
  p_rejected_retention interval default interval '7 days',
  p_pending_retention interval default interval '30 days',
  p_batch integer default 5000
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cutoff_rejected timestamptz;
  v_cutoff_pending timestamptz;
  v_deleted integer;
begin
  if p_rejected_retention is null or p_pending_retention is null then
    raise exception 'invalid_retention' using errcode = '22023';
  end if;
  begin
    v_cutoff_rejected := now() - p_rejected_retention;
    v_cutoff_pending := now() - p_pending_retention;
  exception when datetime_field_overflow then
    raise exception 'invalid_retention' using errcode = '22023';
  end;
  -- Pisos sobre el corte efectivo (no comparando intervalos: un mes se compara como 30 días pero se aplica por calendario):
  -- rechazados, 1 día (hay que dejar tiempo para recuperar un rechazo equivocado); pendientes, 7 días.
  if v_cutoff_rejected > now() - interval '1 day' or v_cutoff_pending > now() - interval '7 days' then
    raise exception 'invalid_retention' using errcode = '22023';
  end if;
  if p_batch is null or p_batch < 1 or p_batch > 50000 then
    raise exception 'invalid_batch' using errcode = '22023';
  end if;

  with viejos as (
    select c.id
    from public.video_comments c
    where (c.status = 'rejected' and c.moderated_at < v_cutoff_rejected)
       or (c.status = 'pending' and c.created_at < v_cutoff_pending)
    order by c.created_at
    limit p_batch
    for update skip locked
  )
  delete from public.video_comments c
  using viejos v
  where c.id = v.id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
comment on function public.purge_video_comments(interval, interval, integer) is
  'Borra comentarios rechazados con más de p_rejected_retention (por defecto 7 días, piso 1) y pendientes con más de p_pending_retention (30 días, piso 7), hasta p_batch por llamada. Nunca borra aprobados. Devuelve cuántos borró. Solo service_role.';

revoke all on function public.purge_video_comments(interval, interval, integer) from public, anon, authenticated;
grant execute on function public.purge_video_comments(interval, interval, integer) to service_role;

-- ---------------------------------------------------------------------------
-- resolve_table_qr: suma `comments_enabled` (la pantalla no ofrece un formulario que va a fallar). Idéntica a la de
-- 20261114100000_likes_del_feed.sql salvo esa clave. La verdad sigue estando en submit_video_comment.
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
    ),
    'comments_enabled', (
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

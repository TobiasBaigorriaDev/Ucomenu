-- Videos del feed (fase 2, nivel C): tabla `menu_videos`, estados, permisos por columna, cupo del plan al publicar y
-- `usage.videos_published` en org_entitlements. Ficha: agile/cambios/videos-del-panel-base.md · ADR 0031.
--
-- Aditiva: una tabla, tres funciones privadas, dos triggers y `org_entitlements` reemplazada (mismo contrato, un dato más).
-- No toca datos. Mux queda fuera: acá solo están las reglas de la base (la subida, el webhook y el borrado del asset son la
-- parte B de la ficha). Las sentencias van en una transacción explícita porque el CLI las ejecuta una por una.
--
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos, en UNA transacción:
--   drop table public.menu_videos;  drop function private.enforce_video_publish(), private.enforce_video_cap(),
--   private.enforce_video_transition(), private.can_create_video(uuid);  y volver a crear `public.org_entitlements` con la definición de
--   20261110100000_catalogo_video_feed.sql. Se pierden los videos cargados (los assets de Mux hay que borrarlos aparte).
--
-- Reglas de fondo:
--  * `status` (draft | published | deleting) lo elige la persona; `mux_status` y los identificadores de Mux, solo el servidor
--    (`service_role`): la persona no tiene permiso de columna sobre ellos. Así nadie apunta su video al playback de otro local.
--  * published => mux_status = ready => asset, playback y duración presentes: CHECK, valen también para service_role.
--  * Crear exige miembro + cuenta que escribe (org_can_write) + has_feature('video_feed'). Actualizar, miembro + org_can_write.
--  * Publicar (pasar a published) exige has_feature('video_feed') y cupo (org_limit 'videos_published'); despublicar no.
--  * `deleting` es terminal: la persona no tiene DELETE; el servidor borra el asset en Mux y después la fila.
--  * Tope técnico de 50 videos por organización (también borradores y los que se están borrando): código 54000.
--  * `anon` no accede a la tabla (la lectura pública llega con el feed). Dueño y Staff no leen los identificadores
--    internos (`mux_asset_id`, `mux_upload_id`).

begin;

create table public.menu_videos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  product_id uuid,
  title text not null
    check (length(btrim(title)) between 1 and 80),
  status text not null default 'draft'
    check (status in ('draft', 'published', 'deleting')),
  mux_status text not null default 'awaiting_upload'
    check (mux_status in ('awaiting_upload', 'processing', 'ready', 'errored')),
  mux_upload_id text unique
    check (length(mux_upload_id) <= 200),
  mux_asset_id text unique
    check (length(mux_asset_id) <= 200),
  mux_playback_id text unique
    check (length(mux_playback_id) <= 200),
  -- 30 s de la regla de producto + 0,5 s de tolerancia por el redondeo con que Mux informa la duración.
  duration_seconds numeric(6, 2)
    check (duration_seconds is null or (duration_seconds > 0 and duration_seconds <= 30.5)),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  -- Si se borra el plato, el video queda sin enlace (no se lleva el video).
  foreign key (product_id, organization_id)
    references public.products (id, organization_id) on delete set null (product_id),
  check (mux_status <> 'ready' or (mux_asset_id is not null and mux_playback_id is not null and duration_seconds is not null)),
  check (status <> 'published' or mux_status = 'ready')
);
comment on table public.menu_videos is
  'Videos cortos del feed de la carta (ADR 0031). status lo elige el local; mux_* y la duración los escribe solo el servidor.';

create index menu_videos_organization_idx on public.menu_videos (organization_id, sort_order, created_at);
create index menu_videos_product_idx on public.menu_videos (product_id);

alter table public.menu_videos enable row level security;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Tope técnico por organización. Corre con el rol que escribe (sin SECURITY DEFINER): un miembro cuenta lo de su
-- organización; a quien no lo es lo frena RLS. El candado evita pasarse del tope con dos altas simultáneas.
create function private.enforce_video_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('cap:menu_videos:' || new.organization_id::text, 0));
  if (select count(*) from public.menu_videos where organization_id = new.organization_id) >= 50 then
    raise exception 'limit_exceeded:videos_per_organization'
      using errcode = '54000', hint = 'Una organización admite hasta 50 videos (con borradores y los que se están borrando).';
  end if;
  return new;
end;
$$;

create trigger menu_videos_enforce_cap
  before insert on public.menu_videos
  for each row execute function private.enforce_video_cap();

-- Transiciones que ningún CHECK expresa: la organización no se mueve y `deleting` no se deshace (tampoco para service_role).
create function private.enforce_video_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id <> old.organization_id then
    raise exception 'video_organization_immutable' using errcode = '42501';
  end if;
  if old.status = 'deleting' and new.status <> 'deleting' then
    raise exception 'video_deleting_is_final' using errcode = '55000',
      hint = 'Un video que se está borrando no vuelve a otro estado.';
  end if;
  return new;
end;
$$;

create trigger menu_videos_enforce_transition
  before update on public.menu_videos
  for each row execute function private.enforce_video_transition();

-- Cupo del plan al PUBLICAR. Se aplica al pasar a `published`, ya sea con un UPDATE o con un INSERT que nace publicado (el
-- servidor también tiene que respetar el tope: ADR 0006); despublicar y editar no se bloquean. Es SECURITY DEFINER
-- para leer el plan y el estado de la cuenta; si el pedido trae un usuario (API) que no es miembro, no cuenta ni informa
-- nada y deja que RLS rechace (mismo criterio que los otros topes, ADR 0006). Sin usuario (servidor) se aplica siempre.
create function private.enforce_video_publish()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_count integer;
begin
  if new.status <> 'published' then
    return new;
  end if;
  -- Ya estaba publicado: editarlo no consume cupo. (En un INSERT no existe `old`: por eso los dos `if` anidados.)
  if tg_op = 'UPDATE' then
    if old.status = 'published' then
      return new;
    end if;
  end if;
  if (select auth.uid()) is not null and not private.is_org_member(new.organization_id) then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('limit:videos_published:' || new.organization_id::text, 0));

  if not private.has_feature(new.organization_id, 'video_feed') then
    raise exception 'feature_unavailable:video_feed'
      using errcode = '42501', hint = 'El plan actual no incluye el feed de videos.';
  end if;

  v_limit := private.org_limit(new.organization_id, 'videos_published');
  if v_limit is null then
    return new;
  end if;

  select count(*) into v_count
  from public.menu_videos
  where organization_id = new.organization_id and status = 'published';

  if v_count >= v_limit then
    raise exception 'limit_exceeded:videos_published'
      using errcode = '53400',
            detail = format('limit=%s published=%s', v_limit, v_count),
            hint = 'Despublicá un video o cambiá de plan.';
  end if;
  return new;
end;
$$;

create trigger menu_videos_enforce_publish
  before insert or update of status on public.menu_videos
  for each row execute function private.enforce_video_publish();

revoke all on function
  private.enforce_video_cap(),
  private.enforce_video_transition(),
  private.enforce_video_publish()
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Políticas (sin lectura pública y sin DELETE)
-- ---------------------------------------------------------------------------

-- Para la política de alta: `has_feature` es interna (sin EXECUTE para authenticated), así que la política consulta este
-- envoltorio, que solo responde sí o no para el usuario de la sesión (miembro + cuenta que escribe + feed en el plan).
create function private.can_create_video(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_org_member(org_id)
    and private.org_can_write(org_id)
    and private.has_feature(org_id, 'video_feed');
$$;

revoke all on function private.can_create_video(uuid) from public, anon, authenticated;
grant execute on function private.can_create_video(uuid) to authenticated;

create policy "menu_videos: lectura de miembros"
  on public.menu_videos for select
  to authenticated
  using (private.is_org_member(organization_id));

create policy "menu_videos: los miembros crean con la cuenta al día y el feed en el plan"
  on public.menu_videos for insert
  to authenticated
  with check (private.can_create_video(organization_id));

create policy "menu_videos: los miembros actualizan con la cuenta al día"
  on public.menu_videos for update
  to authenticated
  using (private.is_org_member(organization_id) and private.org_can_write(organization_id))
  with check (private.is_org_member(organization_id) and private.org_can_write(organization_id));

-- ---------------------------------------------------------------------------
-- Permisos explícitos sobre la Data API (por columna)
-- ---------------------------------------------------------------------------
-- No se concede nada a anon. La persona crea con título, plato y orden y actualiza esos más `status`; mux_status, los
-- identificadores de Mux y la duración quedan solo para service_role (el servidor), que no pasa por estos permisos.

revoke all on table public.menu_videos from anon, authenticated;

grant select (id, organization_id, product_id, title, status, mux_status, mux_playback_id, duration_seconds, sort_order, created_at)
  on table public.menu_videos to authenticated;
grant insert (organization_id, product_id, title, sort_order)
  on table public.menu_videos to authenticated;
grant update (product_id, title, status, sort_order)
  on table public.menu_videos to authenticated;

-- ---------------------------------------------------------------------------
-- org_entitlements: suma `usage.videos_published` (mismo contrato que 20261110100000)
-- ---------------------------------------------------------------------------

create or replace function public.org_entitlements(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_state text;
  v_result jsonb;
  v_sub public.subscriptions%rowtype;
  v_end timestamptz;
begin
  if not private.is_org_member(p_org) then
    return null;
  end if;

  v_state := private.org_state(p_org);

  v_result := jsonb_build_object(
    'state', v_state,
    'can_write', v_state in ('active', 'grace'),
    'features', coalesce(
      (
        select jsonb_agg(f order by f)
        from unnest(array['analytics', 'loyalty', 'menu', 'video_feed', 'waiter_call']) as f
        where private.has_feature(p_org, f)
      ),
      '[]'::jsonb
    ),
    'limits', jsonb_build_object(
      'branches', private.org_limit(p_org, 'branches'),
      'tables_per_branch', private.org_limit(p_org, 'tables_per_branch'),
      'active_products', private.org_limit(p_org, 'active_products'),
      'videos_published', private.org_limit(p_org, 'videos_published')
    ),
    'usage', jsonb_build_object(
      'branches', (select count(*) from public.branches b where b.organization_id = p_org and b.is_active),
      'active_products', (select count(*) from public.products p where p.organization_id = p_org and p.is_active),
      'videos_published', (select count(*) from public.menu_videos v where v.organization_id = p_org and v.status = 'published')
    )
  );

  if private.is_org_owner(p_org) then
    select * into v_sub from public.subscriptions s where s.organization_id = p_org;
    if found then
      v_end := greatest(v_sub.current_period_end, v_sub.trial_ends_at);
      v_result := v_result || jsonb_build_object(
        'plan', v_sub.plan_code,
        'billing_cycle', v_sub.billing_cycle,
        'period_end', v_end,
        'days_late', case when now() <= v_end then 0 else ceil(extract(epoch from (now() - v_end)) / 86400)::integer end,
        'trial_status', private.trial_status(v_sub.trial_ends_at, v_sub.current_period_end, now()),
        'trial_ends_at', v_sub.trial_ends_at,
        'suspended_manually', v_sub.suspended_at is not null
      );
    end if;
  end if;

  return v_result;
end;
$$;
comment on function public.org_entitlements(uuid) is
  'Estado, escritura permitida, features, límites y uso (sucursales activas, platos activos y videos publicados) de la organización. Solo para sus miembros.';

commit;

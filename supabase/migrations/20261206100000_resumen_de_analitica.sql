-- Resumen de la analítica con IA (ficha agile/cambios/resumen-de-analitica-con-ia.md, ADR 0047), sobre 20261205100000 (analítica de pedidos).
--
-- Qué hace:
--  * Tabla `analytics_summaries`: el último resumen generado por período (7, 30 o 90 días) y alcance (toda la organización o una
--    sucursal). Una fila por (organización, sucursal o «todas», período): generar de nuevo la reemplaza.
--  * `save_analytics_summary(p_org, p_user, p_days, p_content, p_provider, p_branch)`: única puerta de escritura, SOLO para el servidor
--    (`service_role`): el contenido es texto de un servicio externo y solo debe guardarse lo que el servidor ya validó; si la
--    ejecutara el Dueño por la API, podría escribir cualquier texto rotulado «generado por IA».
--  * `analytics_summary_claims`, `claim_analytics_summary` y `release_analytics_summary_claim`: reserva ATÓMICA del período y
--    alcance antes de llamar al servicio externo (un solo pedido a la vez y un tiempo mínimo entre generaciones), que se devuelve si
--    el pedido falla.
--
-- Reglas: SOLO el Dueño ACTUAL de la organización, con la función `analytics` en el plan, lee y reserva (como la analítica; en «solo
-- lectura» sí, suspendida no: `has_feature`). El contenido es texto generado a partir de agregados (nunca motivos escritos por el
-- personal ni datos de comensales). La API no tiene INSERT, UPDATE ni DELETE: las filas desaparecen con la organización o la
-- sucursal (cascada).
--
-- Aditiva: sin datos que migrar. Rollback (local): git revert + `pnpm db:reset`. En una base con datos reales:
--   drop function public.save_analytics_summary(uuid, uuid, integer, jsonb, text, uuid);
--   drop function public.claim_analytics_summary(uuid, integer, integer, uuid), public.release_analytics_summary_claim(uuid, integer, timestamptz, uuid);
--   drop table public.analytics_summary_claims, public.analytics_summaries;
--   drop function private.can_read_analytics_summary(uuid);

begin;

create table public.analytics_summaries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Nulo = todas las sucursales.
  branch_id uuid,
  days smallint not null,
  content jsonb not null,
  provider text not null,
  generated_by uuid references auth.users (id) on delete set null,
  generated_at timestamptz not null default now(),
  constraint analytics_summaries_days_check check (days in (7, 30, 90)),
  constraint analytics_summaries_content_check check (jsonb_typeof(content) = 'object' and pg_column_size(content) <= 8000),
  constraint analytics_summaries_provider_check check (char_length(btrim(provider)) between 1 and 40),
  foreign key (branch_id, organization_id) references public.branches (id, organization_id) on delete cascade
);
comment on table public.analytics_summaries is
  'Último resumen con IA de la analítica de un período (ADR 0047). Se escribe solo con save_analytics_summary; lo lee el Dueño con el plan.';

create unique index analytics_summaries_scope_key
  on public.analytics_summaries (organization_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), days);

-- Las políticas se evalúan con los permisos de quien lee, y `has_feature` no la ejecuta la API: esta función la envuelve (como
-- `can_take_orders` en los pedidos) y es lo único que la política necesita.
create function private.can_read_analytics_summary(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_org_owner(org_id) and private.has_feature(org_id, 'analytics');
$$;
revoke all on function private.can_read_analytics_summary(uuid) from public, anon, authenticated;
grant execute on function private.can_read_analytics_summary(uuid) to authenticated;

alter table public.analytics_summaries enable row level security;
revoke all on table public.analytics_summaries from anon, authenticated;
create policy "analytics_summaries: lectura del Dueño con el plan"
  on public.analytics_summaries for select to authenticated
  using (private.can_read_analytics_summary(organization_id));
grant select on table public.analytics_summaries to authenticated;

-- Solo la función (y la cascada del borrado de la organización o la sucursal, que corre con el dueño de la tabla) escribe.
revoke insert, update, delete, truncate, references, trigger on table public.analytics_summaries from service_role;

-- ---------------------------------------------------------------------------
-- Reserva del período (antes de llamar al servicio externo)
-- ---------------------------------------------------------------------------
-- Una fila por (organización, sucursal o «todas», período): `claimed_at` es cuándo se reservó por última vez. Solo la tocan las
-- funciones de abajo: la tabla no tiene permisos para ningún rol de la API.
create table public.analytics_summary_claims (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid,
  days smallint not null,
  claimed_at timestamptz not null,
  constraint analytics_summary_claims_days_check check (days in (7, 30, 90)),
  foreign key (branch_id, organization_id) references public.branches (id, organization_id) on delete cascade
);
comment on table public.analytics_summary_claims is
  'Reserva atómica del período de un resumen con IA (ADR 0047): evita pedidos simultáneos y fija el tiempo mínimo entre generaciones.';
create unique index analytics_summary_claims_scope_key
  on public.analytics_summary_claims (organization_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), days);
alter table public.analytics_summary_claims enable row level security;
revoke all on table public.analytics_summary_claims from anon, authenticated, service_role;

-- Reserva el período si pasaron `p_cooldown_minutes` desde la última reserva. `{"claimed": true, "claim": <fecha>}` o
-- `{"claimed": false, "wait_seconds": n}`. La comprobación y la escritura son UNA sentencia: dos pedidos simultáneos no pasan los dos.
create function public.claim_analytics_summary(p_org uuid, p_days integer, p_cooldown_minutes integer, p_branch uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim timestamptz;
  v_last timestamptz;
  v_cooldown interval;
begin
  if p_org is null
     or not private.is_org_owner(p_org)
     or not private.has_feature(p_org, 'analytics') then
    raise exception 'no autorizado' using errcode = '42501';
  end if;
  if p_days is null or p_days not in (7, 30, 90) or p_cooldown_minutes is null or p_cooldown_minutes not between 1 and 60 then
    raise exception 'parámetros inválidos' using errcode = '22023';
  end if;
  if p_branch is not null and not exists (
    select 1 from public.branches b where b.id = p_branch and b.organization_id = p_org
  ) then
    raise exception 'sucursal inválida' using errcode = '22023';
  end if;

  v_cooldown := make_interval(mins => p_cooldown_minutes);
  insert into public.analytics_summary_claims as c (organization_id, branch_id, days, claimed_at)
  values (p_org, p_branch, p_days, clock_timestamp())
  on conflict (organization_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), days)
  do update set claimed_at = excluded.claimed_at
  where c.claimed_at <= clock_timestamp() - v_cooldown
  returning c.claimed_at into v_claim;

  if v_claim is not null then
    return jsonb_build_object('claimed', true, 'claim', v_claim);
  end if;

  select c.claimed_at into v_last
  from public.analytics_summary_claims c
  where c.organization_id = p_org
    and coalesce(c.branch_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_branch, '00000000-0000-0000-0000-000000000000'::uuid)
    and c.days = p_days;
  return jsonb_build_object('claimed', false, 'wait_seconds', greatest(1, ceil(extract(epoch from (v_last + v_cooldown - clock_timestamp())))::integer));
end;
$$;
comment on function public.claim_analytics_summary(uuid, integer, integer, uuid) is
  'Reserva atómica del período de un resumen con IA para el Dueño con el plan analytics (ADR 0047). 42501 si no corresponde.';

-- Devuelve la reserva si el pedido falló (no se gastó nada): solo si sigue siendo la misma, así no pisa la de otro pedido.
create function public.release_analytics_summary_claim(p_org uuid, p_days integer, p_claim timestamptz, p_branch uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org is null
     or not private.is_org_owner(p_org)
     or not private.has_feature(p_org, 'analytics') then
    raise exception 'no autorizado' using errcode = '42501';
  end if;
  update public.analytics_summary_claims c
  set claimed_at = '-infinity'
  where c.organization_id = p_org
    and coalesce(c.branch_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_branch, '00000000-0000-0000-0000-000000000000'::uuid)
    and c.days = p_days
    and c.claimed_at = p_claim;
end;
$$;
comment on function public.release_analytics_summary_claim(uuid, integer, timestamptz, uuid) is
  'Devuelve la reserva de un resumen con IA cuando el pedido falló (ADR 0047).';

revoke all on function public.claim_analytics_summary(uuid, integer, integer, uuid), public.release_analytics_summary_claim(uuid, integer, timestamptz, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_analytics_summary(uuid, integer, integer, uuid), public.release_analytics_summary_claim(uuid, integer, timestamptz, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Guardado (solo el servidor)
-- ---------------------------------------------------------------------------
-- `p_user` es quien pidió el resumen: la acción del servidor ya comprobó su sesión y se vuelve a comprobar acá que sea Dueño con el
-- plan (la función no usa `auth.uid()`: la llama el servicio técnico).
create function public.save_analytics_summary(p_org uuid, p_user uuid, p_days integer, p_content jsonb, p_provider text, p_branch uuid default null)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz;
begin
  if p_org is null
     or p_user is null
     or not exists (select 1 from public.memberships m where m.organization_id = p_org and m.user_id = p_user and m.role = 'owner')
     or not private.has_feature(p_org, 'analytics') then
    raise exception 'no autorizado' using errcode = '42501';
  end if;
  if p_days is null or p_days not in (7, 30, 90) then
    raise exception 'período inválido' using errcode = '22023';
  end if;
  if p_branch is not null and not exists (
    select 1 from public.branches b where b.id = p_branch and b.organization_id = p_org
  ) then
    raise exception 'sucursal inválida' using errcode = '22023';
  end if;

  insert into public.analytics_summaries as s (organization_id, branch_id, days, content, provider, generated_by, generated_at)
  values (p_org, p_branch, p_days, p_content, p_provider, p_user, now())
  on conflict (organization_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), days)
  do update set content = excluded.content, provider = excluded.provider, generated_by = excluded.generated_by, generated_at = excluded.generated_at
  returning s.generated_at into v_at;
  return v_at;
end;
$$;
comment on function public.save_analytics_summary(uuid, uuid, integer, jsonb, text, uuid) is
  'Guarda (reemplazando) el resumen con IA ya validado por el servidor (ADR 0047). Solo service_role; 42501 si p_user no es Dueño con el plan analytics.';

revoke all on function public.save_analytics_summary(uuid, uuid, integer, jsonb, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.save_analytics_summary(uuid, uuid, integer, jsonb, text, uuid) to service_role;

commit;

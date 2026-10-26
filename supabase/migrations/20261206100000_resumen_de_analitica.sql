-- Resumen de la analítica con IA (ficha agile/cambios/resumen-de-analitica-con-ia.md, ADR 0047), sobre 20261205100000 (analítica de pedidos).
--
-- Qué hace:
--  * Tabla `analytics_summaries`: el último resumen generado por período (7, 30 o 90 días) y alcance (toda la organización o una
--    sucursal). Una fila por (organización, sucursal o «todas», período): generar de nuevo la reemplaza.
--  * `save_analytics_summary(p_org, p_days, p_content, p_provider, p_branch)`: única puerta de escritura. Valida adentro.
--
-- Reglas: SOLO el Dueño ACTUAL de la organización, con la función `analytics` en el plan, lee y guarda (como la analítica; en «solo
-- lectura» sí, suspendida no: `has_feature`). El contenido es texto generado a partir de agregados (nunca motivos escritos por el
-- personal ni datos de comensales); acá solo se guarda lo que la aplicación ya validó. La API no tiene INSERT, UPDATE ni DELETE: la
-- fila desaparece con la organización o la sucursal (cascada).
--
-- Aditiva: sin datos que migrar. Rollback (local): git revert + `pnpm db:reset`. En una base con datos reales:
--   drop function public.save_analytics_summary(uuid, integer, jsonb, text, uuid);
--   drop table public.analytics_summaries;
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
-- Guardado
-- ---------------------------------------------------------------------------
create function public.save_analytics_summary(p_org uuid, p_days integer, p_content jsonb, p_provider text, p_branch uuid default null)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz;
begin
  if p_org is null
     or not private.is_org_owner(p_org)
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
  values (p_org, p_branch, p_days, p_content, p_provider, (select auth.uid()), now())
  on conflict (organization_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), days)
  do update set content = excluded.content, provider = excluded.provider, generated_by = excluded.generated_by, generated_at = excluded.generated_at
  returning s.generated_at into v_at;
  return v_at;
end;
$$;
comment on function public.save_analytics_summary(uuid, integer, jsonb, text, uuid) is
  'Guarda (reemplazando) el resumen con IA de un período para el Dueño con el plan analytics (ADR 0047). 42501 si no corresponde.';

revoke all on function public.save_analytics_summary(uuid, integer, jsonb, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.save_analytics_summary(uuid, integer, jsonb, text, uuid) to authenticated;

commit;

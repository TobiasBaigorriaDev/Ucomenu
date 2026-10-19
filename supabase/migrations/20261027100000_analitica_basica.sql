-- Analítica básica: platos más vistos y llamados por franja horaria (nivel C; ficha analitica-basica, ADR 0022).
--
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos (solo se pierde la estadística):
--   drop function public.record_dish_view(uuid, uuid);
--   drop function public.owner_top_dishes(uuid, integer, uuid, integer);
--   drop function public.owner_calls_by_hour(uuid, uuid);
--   drop table public.dish_view_counts;
--
-- Decisiones:
--  * Las vistas se guardan como CONTADORES por (sucursal, plato, día de Argentina): nunca un evento, nunca una IP, nunca
--    un identificador ni una hora exacta del comensal.
--  * `dish_view_counts` no da ningún permiso (ni a service_role) ni tiene políticas: solo la tocan las funciones de abajo
--    (patrón de `push_subscriptions`).
--  * `record_dish_view` la llama cualquiera (la carta es pública) y valida TODO adentro; ante cualquier duda devuelve
--    `false` sin escribir y sin decir por qué.
--  * La lectura es solo para el Dueño actual de la organización con el plan que incluye `analytics` y la cuenta no
--    suspendida (con la cuenta en «solo lectura» sí, regla de `private.has_feature`); cualquier otro recibe cero filas.
--  * Los llamados por hora salen de `waiter_calls` (los últimos 14 días: lo que la purga, ADR 0014, deja). No se lee
--    `client_key`.

-- ---------------------------------------------------------------------------
-- Contadores de vistas de platos
-- ---------------------------------------------------------------------------
create table public.dish_view_counts (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null references public.branches (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  -- Día calendario de Argentina en que se abrió el detalle.
  day date not null,
  views integer not null check (views between 1 and 1000000),
  primary key (branch_id, product_id, day)
);
comment on table public.dish_view_counts is
  'Cuántas veces se abrió el detalle de un plato en una sucursal, por día. Solo contadores: sin IP, sin identificador del comensal, sin hora. La escribe únicamente record_dish_view y la leen solo las funciones del Dueño.';

create index dish_view_counts_org_day_idx on public.dish_view_counts (organization_id, day desc);

alter table public.dish_view_counts enable row level security;
revoke all on table public.dish_view_counts from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Registrar una vista (pública, valida adentro)
-- ---------------------------------------------------------------------------
create function public.record_dish_view(p_branch uuid, p_product uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if p_branch is null or p_product is null then
    return false;
  end if;

  select b.organization_id into v_org
  from public.branches b
  join public.organizations o on o.id = b.organization_id
  where b.id = p_branch
    and b.is_active
    and o.is_active;
  if v_org is null then
    return false;
  end if;

  -- Plan con analítica y cuenta no suspendida.
  if not private.has_feature(v_org, 'analytics') then
    return false;
  end if;

  -- Un plato publicado de ESA organización (no se cruzan organizaciones).
  if not exists (
    select 1
    from public.products p
    join public.categories c on c.id = p.category_id and c.organization_id = p.organization_id
    where p.id = p_product
      and p.organization_id = v_org
      and p.is_active
      and c.is_active
  ) then
    return false;
  end if;

  insert into public.dish_view_counts as d (organization_id, branch_id, product_id, day, views)
  values (v_org, p_branch, p_product, (now() at time zone 'America/Argentina/Buenos_Aires')::date, 1)
  on conflict (branch_id, product_id, day)
  do update set views = least(d.views + 1, 1000000);

  return true;
end;
$$;
comment on function public.record_dish_view(uuid, uuid) is
  'Suma 1 a las vistas del día de un plato publicado, solo si la sucursal está activa y el plan incluye analítica. Pública; devuelve false sin escribir ante cualquier dato que no cuadre.';

-- ---------------------------------------------------------------------------
-- Platos más vistos (Dueño con analítica)
-- ---------------------------------------------------------------------------
create function public.owner_top_dishes(
  p_org uuid,
  p_days integer default 14,
  p_branch uuid default null,
  p_limit integer default 10
)
returns table (
  product_id uuid,
  name text,
  views bigint,
  total_views bigint,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from date;
begin
  if p_org is null
     or not private.is_org_owner(p_org)
     or not private.has_feature(p_org, 'analytics') then
    return;
  end if;

  v_from := (now() at time zone 'America/Argentina/Buenos_Aires')::date - (least(greatest(coalesce(p_days, 14), 1), 90) - 1);

  return query
  with per_dish as (
    select d.product_id as pid, sum(d.views)::bigint as v
    from public.dish_view_counts d
    where d.organization_id = p_org
      and d.day >= v_from
      and (p_branch is null or d.branch_id = p_branch)
    group by d.product_id
  ),
  total as (select coalesce(sum(per_dish.v), 0)::bigint as t from per_dish)
  -- Se listan también los platos desactivados (con su estado): así el total siempre coincide con lo que se muestra.
  select p.id, p.name, per_dish.v, total.t, p.is_active
  from per_dish
  join public.products p on p.id = per_dish.pid and p.organization_id = p_org
  cross join total
  order by per_dish.v desc, p.name, p.id
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
end;
$$;
comment on function public.owner_top_dishes(uuid, integer, uuid, integer) is
  'Platos más vistos de los últimos días (1 a 90) para el Dueño actual con analítica, con el total de vistas del período y si el plato sigue activo. Cero filas para cualquier otra identidad. Solo lee.';

-- ---------------------------------------------------------------------------
-- Llamados por hora del día (Dueño con analítica)
-- ---------------------------------------------------------------------------
-- Últimos 14 días de `waiter_calls` (lo que conserva la purga, ADR 0014), por hora de Argentina y por tipo.
create function public.owner_calls_by_hour(p_org uuid, p_branch uuid default null)
returns table (
  hour_of_day integer,
  waiter bigint,
  bill bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_org is null
     or not private.is_org_owner(p_org)
     or not private.has_feature(p_org, 'analytics') then
    return;
  end if;

  return query
  select
    extract(hour from (w.created_at at time zone 'America/Argentina/Buenos_Aires'))::integer,
    count(*) filter (where w.kind = 'waiter'),
    count(*) filter (where w.kind = 'bill')
  from public.waiter_calls w
  where w.organization_id = p_org
    and w.created_at >= now() - interval '14 days'
    and (p_branch is null or w.branch_id = p_branch)
  group by 1
  order by 1;
end;
$$;
comment on function public.owner_calls_by_hour(uuid, uuid) is
  'Llamados de los últimos 14 días por hora del día (Argentina) y tipo, para el Dueño actual con analítica. Cero filas para cualquier otra identidad. No lee client_key. Solo lee.';

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
-- PUBLIC recibe EXECUTE por defecto: se parte de cero.
revoke all on function public.record_dish_view(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.owner_top_dishes(uuid, integer, uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.owner_calls_by_hour(uuid, uuid) from public, anon, authenticated, service_role;
-- La carta es pública (la acción del servidor usa el cliente anónimo); la función valida todo adentro.
grant execute on function public.record_dish_view(uuid, uuid) to anon, authenticated;
-- Las lecturas son de una persona con sesión (vuelven a comprobar que sea Dueño de la organización).
grant execute on function public.owner_top_dishes(uuid, integer, uuid, integer) to authenticated;
grant execute on function public.owner_calls_by_hour(uuid, uuid) to authenticated;

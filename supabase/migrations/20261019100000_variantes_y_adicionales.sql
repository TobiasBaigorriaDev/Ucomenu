-- Variantes y adicionales (ficha agile/cambios/variantes-y-adicionales.md).
--
-- Solo aditiva: dos tablas nuevas, una restricción única sobre products y dos triggers de tope técnico;
-- no toca datos. Rollback (local): git revert + `pnpm db:reset`. En una base con datos:
--   drop table public.options; drop table public.option_groups;
--   drop function private.enforce_option_group_cap(); drop function private.enforce_option_cap();
--   alter table public.products drop constraint products_id_organization_id_key;
--
-- Reglas de fondo (las mismas de la carta, ADR 0005/0006):
--  * option_groups (grupo de un plato: nombre, mínimo y máximo a elegir) y options (opción de un grupo: nombre y
--    diferencia de precio en centavos, >= 0). Una variante es un grupo mínimo 1 / máximo 1; los adicionales, mínimo 0 / máximo N.
--  * organization_id denormalizado en ambas tablas; las claves foráneas compuestas impiden que un grupo apunte a un
--    plato de otra organización o una opción a un grupo ajeno.
--  * Escribir exige miembro de la organización y cuenta que puede escribir (org_can_write), igual que categories y products.
--  * Permisos por columna: id, organization_id, created_at, product_id y group_id no se eligen después de crear ni se
--    mueven. Sin DELETE: desactivar es la baja (como mesas); borrar un plato sí se lleva sus grupos (cascada).
--  * Lectura pública (anon): solo lo activo, de platos y categorías visibles y con la cuenta publicada.
--  * La diferencia de precio es informativa: no cambia products.price_cents ni se audita en price_history (ficha).
--  * Topes TÉCNICOS (no de plan, no tocan plans ni org_entitlements): 20 grupos por plato y 60 opciones por grupo,
--    contando también los inactivos (no hay borrado). Código 54000 (program_limit_exceeded), distinto de 53400.

-- Permite la clave foránea compuesta (product_id, organization_id).
alter table public.products
  add constraint products_id_organization_id_key unique (id, organization_id);

create table public.option_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  product_id uuid not null,
  name text not null
    check (length(btrim(name)) between 1 and 80),
  min_choices smallint not null default 0
    check (min_choices >= 0),
  max_choices smallint not null default 1
    check (max_choices between 1 and 50),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (min_choices <= max_choices),
  unique (id, organization_id),
  foreign key (product_id, organization_id)
    references public.products (id, organization_id) on delete cascade
);
comment on table public.option_groups is
  'Grupo de opciones de un plato. Variante = mínimo 1 y máximo 1; adicionales = mínimo 0 y máximo N. Solo informativo (no hay pedidos).';

create table public.options (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  group_id uuid not null,
  name text not null
    check (length(btrim(name)) between 1 and 80),
  price_delta_cents integer not null default 0
    check (price_delta_cents between 0 and 1000000000),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (group_id, organization_id)
    references public.option_groups (id, organization_id) on delete cascade
);
comment on table public.options is
  'Opción de un grupo. price_delta_cents es la diferencia sobre el precio base del plato (nunca negativa), en centavos enteros.';

-- Las claves foráneas no se indexan solas; estos sirven también para listar en orden y para la cascada.
create index option_groups_product_idx on public.option_groups (product_id, sort_order);
create index option_groups_organization_idx on public.option_groups (organization_id);
create index options_group_idx on public.options (group_id, sort_order);
create index options_organization_idx on public.options (organization_id);

alter table public.option_groups enable row level security;
alter table public.options       enable row level security;

-- ---------------------------------------------------------------------------
-- Topes técnicos por plato y por grupo (se aplican al crear; cuentan también lo inactivo)
-- ---------------------------------------------------------------------------
-- Corren con el rol que escribe (sin SECURITY DEFINER): un miembro cuenta lo de su organización; a quien no lo es lo
-- frena RLS. El candado de transacción evita pasarse del tope con dos altas simultáneas.

create function private.enforce_option_group_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('cap:option_groups:' || new.product_id::text, 0));
  if (select count(*) from public.option_groups where product_id = new.product_id) >= 20 then
    raise exception 'limit_exceeded:option_groups_per_product'
      using errcode = '54000', hint = 'Un plato admite hasta 20 grupos de opciones.';
  end if;
  return new;
end;
$$;

create trigger option_groups_enforce_cap
  before insert on public.option_groups
  for each row execute function private.enforce_option_group_cap();

create function private.enforce_option_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('cap:options:' || new.group_id::text, 0));
  if (select count(*) from public.options where group_id = new.group_id) >= 60 then
    raise exception 'limit_exceeded:options_per_group'
      using errcode = '54000', hint = 'Un grupo admite hasta 60 opciones.';
  end if;
  return new;
end;
$$;

create trigger options_enforce_cap
  before insert on public.options
  for each row execute function private.enforce_option_cap();

revoke all on function private.enforce_option_group_cap(), private.enforce_option_cap()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Políticas
-- ---------------------------------------------------------------------------

-- Lectura pública: solo filas activas, cuya cadena (plato -> categoría) también lo esté y con la cuenta publicada.
-- Los EXISTS consultan tablas con RLS: la condición de la organización activa llega por categories.
create policy "option_groups: lectura pública de activos en plato visible"
  on public.option_groups for select
  to anon, authenticated
  using (
    is_active
    and private.org_is_published(organization_id)
    and exists (
      select 1
      from public.products p
      join public.categories c on c.id = p.category_id and c.organization_id = p.organization_id
      where p.id = option_groups.product_id
        and p.organization_id = option_groups.organization_id
        and p.is_active
        and c.is_active
    )
  );

create policy "options: lectura pública de activas en grupo visible"
  on public.options for select
  to anon, authenticated
  using (
    is_active
    and private.org_is_published(organization_id)
    and exists (
      select 1
      from public.option_groups g
      join public.products p on p.id = g.product_id and p.organization_id = g.organization_id
      join public.categories c on c.id = p.category_id and c.organization_id = p.organization_id
      where g.id = options.group_id
        and g.organization_id = options.organization_id
        and g.is_active
        and p.is_active
        and c.is_active
    )
  );

-- Miembros: leen todo lo de su organización (también lo inactivo); escriben con la cuenta al día. Sin DELETE.
create policy "option_groups: lectura de miembros"
  on public.option_groups for select
  to authenticated
  using (private.is_org_member(organization_id));

create policy "option_groups: los miembros crean con la cuenta al día"
  on public.option_groups for insert
  to authenticated
  with check (private.is_org_member(organization_id) and private.org_can_write(organization_id));

create policy "option_groups: los miembros actualizan con la cuenta al día"
  on public.option_groups for update
  to authenticated
  using (private.is_org_member(organization_id) and private.org_can_write(organization_id))
  with check (private.is_org_member(organization_id) and private.org_can_write(organization_id));

create policy "options: lectura de miembros"
  on public.options for select
  to authenticated
  using (private.is_org_member(organization_id));

create policy "options: los miembros crean con la cuenta al día"
  on public.options for insert
  to authenticated
  with check (private.is_org_member(organization_id) and private.org_can_write(organization_id));

create policy "options: los miembros actualizan con la cuenta al día"
  on public.options for update
  to authenticated
  using (private.is_org_member(organization_id) and private.org_can_write(organization_id))
  with check (private.is_org_member(organization_id) and private.org_can_write(organization_id));

-- ---------------------------------------------------------------------------
-- Permisos explícitos sobre la Data API (por columna)
-- ---------------------------------------------------------------------------
-- id y created_at los pone la base. organization_id, product_id y group_id se fijan al crear y no se pueden cambiar:
-- así nadie mueve un grupo a un plato (o una opción a un grupo) de otra organización.

revoke all on table public.option_groups, public.options from anon, authenticated;

grant select on table public.option_groups, public.options to anon, authenticated;

grant insert (organization_id, product_id, name, min_choices, max_choices, sort_order, is_active)
  on table public.option_groups to authenticated;
grant update (name, min_choices, max_choices, sort_order, is_active)
  on table public.option_groups to authenticated;

grant insert (organization_id, group_id, name, price_delta_cents, sort_order, is_active)
  on table public.options to authenticated;
grant update (name, price_delta_cents, sort_order, is_active)
  on table public.options to authenticated;

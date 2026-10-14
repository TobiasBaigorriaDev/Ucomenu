-- Núcleo multi-tenant (nivel C): membresías, roles y políticas de escritura.
-- Ver agile/cambios/nucleo-multi-tenant.md y docs/decisiones/0005-autorizacion-por-membresia.md.
--
-- Solo aditiva: crea tablas, funciones, políticas y permisos nuevos; no toca datos.
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos, ver la ficha.
--
-- Reglas de fondo:
--  * La autorización sale de public.memberships, nunca del JWT ni de user_metadata
--    (user_metadata lo edita el propio usuario). Quitar una membresía corta el acceso al instante.
--  * Las membresías, las organizaciones y las sucursales se crean y borran solo desde el servidor
--    (service_role). Por la API, nadie puede elevarse de rol ni cambiar de organización.
--  * Los permisos de UPDATE/INSERT son por columna: organization_id nunca es modificable por la API.

-- ---------------------------------------------------------------------------
-- Membresías
-- ---------------------------------------------------------------------------

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  role text not null
    check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  unique (user_id, organization_id)
);
comment on table public.memberships is
  'Usuario ↔ organización con rol owner | staff. Fuente única de autorización (ADR 0005). Solo escribe el servidor.';

-- memberships(user_id) queda cubierto por unique (user_id, organization_id).
create index memberships_organization_id_idx
  on public.memberships (organization_id);

alter table public.memberships enable row level security;

-- ---------------------------------------------------------------------------
-- Funciones auxiliares (esquema no expuesto por la Data API)
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER es necesario: consultan memberships, que tiene RLS, desde políticas
-- de otras tablas (y de la propia memberships) sin caer en recursión. Por eso:
--  * search_path vacío y nombres calificados;
--  * esquema `private`, que la API no expone;
--  * EXECUTE solo para `authenticated` (las políticas se evalúan con el rol que consulta).

create schema private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create function private.is_org_member(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organization_id = org_id
      and m.user_id = (select auth.uid())
  );
$$;

create function private.is_org_owner(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organization_id = org_id
      and m.user_id = (select auth.uid())
      and m.role = 'owner'
  );
$$;

revoke all on function private.is_org_member(uuid), private.is_org_owner(uuid)
  from public, anon, authenticated;
grant execute on function private.is_org_member(uuid), private.is_org_owner(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Políticas
-- ---------------------------------------------------------------------------
-- Las políticas permisivas se suman con OR: la lectura pública de la migración anterior
-- sigue valiendo; estas agregan lo propio de cada miembro.

-- memberships: cada uno ve la suya; el owner ve las de su organización. Sin escrituras por API.
create policy "memberships: lectura propia o del owner de la organización"
  on public.memberships for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or private.is_org_owner(organization_id)
  );

-- organizations: el miembro ve la suya (aunque esté inactiva); el owner cambia el nombre.
create policy "organizations: lectura de miembros"
  on public.organizations for select
  to authenticated
  using (private.is_org_member(id));

create policy "organizations: el owner actualiza la suya"
  on public.organizations for update
  to authenticated
  using (private.is_org_owner(id))
  with check (private.is_org_owner(id));

-- branches
create policy "branches: lectura de miembros"
  on public.branches for select
  to authenticated
  using (private.is_org_member(organization_id));

create policy "branches: el owner actualiza las de su organización"
  on public.branches for update
  to authenticated
  using (private.is_org_owner(organization_id))
  with check (private.is_org_owner(organization_id));

-- categories: owner y staff gestionan la carta de su organización.
create policy "categories: lectura de miembros"
  on public.categories for select
  to authenticated
  using (private.is_org_member(organization_id));

create policy "categories: los miembros crean en su organización"
  on public.categories for insert
  to authenticated
  with check (private.is_org_member(organization_id));

create policy "categories: los miembros actualizan las de su organización"
  on public.categories for update
  to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));

create policy "categories: los miembros borran las de su organización"
  on public.categories for delete
  to authenticated
  using (private.is_org_member(organization_id));

-- products
create policy "products: lectura de miembros"
  on public.products for select
  to authenticated
  using (private.is_org_member(organization_id));

create policy "products: los miembros crean en su organización"
  on public.products for insert
  to authenticated
  with check (private.is_org_member(organization_id));

create policy "products: los miembros actualizan los de su organización"
  on public.products for update
  to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));

create policy "products: los miembros borran los de su organización"
  on public.products for delete
  to authenticated
  using (private.is_org_member(organization_id));

-- ---------------------------------------------------------------------------
-- Permisos sobre la Data API (por columna donde importa)
-- ---------------------------------------------------------------------------

revoke all on table public.memberships from anon, authenticated;
grant select on table public.memberships to authenticated;

-- Nombre editable; slug (rompería los QR), is_active y organization_id solo desde el servidor.
grant update (name) on table public.organizations to authenticated;
grant update (name) on table public.branches to authenticated;

-- id y created_at los pone la base; organization_id se fija al crear y no se puede cambiar.
grant insert (organization_id, name, sort_order, is_active) on table public.categories to authenticated;
grant update (name, sort_order, is_active) on table public.categories to authenticated;
grant delete on table public.categories to authenticated;

-- currency queda en su valor por defecto (ARS) hasta que el producto soporte otras monedas.
grant insert (organization_id, category_id, name, description, price_cents, sort_order, is_active)
  on table public.products to authenticated;
grant update (category_id, name, description, price_cents, sort_order, is_active)
  on table public.products to authenticated;
grant delete on table public.products to authenticated;

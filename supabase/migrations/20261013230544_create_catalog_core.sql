-- Núcleo del catálogo público: organizaciones, sucursales, categorías y platos.
--
-- Esta migración es SOLO LECTURA para los roles de la Data API (anon y authenticated).
-- Las políticas de escritura por membresía llegan con «Núcleo multi-tenant» (nivel C).
-- Hasta entonces nadie escribe por la API: los datos entran por seed o con service_role.

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null
    check (length(btrim(name)) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
comment on table public.organizations is
  'Tenant. Una organización tiene una o más sucursales. Aislamiento por RLS (ADR 0004).';

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  slug text not null
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null
    check (length(btrim(name)) > 0),
  created_at timestamptz not null default now(),
  unique (organization_id, slug)
);
comment on table public.branches is
  'Sucursal física de una organización. Mesas, QR, personal y coordenadas se agregan en ítems posteriores.';

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null
    check (length(btrim(name)) > 0),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  -- Permite que products referencie (id, organization_id) y así garantice
  -- a nivel de base que un plato nunca apunta a una categoría de otra organización.
  unique (id, organization_id)
);
comment on table public.categories is
  'Categoría de la carta. La carta es de la organización y se comparte entre sucursales.';

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  category_id uuid not null,
  name text not null
    check (length(btrim(name)) > 0),
  description text,
  price_cents integer not null
    check (price_cents >= 0),
  currency char(3) not null default 'ARS'
    check (currency = 'ARS'),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (category_id, organization_id)
    references public.categories (id, organization_id) on delete cascade
);
comment on table public.products is
  'Plato de la carta. El precio es entero en centavos; nunca punto flotante.';

-- ---------------------------------------------------------------------------
-- Índices (las FK no se indexan solas en Postgres)
-- ---------------------------------------------------------------------------

-- branches(organization_id) queda cubierto por unique (organization_id, slug).
create index categories_organization_id_idx
  on public.categories (organization_id, sort_order);

create index products_organization_category_idx
  on public.products (organization_id, category_id, sort_order);

-- La FK compuesta de products necesita buscar por category_id en los borrados en cascada.
create index products_category_id_idx
  on public.products (category_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.branches      enable row level security;
alter table public.categories    enable row level security;
alter table public.products      enable row level security;

-- Lectura pública: solo filas publicables. Cada nivel exige que el padre también lo sea.
-- Los EXISTS consultan tablas que también tienen RLS, así que la condición del padre
-- se aplica sola (una organización inactiva oculta todo lo que cuelga de ella).

create policy "organizations: lectura pública de activas"
  on public.organizations for select
  to anon, authenticated
  using (is_active);

create policy "branches: lectura pública de organizaciones activas"
  on public.branches for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.organizations o
      where o.id = branches.organization_id
        and o.is_active
    )
  );

create policy "categories: lectura pública de activas"
  on public.categories for select
  to anon, authenticated
  using (
    is_active
    and exists (
      select 1
      from public.organizations o
      where o.id = categories.organization_id
        and o.is_active
    )
  );

create policy "products: lectura pública de activos en categoría activa"
  on public.products for select
  to anon, authenticated
  using (
    is_active
    and exists (
      select 1
      from public.categories c
      where c.id = products.category_id
        and c.organization_id = products.organization_id
        and c.is_active
    )
  );

-- ---------------------------------------------------------------------------
-- Permisos explícitos sobre la Data API
-- ---------------------------------------------------------------------------
-- Supabase puede otorgar privilegios por defecto a anon/authenticated sobre tablas nuevas
-- (y dejará de hacerlo). Se parte de cero y se concede solo SELECT, para no depender de ello.

revoke all on table
  public.organizations,
  public.branches,
  public.categories,
  public.products
from anon, authenticated;

grant select on table
  public.organizations,
  public.branches,
  public.categories,
  public.products
to anon, authenticated;

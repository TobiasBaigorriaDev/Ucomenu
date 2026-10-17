-- Un plato sigue publicado aunque esté agotado. Sin fila equivale a disponible.
create table public.product_availability (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  product_id uuid not null,
  is_available boolean not null default true,
  primary key (branch_id, product_id),
  foreign key (branch_id, organization_id)
    references public.branches (id, organization_id) on delete cascade,
  foreign key (product_id, organization_id)
    references public.products (id, organization_id) on delete cascade
);
comment on table public.product_availability is
  'Disponibilidad declarada por sucursal. Ausencia de fila = disponible; agotado no desactiva ni borra el plato.';
create index product_availability_organization_idx on public.product_availability (organization_id);
create index product_availability_product_idx on public.product_availability (product_id);
alter table public.product_availability enable row level security;

create policy "product_availability: lectura pública de platos publicados"
  on public.product_availability for select to anon, authenticated
  using (
    private.org_is_published(organization_id)
    and exists (
      select 1 from public.products p
      join public.categories c on c.id = p.category_id and c.organization_id = p.organization_id
      where p.id = product_availability.product_id
        and p.organization_id = product_availability.organization_id
        and p.is_active and c.is_active
    )
    and exists (
      select 1 from public.branches b
      where b.id = product_availability.branch_id
        and b.organization_id = product_availability.organization_id
    )
  );
create policy "product_availability: lectura de miembros"
  on public.product_availability for select to authenticated
  using (private.is_org_member(organization_id));
create policy "product_availability: miembros crean con cuenta editable"
  on public.product_availability for insert to authenticated
  with check (private.is_org_member(organization_id) and private.org_can_write(organization_id));
create policy "product_availability: miembros actualizan con cuenta editable"
  on public.product_availability for update to authenticated
  using (private.is_org_member(organization_id) and private.org_can_write(organization_id))
  with check (private.is_org_member(organization_id) and private.org_can_write(organization_id));

-- Claves inmutables. No DELETE; volver a disponible actualiza el estado.
revoke all on public.product_availability from anon, authenticated;
grant select on public.product_availability to anon, authenticated;
grant insert (organization_id, branch_id, product_id, is_available) on public.product_availability to authenticated;
grant update (is_available) on public.product_availability to authenticated;

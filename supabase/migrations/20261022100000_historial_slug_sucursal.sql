-- Históricos en la misma sucursal: mismas políticas y privilegios de branches.
-- La API de miembros no recibe UPDATE de slug ni de slug_aliases.
alter table public.branches add column slug_aliases text[] not null default '{}';
create index branches_slug_aliases_idx on public.branches using gin (slug_aliases);

create function private.keep_branch_slug_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Serializa altas y correcciones de una organización para reservar también los alias,
  -- que no pueden protegerse con el UNIQUE (organization_id, slug) de la dirección actual.
  perform pg_advisory_xact_lock(hashtextextended('branch-slug:' || new.organization_id::text, 0));
  if exists (
    select 1 from public.branches b
    where b.organization_id = new.organization_id and b.id <> new.id
      and (b.slug = new.slug or new.slug = any(b.slug_aliases))
  ) then
    raise exception 'branch_slug_taken' using errcode = '23505';
  end if;
  if tg_op = 'INSERT' then
    new.slug_aliases := '{}';
  elsif new.slug is distinct from old.slug then
    new.slug_aliases := array_remove(array_append(old.slug_aliases, old.slug), new.slug);
  else
    new.slug_aliases := old.slug_aliases;
  end if;
  return new;
end;
$$;
revoke all on function private.keep_branch_slug_history() from public, anon, authenticated;
create trigger branches_keep_slug_history
  before insert or update of slug, slug_aliases on public.branches
  for each row execute function private.keep_branch_slug_history();

-- Mismo contrato y privilegios: un enlace antes válido sigue mostrando la pausa de la cuenta.
create or replace function public.public_menu_status(p_org_slug text, p_branch_slug text)
returns text language sql stable security definer set search_path = ''
as $$
  select case when private.org_is_published(o.id) then 'available' else 'suspended' end
  from public.organizations o
  join public.branches b on b.organization_id = o.id
  where o.slug = p_org_slug
    and (b.slug = p_branch_slug or p_branch_slug = any(b.slug_aliases))
    and o.is_active;
$$;

-- Identidad del local: campos públicos de marca y archivos gráficos propios.
-- Aditiva; conserva la política de organizations (Dueño + org_can_write).
alter table public.organizations
  add column menu_palette text not null default 'oliva'
    check (menu_palette in ('oliva', 'azul', 'vino', 'cacao')),
  add column logo_path text
    check (logo_path is null or logo_path ~ (
      '^' || id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
    ));

grant update (menu_palette, logo_path) on public.organizations to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('organization-logos', 'organization-logos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp']);

create function private.organization_logo_org(object_name text)
returns uuid
language sql immutable
set search_path = ''
as $$
  select case
    when object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
    then split_part(object_name, '/', 1)::uuid
  end;
$$;
revoke all on function private.organization_logo_org(text) from public, anon, authenticated;
grant execute on function private.organization_logo_org(text) to authenticated;

create policy "organization-logos: el dueño lee sus archivos"
  on storage.objects for select to authenticated
  using (bucket_id = 'organization-logos' and private.is_org_owner(private.organization_logo_org(name)));

create policy "organization-logos: el dueño sube con cuenta editable"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'organization-logos'
    and private.is_org_owner(private.organization_logo_org(name))
    and private.org_can_write(private.organization_logo_org(name))
  );

create policy "organization-logos: el dueño borra con cuenta editable"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'organization-logos'
    and private.is_org_owner(private.organization_logo_org(name))
    and private.org_can_write(private.organization_logo_org(name))
  );
-- Sin UPDATE: cada versión tiene un UUID nuevo y nunca pisa otra imagen.

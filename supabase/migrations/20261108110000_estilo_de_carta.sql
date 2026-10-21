-- Estilo de la carta por local: conjunto cerrado de composiciones sobre los mismos datos. Aditiva: los locales existentes
-- conservan el bento actual. Mismo permiso que el resto de la identidad (Dueño + org_can_write, por la política de organizations).
-- La lista debe coincidir con `LAYOUTS` en `src/lib/identidad/layouts.ts`.
alter table public.organizations
  add column menu_layout text not null default 'bento'
    check (menu_layout in ('bento', 'clasica', 'minimal'));

grant update (menu_layout) on public.organizations to authenticated;

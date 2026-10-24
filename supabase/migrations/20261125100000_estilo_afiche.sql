-- Cuarto estilo de carta: «afiche» (títulos grandes condensados, numeración y bloques de color). Solo amplía el conjunto
-- cerrado de `menu_layout`; los locales existentes conservan su estilo. Mismo permiso que antes (grant de columna y política
-- de organizations). La lista debe coincidir con `LAYOUTS` en `src/lib/identidad/layouts.ts`.
alter table public.organizations
  drop constraint organizations_menu_layout_check,
  add constraint organizations_menu_layout_check
    check (menu_layout in ('bento', 'clasica', 'minimal', 'afiche'));

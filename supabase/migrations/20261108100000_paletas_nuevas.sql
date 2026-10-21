-- Paletas nuevas de la carta (claras y oscuras). Solo amplía el conjunto cerrado de valores permitidos: los locales
-- existentes conservan la suya y el grant de columna no cambia. La lista debe coincidir con `PALETTES` en
-- `src/lib/identidad/palettes.ts`.
alter table public.organizations
  drop constraint organizations_menu_palette_check,
  add constraint organizations_menu_palette_check check (menu_palette in (
    'oliva', 'azul', 'vino', 'cacao', 'citrico', 'mar', 'trattoria', 'monocromo',
    'carbon', 'medianoche', 'bosque', 'borgona'
  ));

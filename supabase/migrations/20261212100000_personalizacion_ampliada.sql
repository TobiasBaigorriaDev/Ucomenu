-- Personalización ampliada de la carta (nivel M, ADR 0050): voz tipográfica, forma, densidad y ambientación.
-- Aditiva: los locales existentes quedan con los valores predeterminados (la carta se ve igual que antes). Mismo permiso que el
-- resto de la identidad: `grant update` de columna + la política de organizations (Dueño con cuenta editable). Las listas deben
-- coincidir con `FONTS`, `SHAPES`, `DENSITIES` y `AMBIENTS` en `src/lib/identidad/`; una prueba lo comprueba.
--
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos:
--   revoke update (menu_font, menu_shape, menu_density, menu_ambient) on public.organizations from authenticated;
--   alter table public.organizations drop column menu_font, drop column menu_shape, drop column menu_density, drop column menu_ambient;
alter table public.organizations
  add column menu_font text not null default 'clasica'
    check (menu_font in ('clasica', 'calida', 'editorial', 'moderna', 'bodegon', 'nocturna')),
  add column menu_shape text not null default 'suave'
    check (menu_shape in ('suave', 'recta', 'filete')),
  add column menu_density text not null default 'aireada'
    check (menu_density in ('aireada', 'compacta')),
  add column menu_ambient text not null default 'ninguno'
    check (menu_ambient in ('ninguno', 'lino', 'cuadros', 'rayas', 'granos', 'hojas'));

grant update (menu_font, menu_shape, menu_density, menu_ambient) on public.organizations to authenticated;

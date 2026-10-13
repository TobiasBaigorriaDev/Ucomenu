-- Largo máximo de slug: 64 caracteres, igual que la validación de la ruta pública
-- (src/lib/slug.ts). Sin esto, la base aceptaba slugs que la ruta respondía como 404.
--
-- Reversible: `alter table ... drop constraint <nombre>`. Falla si ya existiera un slug
-- de más de 64 caracteres (no ocurre en local ni en el seed).

alter table public.organizations
  add constraint organizations_slug_max_length check (char_length(slug) <= 64);

alter table public.branches
  add constraint branches_slug_max_length check (char_length(slug) <= 64);

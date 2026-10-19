-- Carta en varios idiomas (ficha carta-en-varios-idiomas, ADR 0023).
-- Aditiva: una columna `translations` en categorías, platos, grupos de opciones y opciones, y una función de validación.
-- Conserva las políticas existentes: la traducción viaja en la misma fila que el texto original, así que se lee y se
-- escribe con los mismos permisos (miembros con `org_can_write` escriben; el público solo ve lo publicado).
--
-- Forma: {"en": {"name": "Flat white", "description": "…"}, "pt": {…}}. El español es el texto original de la fila.
-- Cada campo es opcional; el que falta se muestra en español. Solo los platos tienen descripción.
--
-- Revertir (si no hay traducciones que perder):
--   alter table public.categories drop column translations; (y lo mismo en products, option_groups y options)
--   drop function private.translations_valid(jsonb, boolean);

create or replace function private.translations_valid(t jsonb, with_description boolean)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(t) = 'object'
    and not exists (
      select 1
      from jsonb_each(case when jsonb_typeof(t) = 'object' then t else '{}'::jsonb end) as lang(code, entry)
      where lang.code <> all (array['en', 'pt'])
         or jsonb_typeof(lang.entry) <> 'object'
         or lang.entry = '{}'::jsonb
         -- sin claves ajenas (la descripción solo existe en los platos)
         or exists (
              select 1
              from jsonb_object_keys(case when jsonb_typeof(lang.entry) = 'object' then lang.entry else '{}'::jsonb end) as k
              where k <> all (case when with_description then array['name', 'description'] else array['name'] end)
            )
         -- cada campo: texto sin espacios en los bordes y dentro del largo del original
         or (lang.entry ? 'name' and not (
               jsonb_typeof(lang.entry -> 'name') = 'string'
               and char_length(lang.entry ->> 'name') between 1 and 80
               and (lang.entry ->> 'name') = btrim(lang.entry ->> 'name')
             ))
         or (lang.entry ? 'description' and not (
               jsonb_typeof(lang.entry -> 'description') = 'string'
               and char_length(lang.entry ->> 'description') between 1 and 300
               and (lang.entry ->> 'description') = btrim(lang.entry ->> 'description')
             ))
    ),
    false
  );
$$;

comment on function private.translations_valid(jsonb, boolean) is
  'Valida la columna translations: idiomas en/pt, solo name (y description si with_description), textos de 1 a 80 (300) caracteres sin espacios en los bordes.';

-- Pura e inofensiva, pero la evalúa quien escribe (el CHECK corre con sus permisos): solo `authenticated` y el servicio.
revoke all on function private.translations_valid(jsonb, boolean) from public, anon;
grant execute on function private.translations_valid(jsonb, boolean) to authenticated, service_role;

alter table public.categories
  add column translations jsonb not null default '{}'::jsonb
    check (private.translations_valid(translations, false));
alter table public.products
  add column translations jsonb not null default '{}'::jsonb
    check (private.translations_valid(translations, true));
alter table public.option_groups
  add column translations jsonb not null default '{}'::jsonb
    check (private.translations_valid(translations, false));
alter table public.options
  add column translations jsonb not null default '{}'::jsonb
    check (private.translations_valid(translations, false));

comment on column public.categories.translations is 'Traducciones del nombre por idioma (en, pt). Vacío = solo español.';
comment on column public.products.translations is 'Traducciones del nombre y la descripción por idioma (en, pt). Vacío = solo español.';
comment on column public.option_groups.translations is 'Traducciones del nombre por idioma (en, pt). Vacío = solo español.';
comment on column public.options.translations is 'Traducciones del nombre por idioma (en, pt). Vacío = solo español.';

-- La lectura (anon y authenticated) ya es por tabla. La escritura es por columna: solo `translations` se suma a lo que
-- el panel ya podía escribir; ni el id, ni la organización, ni el padre cambian por la API (igual que antes).
grant insert (translations), update (translations) on public.categories to authenticated;
grant insert (translations), update (translations) on public.products to authenticated;
grant insert (translations), update (translations) on public.option_groups to authenticated;
grant insert (translations), update (translations) on public.options to authenticated;

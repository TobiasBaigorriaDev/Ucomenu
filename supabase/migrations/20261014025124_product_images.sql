-- Fotos de los platos (ficha agile/cambios/gestion-de-carta.md).
--
-- Solo aditiva: una columna nueva, un bucket y políticas sobre storage.objects; no toca datos.
-- Rollback (local): git revert + `pnpm db:reset`. En una base con datos: quitar la columna y las
-- políticas; los archivos del bucket se borran por la API de Storage (no por SQL: Storage lo impide).
--
-- Reglas de fondo:
--  * La ruta de una foto es `{organization_id}/{product_id}/{uuid}.{jpg|png|webp}`. La base la exige tanto
--    en products.image_path como en las políticas de Storage: un plato solo puede apuntar a un archivo
--    de SU carpeta, y solo se puede escribir en la carpeta de una organización propia.
--  * Escribir y borrar fotos sigue la misma regla que el resto del catálogo: miembro de la organización y
--    cuenta que puede escribir (org_can_write). En solo lectura y suspendida no se sube ni se borra nada.
--  * El bucket es público: la carta pública lee las fotos por URL. La lectura por API de las personas
--    autenticadas queda acotada a su organización (la necesita Storage para borrar).

-- ---------------------------------------------------------------------------
-- Columna
-- ---------------------------------------------------------------------------

alter table public.products add column image_path text;

alter table public.products add constraint products_image_path_own_folder
  check (
    image_path is null
    or image_path ~ (
      '^' || organization_id::text || '/' || id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
    )
  );

comment on column public.products.image_path is
  'Ruta del archivo en el bucket product-images: {organization_id}/{product_id}/{uuid}.{jpg|png|webp}. Nulo = sin foto.';

grant insert (image_path) on table public.products to authenticated;
grant update (image_path) on table public.products to authenticated;

-- ---------------------------------------------------------------------------
-- Bucket
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Políticas de storage.objects
-- ---------------------------------------------------------------------------

-- Devuelve la organización dueña de una ruta SOLO si la ruta tiene la forma exacta esperada; si no, nulo
-- (y is_org_member(null) es falso). Evita el error de conversión de un uuid mal formado dentro de una política.
create function private.product_image_org(object_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
    then split_part(object_name, '/', 1)::uuid
  end;
$$;

revoke all on function private.product_image_org(text) from public, anon, authenticated;
grant execute on function private.product_image_org(text) to authenticated;

create policy "product-images: los miembros leen las de su organización"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'product-images'
    and private.is_org_member(private.product_image_org(name))
  );

create policy "product-images: los miembros suben con la cuenta al día"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'product-images'
    and private.is_org_member(private.product_image_org(name))
    and private.org_can_write(private.product_image_org(name))
  );

create policy "product-images: los miembros borran con la cuenta al día"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'product-images'
    and private.is_org_member(private.product_image_org(name))
    and private.org_can_write(private.product_image_org(name))
  );

-- Sin política de UPDATE: una foto nunca se pisa (cada subida lleva un uuid nuevo).

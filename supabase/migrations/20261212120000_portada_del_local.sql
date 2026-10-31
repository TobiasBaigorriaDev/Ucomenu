-- Portada del local (nivel C, ADR 0050): una foto de ambiente que encabeza la carta pública.
-- Ficha: agile/cambios/personalizacion-ampliada-de-la-carta.md
--
-- Qué hace:
--  * `organizations.cover_path` (nulo = sin portada): la ruta de un archivo del bucket EXISTENTE `organization-logos`, con la misma
--    forma que `logo_path` (`{organización}/{uuid}.{jpg|png|webp}`, la de ESTA organización). No hay bucket ni políticas de Storage
--    nuevas: la portada hereda las del logo (solo el Dueño con cuenta editable sube y borra; lectura pública por ser un bucket
--    público; sin UPDATE, cada versión es un UUID nuevo) y entra sola en el borrado de organizaciones, el respaldo y la
--    configuración de imágenes, que ya recorren ese bucket.
--  * `cover_path` y `logo_path` nunca apuntan al MISMO archivo: el reemplazo borra de Storage la referencia saliente, y si una
--    fuera también la vigente de la otra, cambiar la portada borraría el logo. Lo garantiza un CHECK de fila.
--  * `replace_organization_cover(org, ruta)`: igual que `replace_organization_logo` (orden_e_imagenes_atomicos): bloquea la fila,
--    cambia la referencia (o la quita con NULL) y DEVUELVE la saliente tal como estaba. SECURITY INVOKER: manda la RLS de quien
--    llama (Dueño con cuenta editable). `anon` no puede ejecutarla ni tiene UPDATE.
--  * Permiso: `grant update (cover_path)` a `authenticated` + la política vigente de UPDATE de organizations.
--
-- Rollback (ORDEN OBLIGATORIO: primero se despliega el código anterior, que no llama a la función; después):
--   drop function public.replace_organization_cover(uuid, text);
--   revoke update (cover_path) on public.organizations from authenticated;
--   alter table public.organizations drop constraint organizations_cover_distinct_check, drop column cover_path;
--   Los archivos que quedaron en `organization-logos/{org}/` sin referencia hay que limpiarlos aparte (listar el bucket y comparar
--   con `logo_path`).
alter table public.organizations
  add column cover_path text
    check (cover_path is null or cover_path ~ (
      '^' || id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
    )),
  add constraint organizations_cover_distinct_check
    check (cover_path is null or logo_path is null or cover_path <> logo_path);

comment on column public.organizations.cover_path is
  'Ruta (en el bucket organization-logos) de la foto de portada de la carta. Distinta de logo_path. La escribe solo el Dueño, con replace_organization_cover.';

create function public.replace_organization_cover(p_org uuid, p_path text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_previous text;
begin
  select o.cover_path into v_previous from public.organizations o where o.id = p_org for update;
  if not found then
    return jsonb_build_object('updated', false);
  end if;
  update public.organizations set cover_path = p_path where id = p_org;
  if not found then
    return jsonb_build_object('updated', false);
  end if;
  return jsonb_build_object('updated', true, 'previous', v_previous);
end;
$$;
comment on function public.replace_organization_cover(uuid, text) is
  'Cambia (o quita, con NULL) la portada de una organización y devuelve la referencia saliente tal como estaba al bloquear la fila. SECURITY INVOKER: manda la RLS de quien llama.';

revoke all on function public.replace_organization_cover(uuid, text) from public, anon;
grant execute on function public.replace_organization_cover(uuid, text) to authenticated;

grant update (cover_path) on public.organizations to authenticated;

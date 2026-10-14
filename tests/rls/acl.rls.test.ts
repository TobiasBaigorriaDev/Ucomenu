import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * Comprobaciones de catálogo de la base: ACL y configuración de las funciones SECURITY DEFINER,
 * RLS activado y permisos por columna. La API REST no puede consultar `pg_catalog`, así que se
 * corre SQL dentro del contenedor local de Postgres (`project_id` de supabase/config.toml).
 * Requisitos: Docker encendido, `pnpm db:start` y `pnpm db:reset`.
 */

const CONTAINER = "supabase_db_ucomenu";

function sql(query: string): string[][] {
  let out: string;
  try {
    out = execFileSync("docker", ["exec", CONTAINER, "psql", "-U", "postgres", "-At", "-F", "|", "-c", query], {
      encoding: "utf8",
    });
  } catch (error) {
    throw new Error(`No se pudo consultar el contenedor ${CONTAINER}. ¿Está encendido (pnpm db:start)? ${String(error)}`);
  }
  return out
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.split("|"));
}

describe("funciones de autorización (esquema private)", () => {
  it("existen y todas son SECURITY DEFINER con search_path vacío, de propiedad de postgres", () => {
    const todas = sql(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' order by 1`,
    );
    expect(todas.flat()).toEqual(["is_org_member", "is_org_owner"]);

    const mal = sql(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private'
        and not (p.prosecdef
                 and coalesce(p.proconfig @> array['search_path=""'], false)
                 and pg_get_userbyid(p.proowner) = 'postgres')`);
    expect(mal).toEqual([]);
  });

  it("solo authenticated puede ejecutarlas; anon y public no, y anon no entra al esquema", () => {
    const privilegios = sql(`
      select p.proname,
             has_function_privilege('anon', p.oid, 'execute'),
             has_function_privilege('public', p.oid, 'execute'),
             has_function_privilege('authenticated', p.oid, 'execute')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' order by 1`);
    expect(privilegios).toEqual([
      ["is_org_member", "f", "f", "t"],
      ["is_org_owner", "f", "f", "t"],
    ]);

    const esquema = sql(`select has_schema_privilege('anon', 'private', 'usage'), has_schema_privilege('authenticated', 'private', 'usage')`);
    expect(esquema).toEqual([["f", "t"]]);
  });

  it("no hay funciones SECURITY DEFINER en el esquema expuesto (public)", () => {
    const expuestas = sql(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef`);
    expect(expuestas).toEqual([]);
  });
});

describe("RLS y permisos de tablas", () => {
  it("toda tabla del esquema public tiene RLS activado", () => {
    const sinRls = sql(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(sinRls).toEqual([]);
  });

  it("memberships: anon sin ningún permiso y authenticated solo con SELECT", () => {
    const permisos = (rol: string) =>
      sql(
        `select ${["select", "insert", "update", "delete", "truncate", "references", "trigger"]
          .map((p) => `has_table_privilege('${rol}', 'public.memberships', '${p}')`)
          .join(", ")}`,
      )[0];

    expect(permisos("anon")).toEqual(["f", "f", "f", "f", "f", "f", "f"]);
    expect(permisos("authenticated")).toEqual(["t", "f", "f", "f", "f", "f", "f"]);
  });

  it("organization_id, id, slug y is_active no son actualizables por la API", () => {
    const actualizables = sql(`
      select t.tabla, t.columna from (values
        ('organizations', 'id'), ('organizations', 'slug'), ('organizations', 'is_active'),
        ('branches', 'id'), ('branches', 'organization_id'), ('branches', 'slug'),
        ('categories', 'id'), ('categories', 'organization_id'),
        ('products', 'id'), ('products', 'organization_id'), ('products', 'currency')
      ) as t(tabla, columna)
      where has_column_privilege('authenticated', 'public.' || t.tabla, t.columna, 'update')
         or has_column_privilege('anon', 'public.' || t.tabla, t.columna, 'update')`);
    expect(actualizables).toEqual([]);
  });

  it("anon no tiene ningún permiso de escritura en las tablas de negocio", () => {
    const conEscritura = sql(`
      select t.tabla, p.permiso from (values ('organizations'), ('branches'), ('categories'), ('products'), ('memberships')) as t(tabla)
      cross join (values ('insert'), ('update'), ('delete'), ('truncate')) as p(permiso)
      where has_table_privilege('anon', 'public.' || t.tabla, p.permiso)`);
    expect(conEscritura).toEqual([]);
  });

  it("authenticated no puede crear ni borrar organizaciones, sucursales ni membresías", () => {
    const conPermiso = sql(`
      select t.tabla, p.permiso from (values ('organizations'), ('branches'), ('memberships')) as t(tabla)
      cross join (values ('insert'), ('delete'), ('truncate')) as p(permiso)
      where has_table_privilege('authenticated', 'public.' || t.tabla, p.permiso)`);
    expect(conPermiso).toEqual([]);
  });
});

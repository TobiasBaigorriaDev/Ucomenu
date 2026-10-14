import { describe, expect, it } from "vitest";
import { sql } from "./helpers";

/**
 * Comprobaciones de catálogo de la base: ACL y configuración de las funciones SECURITY DEFINER,
 * RLS activado y permisos por columna. La API REST no puede consultar `pg_catalog`, así que se
 * corre SQL dentro del contenedor local de Postgres (`project_id` de supabase/config.toml).
 * Requisitos: Docker encendido, `pnpm db:start` y `pnpm db:reset`.
 */

// Matriz cerrada de funciones: cualquier función nueva hace fallar la prueba hasta que se la declare acá,
// con sus permisos a propósito. Columnas: [definer, anon, public, authenticated].
const PRIVATE_FUNCTIONS: Record<string, [definer: boolean, anon: boolean, authenticated: boolean]> = {
  billing_state: [false, false, false], // pura; solo la usan otras funciones
  create_trial_subscription: [true, false, false], // trigger
  enforce_branch_limit: [true, false, false], // trigger
  enforce_product_limit: [true, false, false], // trigger
  has_feature: [true, false, false],
  is_org_member: [true, false, true], // usada por políticas
  is_org_owner: [true, false, true], // usada por políticas
  org_can_write: [true, false, true], // usada por políticas de escritura
  org_is_published: [true, true, true], // usada por las políticas de lectura pública (anon incluido)
  org_limit: [true, false, false],
  org_state: [true, false, false],
  plan_grants: [true, false, false],
};

// Las únicas funciones de la API (RPC). SECURITY DEFINER a propósito; ver ADR 0006.
const PUBLIC_FUNCTIONS: Record<string, [anon: boolean, authenticated: boolean]> = {
  org_entitlements: [false, true],
  public_menu_status: [true, true],
};

describe("funciones de autorización y entitlements", () => {
  it("el esquema private tiene exactamente las funciones esperadas", () => {
    const todas = sql(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' order by 1`,
    );
    expect(todas.flat()).toEqual(Object.keys(PRIVATE_FUNCTIONS).sort());
  });

  it("todas fijan search_path vacío y son de postgres; SECURITY DEFINER donde corresponde", () => {
    const filas = sql(`
      select p.proname, p.prosecdef,
             coalesce(p.proconfig @> array['search_path=""'], false),
             pg_get_userbyid(p.proowner) = 'postgres'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('private', 'public') order by 1`);

    for (const [nombre, definer, searchPath, postgres] of filas) {
      const esperado = PRIVATE_FUNCTIONS[nombre] ?? undefined;
      expect(searchPath, `${nombre}: search_path vacío`).toBe("t");
      expect(postgres, `${nombre}: propietaria postgres`).toBe("t");
      if (esperado) expect(definer, `${nombre}: SECURITY DEFINER`).toBe(esperado[0] ? "t" : "f");
      else expect(definer, `${nombre}: SECURITY DEFINER en la API`).toBe("t");
    }
  });

  it("EXECUTE de las funciones de private coincide con la matriz (public nunca)", () => {
    const filas = sql(`
      select p.proname,
             has_function_privilege('anon', p.oid, 'execute'),
             has_function_privilege('public', p.oid, 'execute'),
             has_function_privilege('authenticated', p.oid, 'execute')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' order by 1`);

    for (const [nombre, anon, publico, authenticated] of filas) {
      const [, anonOk, authOk] = PRIVATE_FUNCTIONS[nombre];
      expect(anon, `${nombre}: anon`).toBe(anonOk ? "t" : "f");
      expect(publico, `${nombre}: public`).toBe("f");
      expect(authenticated, `${nombre}: authenticated`).toBe(authOk ? "t" : "f");
    }
  });

  it("las funciones de public son exactamente las dos de la API, con sus permisos", () => {
    const filas = sql(`
      select p.proname,
             has_function_privilege('anon', p.oid, 'execute'),
             has_function_privilege('public', p.oid, 'execute'),
             has_function_privilege('authenticated', p.oid, 'execute')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' order by 1`);

    expect(filas.map((f) => f[0])).toEqual(Object.keys(PUBLIC_FUNCTIONS).sort());
    for (const [nombre, anon, publico, authenticated] of filas) {
      const [anonOk, authOk] = PUBLIC_FUNCTIONS[nombre];
      expect(anon, `${nombre}: anon`).toBe(anonOk ? "t" : "f");
      expect(publico, `${nombre}: public`).toBe("f");
      expect(authenticated, `${nombre}: authenticated`).toBe(authOk ? "t" : "f");
    }
  });

  it("anon puede usar el esquema private solo para evaluar las políticas públicas", () => {
    const esquema = sql(
      `select has_schema_privilege('anon', 'private', 'usage'), has_schema_privilege('authenticated', 'private', 'usage'), has_schema_privilege('public', 'private', 'usage')`,
    );
    expect(esquema).toEqual([["t", "t", "f"]]);
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

  it("planes y suscripciones: anon sin permisos y authenticated solo con SELECT", () => {
    const permisos = (rol: string, tabla: string) =>
      sql(
        `select ${["select", "insert", "update", "delete", "truncate"]
          .map((p) => `has_table_privilege('${rol}', 'public.${tabla}', '${p}')`)
          .join(", ")}`,
      )[0];

    for (const tabla of ["plans", "addons", "subscriptions", "subscription_addons"]) {
      expect(permisos("anon", tabla), `${tabla}: anon`).toEqual(["f", "f", "f", "f", "f"]);
      expect(permisos("authenticated", tabla), `${tabla}: authenticated`).toEqual(["t", "f", "f", "f", "f"]);
    }
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

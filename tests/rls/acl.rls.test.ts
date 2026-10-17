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
  can_attend_calls: [true, false, true], // usada por la política de UPDATE de waiter_calls (panel de sala)
  create_trial_subscription: [true, false, false], // trigger
  enforce_branch_limit: [true, false, false], // trigger
  keep_branch_slug_history: [false, false, false], // trigger invocador; no amplía permisos de sucursales
  enforce_product_limit: [true, false, false], // trigger
  guard_last_owner: [true, false, false], // trigger de memberships (ADR 0007)
  has_feature: [true, false, false],
  is_org_member: [true, false, true], // usada por políticas
  is_org_owner: [true, false, true], // usada por políticas
  org_can_write: [true, false, true], // usada por políticas de escritura
  org_is_published: [true, true, true], // usada por las políticas de lectura pública (anon incluido)
  org_limit: [true, false, false],
  org_state: [true, false, false],
  plan_grants: [true, false, false],
  enforce_table_limit: [true, false, false], // trigger de tables (ADR 0006 / mesas y QR)
  stamp_attended_call: [false, false, false], // trigger de waiter_calls: fija attended_at y attended_by (panel de sala)
  rotate_table_token: [false, false, false], // trigger de tables: regenera qr_token (ADR 0009)
  limit_table_mute: [false, false, false], // trigger de tables: un silencio dura como máximo 24 horas (configuración del llamado)
  product_image_org: [false, false, true], // pura; la usan las políticas de storage.objects de product-images (ADR 0008)
  organization_logo_org: [false, false, true], // pura; solo las políticas de logos del Dueño
  record_price_change: [true, false, false], // trigger de products: escribe price_history (la API no tiene INSERT)
  price_history_append_only: [false, false, false], // trigger de price_history: rechaza UPDATE, DELETE y TRUNCATE
  audit_log_append_only: [false, false, false], // trigger de audit_log: rechaza UPDATE, DELETE y TRUNCATE (SuperAdmin)
  is_platform_admin: [true, false, true], // usada por la política de lectura de audit_log y de payments (SuperAdmin)
  payments_append_only: [false, false, false], // trigger de payments: rechaza UPDATE, DELETE y TRUNCATE (SuperAdmin)
  trial_status: [false, false, false], // pura; la usa org_entitlements (estado de la prueba gratuita)
  enforce_option_group_cap: [false, false, false], // trigger de option_groups: tope técnico de 20 grupos por plato (variantes y adicionales)
  enforce_option_cap: [false, false, false], // trigger de options: tope técnico de 60 opciones por grupo (variantes y adicionales)
};

// Las únicas funciones de la API (RPC). SECURITY DEFINER a propósito; ver ADR 0006.
const PUBLIC_FUNCTIONS: Record<string, [anon: boolean, authenticated: boolean]> = {
  admin_add_owner: [false, false], // SuperAdmin (ficha dueno-existente): suma una cuenta existente como Dueño; solo service_role
  admin_change_plan: [false, false], // SuperAdmin (ficha superadmin-planes-pagos): solo service_role, desde la acción de servidor
  admin_create_organization: [false, false], // SuperAdmin (ADR 0013): solo service_role, desde la acción de servidor
  admin_register_payment: [false, false], // SuperAdmin: registra un pago y mueve la vigencia; solo service_role
  admin_set_suspension: [false, false], // SuperAdmin: suspende o reactiva a mano; solo service_role
  create_waiter_call: [true, true], // única puerta de escritura de waiter_calls; público, valida adentro (ADR 0010)
  org_entitlements: [false, true],
  public_menu_status: [true, true],
  purge_waiter_calls: [false, false], // purga por antigüedad (ADR 0014): solo service_role
  resolve_table_qr: [true, true], // entrada pública /t/{token} (ADR 0009): anon no lee public.tables
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

  it("price_history: anon sin permisos; authenticated y service_role solo con SELECT (se escribe por trigger)", () => {
    const permisos = (rol: string) =>
      sql(
        `select ${["select", "insert", "update", "delete", "truncate", "references", "trigger"]
          .map((p) => `has_table_privilege('${rol}', 'public.price_history', '${p}')`)
          .join(", ")}`,
      )[0];

    expect(permisos("anon")).toEqual(["f", "f", "f", "f", "f", "f", "f"]);
    expect(permisos("authenticated")).toEqual(["t", "f", "f", "f", "f", "f", "f"]);
    expect(permisos("service_role")).toEqual(["t", "f", "f", "f", "f", "f", "f"]);
  });

  it("las acciones de SuperAdmin (alta, Dueño existente, plan, suspensión, pago): solo service_role puede ejecutarlas", () => {
    const filas = sql(`
      select p.proname, has_function_privilege('anon', p.oid, 'execute'), has_function_privilege('authenticated', p.oid, 'execute'),
             has_function_privilege('public', p.oid, 'execute'), has_function_privilege('service_role', p.oid, 'execute')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'admin\_%' order by 1`);
    expect(filas).toEqual([
      ["admin_add_owner", "f", "f", "f", "t"],
      ["admin_change_plan", "f", "f", "f", "t"],
      ["admin_create_organization", "f", "f", "f", "t"],
      ["admin_register_payment", "f", "f", "f", "t"],
      ["admin_set_suspension", "f", "f", "f", "t"],
    ]);
  });

  it("platform_admins, audit_log y payments: anon sin permisos; authenticated solo lee; service_role solo lee (nada escribe por la API)", () => {
    const permisos = (rol: string, tabla: string) =>
      sql(
        `select ${["select", "insert", "update", "delete", "truncate", "references", "trigger"]
          .map((p) => `has_table_privilege('${rol}', 'public.${tabla}', '${p}')`)
          .join(", ")}`,
      )[0];

    for (const tabla of ["platform_admins", "audit_log", "payments"]) {
      expect(permisos("anon", tabla), `${tabla}: anon`).toEqual(["f", "f", "f", "f", "f", "f", "f"]);
      expect(permisos("authenticated", tabla), `${tabla}: authenticated`).toEqual(["t", "f", "f", "f", "f", "f", "f"]);
      expect(permisos("service_role", tabla), `${tabla}: service_role`).toEqual(["t", "f", "f", "f", "f", "f", "f"]);
    }
  });

  it("organization_id, id, slug y is_active no son actualizables por la API", () => {
    const actualizables = sql(`
      select t.tabla, t.columna from (values
        ('organizations', 'id'), ('organizations', 'slug'), ('organizations', 'is_active'),
        ('branches', 'id'), ('branches', 'organization_id'), ('branches', 'slug'),
        ('categories', 'id'), ('categories', 'organization_id'),
        ('products', 'id'), ('products', 'organization_id'), ('products', 'currency'),
        ('option_groups', 'id'), ('option_groups', 'organization_id'), ('option_groups', 'product_id'), ('option_groups', 'created_at'),
        ('options', 'id'), ('options', 'organization_id'), ('options', 'group_id'), ('options', 'created_at')
      ) as t(tabla, columna)
      where has_column_privilege('authenticated', 'public.' || t.tabla, t.columna, 'update')
         or has_column_privilege('anon', 'public.' || t.tabla, t.columna, 'update')`);
    expect(actualizables).toEqual([]);
  });

  it("las únicas columnas de mesas, sucursales y llamados que la API actualiza son las previstas (configuración del llamado)", () => {
    const columnas = (rol: string) =>
      sql(`
        select table_name, column_name from information_schema.column_privileges
        where grantee = '${rol}' and privilege_type = 'UPDATE' and table_schema = 'public'
          and table_name in ('tables', 'branches', 'waiter_calls')
        order by table_name, column_name`);

    expect(columnas("authenticated")).toEqual([
      ["branches", "is_active"], // solo el Dueño y con la cuenta al día, por la política de branches (ficha desactivar-sucursales)
      ["branches", "name"],
      ["branches", "waiter_call_cooldown_seconds"], // solo el Dueño, por la política de branches
      ["tables", "is_active"],
      ["tables", "label"],
      ["tables", "muted_until"], // Dueño y Staff; un trigger limita el silencio a 24 horas
      ["tables", "qr_token"],
      ["waiter_calls", "status"], // solo pending → attended, por política
    ]);
    expect(columnas("anon")).toEqual([]);
  });

  it("anon no tiene ningún permiso de escritura en las tablas de negocio", () => {
    const conEscritura = sql(`
      select t.tabla, p.permiso from (values ('organizations'), ('branches'), ('categories'), ('products'), ('memberships'), ('option_groups'), ('options')) as t(tabla)
      cross join (values ('insert'), ('update'), ('delete'), ('truncate')) as p(permiso)
      where has_table_privilege('anon', 'public.' || t.tabla, p.permiso)`);
    expect(conEscritura).toEqual([]);
  });

  it("authenticated no tiene INSERT ni DELETE de tabla completa en organizaciones, sucursales ni membresías (el alta de sucursales es por columna, abajo)", () => {
    const conPermiso = sql(`
      select t.tabla, p.permiso from (values ('organizations'), ('branches'), ('memberships')) as t(tabla)
      cross join (values ('insert'), ('delete'), ('truncate')) as p(permiso)
      where has_table_privilege('authenticated', 'public.' || t.tabla, p.permiso)`);
    expect(conPermiso).toEqual([]);
  });

  it("las únicas columnas de sucursales que la API inserta son organization_id, slug y name (gestión de sucursales)", () => {
    const columnas = (rol: string) =>
      sql(`
        select column_name from information_schema.column_privileges
        where grantee = '${rol}' and privilege_type = 'INSERT' and table_schema = 'public' and table_name = 'branches'
        order by column_name`);

    expect(columnas("authenticated")).toEqual([["name"], ["organization_id"], ["slug"]]);
    expect(columnas("anon")).toEqual([]);
  });
});

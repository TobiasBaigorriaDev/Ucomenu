import { spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCategory, createProduct, loadCarta, moveCategory, moveProduct } from "@/lib/carta/catalog";
import { loadGuideCounts } from "@/lib/guia/primeros-pasos";
import { loadLlamadoConfig } from "@/lib/llamados/config";
import { loadMesas } from "@/lib/mesas/tables";
import { loadSala } from "@/lib/sala/pending";
import {
  addMembership,
  anonClient,
  createOrg,
  createUser,
  deleteOrg,
  deleteUser,
  serviceClient,
  setSubscription,
  DIA_MS,
  sql,
  type Db,
  type PlanCode,
  type TestUser,
} from "./helpers";

/**
 * Listas de más de 1000 filas y reordenamientos atómicos (nivel C, ficha orden-e-imagenes-atomicos) contra el Supabase local.
 *  - PostgREST corta cada lectura en 1000 filas SIN avisar: las lecturas «de todo» van por páginas con orden estable. Los
 *    inactivos no cuentan para los topes del plan, así que un local puede tener más de 1000 y el tope comercial (activos) no
 *    tiene nada que ver con el corte de la respuesta.
 *  - Un reordenamiento cambia todas las posiciones o ninguna; dos movimientos simultáneos se aplican uno detrás del otro; la
 *    autorización y el aislamiento siguen siendo los de la RLS de quien llama.
 */

const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let service: Db;
let owner: TestUser;
let staff: TestUser;
let otro: TestUser; // Dueño de otro local
const orgs: string[] = [];
const users: TestUser[] = [];
let contador = 0;

async function nuevaOrg(plan: PlanCode = "pro") {
  contador += 1;
  const id = await createOrg(service, `tt-lyo-${sufijo}-${contador}`, plan);
  orgs.push(id);
  await setSubscription(service, id, { finEnMs: 5 * DIA_MS });
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  return id;
}

/** Inserta filas de a tandas (un solo pedido por tanda). */
async function insertarEnTandas<T extends object>(tabla: "categories" | "products" | "tables", filas: T[]) {
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await service.from(tabla).insert(filas.slice(i, i + 500) as never);
    if (error) throw new Error(`No se pudo sembrar ${tabla}: ${error.message}`);
  }
}

/** Las posiciones, ordenadas (el orden por id no significa nada). */
const posiciones = (tabla: string, donde: string) =>
  sql(`select sort_order from public.${tabla} where ${donde} order by sort_order`).map((f) => Number(f[0]));
const idEnPosicion = (tabla: string, donde: string, n: number) =>
  sql(`select id from public.${tabla} where ${donde} and sort_order = ${n}`)[0]?.[0];

beforeAll(async () => {
  service = serviceClient();
  owner = await createUser(service, "lyo-owner");
  staff = await createUser(service, "lyo-staff");
  otro = await createUser(service, "lyo-otro");
  users.push(owner, staff, otro);
});

afterAll(async () => {
  for (const id of orgs) await deleteOrg(service, id);
  for (const u of users) await deleteUser(service, u);
});

describe("listas de más de 1000 filas", () => {
  it("loadCarta devuelve todas las categorías y platos, activos e inactivos; el tope del plan cuenta solo los activos", async () => {
    const org = await nuevaOrg("pro"); // tope: 200 platos ACTIVOS
    await insertarEnTandas(
      "categories",
      Array.from({ length: 1050 }, (_, i) => ({ organization_id: org, name: `Cat ${String(i).padStart(4, "0")}`, sort_order: i, is_active: i % 3 !== 0 })),
    );
    const cats = (await service.from("categories").select("id, sort_order").eq("organization_id", org).in("sort_order", [0, 1])).data!;
    const primera = cats.find((c) => c.sort_order === 0)!.id;
    const segunda = cats.find((c) => c.sort_order === 1)!.id;
    // 1.020 platos inactivos en una categoría (sin tope) y 30 activos en otra (muy por debajo del tope).
    await insertarEnTandas(
      "products",
      Array.from({ length: 1020 }, (_, i) => ({ organization_id: org, category_id: primera, name: `Ina ${i}`, price_cents: 1000, sort_order: i, is_active: false })),
    );
    await insertarEnTandas(
      "products",
      Array.from({ length: 30 }, (_, i) => ({ organization_id: org, category_id: segunda, name: `Act ${i}`, price_cents: 1000, sort_order: i, is_active: true })),
    );

    const carta = await loadCarta(owner.db, org);

    expect(carta).toHaveLength(1050);
    expect(carta.reduce((n, c) => n + c.products.length, 0)).toBe(1050);
    expect(carta.find((c) => c.id === primera)!.products).toHaveLength(1020);
    expect(carta.filter((c) => c.is_active)).toHaveLength(700);
    // Sin duplicados ni faltantes, y en el orden en que se ve.
    expect(new Set(carta.map((c) => c.id)).size).toBe(1050);
    expect(carta.map((c) => c.sort_order)).toEqual([...carta.map((c) => c.sort_order)].sort((a, b) => a - b));
    // El tope comercial sigue siendo de ACTIVOS: hay lugar para 170 más aunque el local tenga 1.050 platos.
    const nuevo = await createProduct(owner.db, org, { categoryId: segunda, name: "Otro activo", description: "", price: "10", active: true });
    expect(nuevo.ok).toBe(true);
  });

  it("crear y mover en una lista larga usa la lista completa (posición nueva = máxima + 1; mover cerca del final)", async () => {
    const org = await nuevaOrg("pro");
    await insertarEnTandas(
      "categories",
      Array.from({ length: 1100 }, (_, i) => ({ organization_id: org, name: `Cat ${String(i).padStart(4, "0")}`, sort_order: i })),
    );

    const creada = await createCategory(owner.db, org, { name: "Nueva al final" });
    expect(creada.ok).toBe(true);
    if (!creada.ok) return;
    expect(sql(`select sort_order from public.categories where id = '${creada.data.id}'`)[0][0]).toBe("1100");

    const donde = `organization_id = '${org}'`;
    const en1050 = idEnPosicion("categories", donde, 1050);
    const en1049 = idEnPosicion("categories", donde, 1049);
    expect((await moveCategory(owner.db, org, en1050, "up")).ok).toBe(true);
    expect(idEnPosicion("categories", donde, 1049)).toBe(en1050);
    expect(idEnPosicion("categories", donde, 1050)).toBe(en1049);
    // Nada más se movió: sigue habiendo 1.101 posiciones distintas, de 0 a 1100.
    expect(new Set(posiciones("categories", donde)).size).toBe(1101);
  });

  it("mover platos en una categoría de más de 1000 platos", async () => {
    const org = await nuevaOrg("pro");
    const cat = await createCategory(owner.db, org, { name: "Larga" });
    if (!cat.ok) throw new Error("categoría");
    await insertarEnTandas(
      "products",
      Array.from({ length: 1030 }, (_, i) => ({ organization_id: org, category_id: cat.data.id, name: `P ${String(i).padStart(4, "0")}`, price_cents: 100, sort_order: i, is_active: false })),
    );
    const donde = `organization_id = '${org}'`;
    const ultimo = idEnPosicion("products", donde, 1029);
    const anterior = idEnPosicion("products", donde, 1028);

    expect((await moveProduct(owner.db, org, ultimo, "up")).ok).toBe(true);

    expect(idEnPosicion("products", donde, 1028)).toBe(ultimo);
    expect(idEnPosicion("products", donde, 1029)).toBe(anterior);
  });

  async function localConMuchasMesas(plan: PlanCode = "pro") {
    const org = await nuevaOrg(plan);
    const sucursales = await service
      .from("branches")
      .insert([
        { organization_id: org, slug: "centro", name: "Centro", is_active: true },
        { organization_id: org, slug: "norte", name: "Norte", is_active: true },
        { organization_id: org, slug: "vieja", name: "Vieja", is_active: false },
      ])
      .select("id, slug");
    if (sucursales.error) throw new Error(sucursales.error.message);
    const por = (slug: string) => sucursales.data.find((b) => b.slug === slug)!.id;
    await insertarEnTandas("tables", [
      // Mesas INACTIVAS: no cuentan para el tope del plan, así que pueden pasar de 1000.
      ...Array.from({ length: 1030 }, (_, i) => ({ organization_id: org, branch_id: por("centro"), label: `Mesa ${String(i + 1).padStart(4, "0")}`, is_active: false })),
      ...Array.from({ length: 12 }, (_, i) => ({ organization_id: org, branch_id: por("centro"), label: `Activa ${String(i + 1).padStart(2, "0")}`, is_active: true })),
      ...Array.from({ length: 5 }, (_, i) => ({ organization_id: org, branch_id: por("norte"), label: `Norte ${i + 1}`, is_active: true })),
      ...Array.from({ length: 3 }, (_, i) => ({ organization_id: org, branch_id: por("vieja"), label: `Vieja ${i + 1}`, is_active: true })),
    ]);
    return { org, centro: por("centro"), norte: por("norte") };
  }

  it("loadMesas devuelve todas las mesas de las sucursales activas (más de 1000, activas e inactivas)", async () => {
    const { org } = await localConMuchasMesas();

    const sucursales = await loadMesas(owner.db, org);

    expect(sucursales.map((s) => [s.name, s.tables.length])).toEqual([["Centro", 1042], ["Norte", 5]]);
    const centro = sucursales[0].tables;
    expect(new Set(centro.map((t) => t.id)).size).toBe(1042);
    expect(centro.filter((t) => t.is_active)).toHaveLength(12);
  });

  it("loadLlamadoConfig devuelve todas las mesas (más de 1000) con su silencio", async () => {
    const { org } = await localConMuchasMesas();

    const sucursales = await loadLlamadoConfig(owner.db, org);

    expect(sucursales.map((s) => [s.name, s.tables.length])).toEqual([["Centro", 1042], ["Norte", 5]]);
    expect(new Set(sucursales[0].tables.map((t) => t.id)).size).toBe(1042);
  });

  it("la guía de primeros pasos cuenta todas las mesas (más de 1000), no las primeras 1000", async () => {
    const { org } = await localConMuchasMesas();

    const cuentas = await loadGuideCounts(owner.db, org);

    expect(cuentas.tables).toBe(1047); // las de las sucursales activas; las 3 de la inactiva no cuentan
    expect(cuentas.activeTables).toBe(17);
  });

  it("loadSala lista todos los llamados pendientes (más de 1000) con la etiqueta de su mesa", async () => {
    const { org, centro } = await localConMuchasMesas();
    const mesas = sql(`select id from public.tables where organization_id = '${org}' and branch_id = '${centro}' and label like 'Mesa %'`).map((f) => ({ id: f[0] }));
    expect(mesas.length).toBe(1030);
    for (let i = 0; i < mesas.length; i += 500) {
      const { error } = await service
        .from("waiter_calls")
        .insert(mesas.slice(i, i + 500).map((m) => ({ organization_id: org, branch_id: centro, table_id: m.id, kind: "waiter" as const })));
      if (error) throw new Error(error.message);
    }

    const sala = await loadSala(owner.db, org);

    expect(sala.enabled).toBe(true);
    expect(sala.calls).toHaveLength(1030);
    expect(new Set(sala.calls.map((c) => c.id)).size).toBe(1030);
    // Cada llamado encontró su mesa (las etiquetas se piden de a tandas): ninguno cae en el «Mesa» genérico.
    expect(sala.calls.every((c) => /^Mesa \d{4}$/.test(c.tableLabel))).toBe(true);
    // Del más antiguo al más nuevo.
    const horas = sala.calls.map((c) => c.createdAt);
    expect(horas).toEqual([...horas].sort());
  });
});

describe("reordenamiento atómico", () => {
  async function conCategorias(n: number, empates = false) {
    const org = await nuevaOrg("pro");
    await insertarEnTandas(
      "categories",
      Array.from({ length: n }, (_, i) => ({ organization_id: org, name: `Cat ${i}`, sort_order: empates ? 0 : i })),
    );
    const filas = (await service.from("categories").select("id, name, sort_order").eq("organization_id", org)).data!;
    const porNombre = (nombre: string) => filas.find((f) => f.name === nombre)!.id;
    return { org, donde: `organization_id = '${org}'`, porNombre };
  }

  const orden = (donde: string) => sql(`select name from public.categories where ${donde} order by sort_order, name`).map((f) => f[0]);

  it("si falla una escritura del medio no queda NINGUNA posición cambiada", async () => {
    // Todas con la misma posición: mover una obliga a renumerar a casi todas.
    const { org, donde, porNombre } = await conCategorias(6, true);
    const falla = porNombre("Cat 4");
    sql(`create schema if not exists tt_orden`);
    sql(`create or replace function tt_orden.boom() returns trigger language plpgsql as $$ begin raise exception 'boom' using errcode = 'XX000'; end $$`);
    sql(`create trigger tt_boom before update of sort_order on public.categories for each row when (new.id = '${falla}') execute function tt_orden.boom()`);
    try {
      const r = await moveCategory(owner.db, org, porNombre("Cat 2"), "up");
      expect(r).toEqual({ ok: false, error: "unexpected" });
      expect(posiciones("categories", donde)).toEqual([0, 0, 0, 0, 0, 0]); // todas igual que antes
    } finally {
      sql(`drop trigger if exists tt_boom on public.categories`);
      sql(`drop function if exists tt_orden.boom()`);
    }
    // Sin el fallo, el mismo movimiento se aplica completo.
    expect((await moveCategory(owner.db, org, porNombre("Cat 2"), "up")).ok).toBe(true);
    expect(new Set(posiciones("categories", donde)).size).toBe(6);
  });

  it("dos movimientos que se cruzan (el otro entra entre mi lectura y mi escritura) quedan aplicados los dos", async () => {
    const { org, porNombre } = await conCategorias(4);
    const [a, , c] = ["Cat 0", "Cat 1", "Cat 2"].map(porNombre);
    let colado = false;
    const db: Db = new Proxy(owner.db, {
      get(target, prop, receiver) {
        if (prop === "rpc") {
          return async (fn: string, args: unknown) => {
            if (fn === "reorder_siblings" && !colado) {
              colado = true;
              // Otra persona sube «Cat 2» justo antes de que esta escriba su movimiento (calculado sobre el orden viejo).
              expect((await moveCategory(staff.db, org, c, "up")).ok).toBe(true);
            }
            return (target.rpc as (...a: unknown[]) => unknown)(fn, args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const r = await moveCategory(db, org, a, "down"); // Cat 0 baja: [1, 0, 2, 3] sobre el estado que leyó

    expect(r.ok).toBe(true);
    expect(colado).toBe(true);
    // Primero el movimiento del otro: [0, 2, 1, 3]; después «Cat 0 baja» sobre ESE estado: [2, 0, 1, 3]. Ninguno se pierde.
    expect(orden(`organization_id = '${org}'`)).toEqual(["Cat 2", "Cat 0", "Cat 1", "Cat 3"]);
  });

  it("varios movimientos realmente simultáneos dejan posiciones únicas y contiguas, y todos terminan bien", async () => {
    const { org, donde, porNombre } = await conCategorias(10);
    const movimientos = [
      moveCategory(owner.db, org, porNombre("Cat 1"), "up"),
      moveCategory(staff.db, org, porNombre("Cat 3"), "down"),
      moveCategory(owner.db, org, porNombre("Cat 5"), "up"),
      moveCategory(staff.db, org, porNombre("Cat 8"), "down"),
    ];

    const resultados = await Promise.all(movimientos);

    expect(resultados.map((r) => r.ok)).toEqual([true, true, true, true]);
    expect(posiciones("categories", donde).sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("una transacción que tiene bloqueados a los hermanos hace esperar al movimiento, que después se aplica", async () => {
    const { org, porNombre } = await conCategorias(3);
    const contenedor = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_ucomenu";
    const retenedor = spawn("docker", ["exec", "-i", contenedor, "psql", "-U", "postgres", "-q"], { stdio: ["pipe", "ignore", "ignore"] });
    const terminado = new Promise((resolve) => retenedor.on("close", resolve));
    retenedor.stdin.write(`begin; select id from public.categories where organization_id = '${org}' order by id for update;${String.fromCharCode(10)}`);
    const hasta = async (consulta: string) => {
      for (let i = 0; i < 100; i++) {
        if (sql(consulta)[0]?.[0] === "1") return;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`No se alcanzó: ${consulta}`);
    };
    await hasta(`select (count(*) > 0)::int from pg_stat_activity where state = 'idle in transaction' and query ilike '%${org}%for update%'`);

    const pedido = moveCategory(owner.db, org, porNombre("Cat 2"), "up");
    await hasta(`select (count(*) > 0)::int from pg_stat_activity where wait_event_type = 'Lock' and query ilike '%reorder_siblings%' and pid <> pg_backend_pid()`);
    retenedor.stdin.end(`commit;${String.fromCharCode(10)}`);
    const r = await pedido;
    await terminado;

    expect(r.ok).toBe(true);
    expect(orden(`organization_id = '${org}'`)).toEqual(["Cat 0", "Cat 2", "Cat 1"]);
  });

  describe("autorización y aislamiento (los manda la RLS de quien llama)", () => {
    const args = (org: string, filas: { id: string; sort_order: number }[], final: string[], tabla = "categories") => ({
      p_table: tabla,
      p_org: org,
      p_scope: org,
      p_current: filas,
      p_final: final,
    });

    it("anon no puede llamarla; otro local y otra organización no cambian nada; el Staff sí (como con las demás escrituras)", async () => {
      const { org, donde, porNombre } = await conCategorias(3);
      const filas = [0, 1, 2].map((i) => ({ id: porNombre(`Cat ${i}`), sort_order: i }));
      const invertido = [filas[2].id, filas[1].id, filas[0].id];

      expect((await anonClient().rpc("reorder_siblings", args(org, filas, invertido))).error?.code).toBe("42501");
      // Dueño de OTRO local: no ve ni bloquea nada de este: 42501, sin cambios.
      const ajeno = await otro.db.rpc("reorder_siblings", args(org, filas, invertido));
      expect(ajeno.error?.code).toBe("42501");
      expect(posiciones("categories", donde)).toEqual([0, 1, 2]);
      // El Staff sí puede reordenar la carta de su local.
      expect((await staff.db.rpc("reorder_siblings", args(org, filas, invertido))).error).toBeNull();
      expect(posiciones("categories", donde).sort()).toEqual([0, 1, 2]);
      expect(orden(donde)).toEqual(["Cat 2", "Cat 1", "Cat 0"]);
    });

    it("con la cuenta en solo lectura no cambia nada y el error no es un éxito", async () => {
      const { org, donde, porNombre } = await conCategorias(3);
      await setSubscription(service, org, { finEnMs: -20 * DIA_MS });
      const filas = [0, 1, 2].map((i) => ({ id: porNombre(`Cat ${i}`), sort_order: i }));

      const directo = await owner.db.rpc("reorder_siblings", args(org, filas, [filas[2].id, filas[1].id, filas[0].id]));
      const modulo = await moveCategory(owner.db, org, filas[2].id, "up");

      expect(directo.error?.code).toBe("42501");
      expect(modulo.ok).toBe(false);
      expect(posiciones("categories", donde)).toEqual([0, 1, 2]);
    });

    it("rechaza un orden que no es una permutación de los hermanos, ids ajenos y tablas que no existen", async () => {
      const { org, donde, porNombre } = await conCategorias(3);
      const filas = [0, 1, 2].map((i) => ({ id: porNombre(`Cat ${i}`), sort_order: i }));
      const ajena = await nuevaOrg("pro");
      const idAjeno = (await createCategory(owner.db, ajena, { name: "Ajena" })) as { ok: true; data: { id: string } };

      for (const final of [[filas[0].id, filas[1].id], [filas[0].id, filas[0].id, filas[1].id], [filas[0].id, filas[1].id, idAjeno.data.id]]) {
        const r = await owner.db.rpc("reorder_siblings", args(org, filas, final));
        expect(r.error?.code, JSON.stringify(final)).toBe("22023");
      }
      const tabla = await owner.db.rpc("reorder_siblings", args(org, filas, filas.map((f) => f.id), "memberships"));
      expect(tabla.error?.code).toBe("22023");
      expect(posiciones("categories", donde)).toEqual([0, 1, 2]);
      expect(posiciones("categories", `organization_id = '${ajena}'`)).toEqual([0]);
    });

    it("un orden leído que ya no coincide se rechaza (55000) sin cambiar nada", async () => {
      const { org, donde, porNombre } = await conCategorias(3);
      const viejo = [0, 1, 2].map((i) => ({ id: porNombre(`Cat ${i}`), sort_order: i }));
      sql(`update public.categories set sort_order = 7 where id = '${viejo[0].id}'`);

      const r = await owner.db.rpc("reorder_siblings", args(org, viejo, [viejo[2].id, viejo[1].id, viejo[0].id]));

      expect(r.error?.code).toBe("55000");
      expect(r.error?.message).toBe("order_changed");
      expect(posiciones("categories", donde)).toEqual([1, 2, 7]);
    });

    it("los platos de OTRA categoría no se mezclan: el ámbito acota a los hermanos", async () => {
      const org = await nuevaOrg("pro");
      const [c1, c2] = await Promise.all([createCategory(owner.db, org, { name: "Uno" }), createCategory(owner.db, org, { name: "Dos" })]);
      if (!c1.ok || !c2.ok) throw new Error("categorías");
      await insertarEnTandas("products", [
        ...[0, 1, 2].map((i) => ({ organization_id: org, category_id: c1.data.id, name: `A${i}`, price_cents: 1, sort_order: i, is_active: false })),
        ...[0, 1, 2].map((i) => ({ organization_id: org, category_id: c2.data.id, name: `B${i}`, price_cents: 1, sort_order: i, is_active: false })),
      ]);
      const a2 = (await service.from("products").select("id").eq("organization_id", org).eq("name", "A2").single()).data!.id;

      expect((await moveProduct(owner.db, org, a2, "up")).ok).toBe(true);

      const nombres = (cat: string) => sql(`select name from public.products where category_id = '${cat}' order by sort_order`).map((f) => f[0]);
      expect(nombres(c1.data.id)).toEqual(["A0", "A2", "A1"]);
      expect(nombres(c2.data.id)).toEqual(["B0", "B1", "B2"]);
    });
  });
});

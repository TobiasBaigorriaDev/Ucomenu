import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMembership,
  anonClient,
  createCategory,
  createOrg,
  createUser,
  deleteOrg,
  deleteUser,
  DIA_MS,
  serviceClient,
  setSubscription,
  sql,
  type Db,
  type PlanCode,
  type TestUser,
} from "./helpers";

/**
 * Analítica básica (nivel C; ficha analitica-basica, ADR 0022) contra el Supabase local: la carta pública suma vistas de
 * platos como CONTADORES (nunca eventos ni datos del comensal) solo cuando todo cuadra, la tabla de contadores no se toca
 * por la API, y solo el Dueño de un local con el plan lee platos más vistos y llamados por hora.
 */

const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const hoyAr = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
const haceDias = (dias: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(Date.now() - dias * DIA_MS));

let service: Db;
let ajeno: TestUser; // Dueño de otro local
let comun: TestUser; // sin rol
const users: TestUser[] = [];
const orgs: string[] = [];
let contador = 0;

type Plato = { id: string; name: string };
type Local = {
  id: string;
  owner: TestUser;
  staff: TestUser;
  branch: string;
  branch2: string;
  categoria: string;
  platos: Plato[];
  mesas: { id: string; token: string; branch: string }[];
};

async function crearLocal(plan: PlanCode = "pro"): Promise<Local> {
  contador += 1;
  const id = await createOrg(service, `tt-analitica-${sufijo}-${contador}`, plan);
  orgs.push(id);
  await setSubscription(service, id, { finEnMs: 30 * DIA_MS });
  const [owner, staff] = await Promise.all([createUser(service, `ana-d${contador}`), createUser(service, `ana-s${contador}`)]);
  users.push(owner, staff);
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");

  const b1 = await service.from("branches").insert({ organization_id: id, slug: "uno", name: "Uno" }).select("id").single();
  // El plan Básico admite una sola sucursal: ahí la «segunda» es la misma.
  const b2 = plan === "basic" ? b1 : await service.from("branches").insert({ organization_id: id, slug: "dos", name: "Dos" }).select("id").single();
  const categoria = await createCategory(service, id);
  const platos = await service
    .from("products")
    .insert(["Milanesa", "Ensalada", "Flan"].map((name) => ({ organization_id: id, category_id: categoria, name, price_cents: 1000 })))
    .select("id, name")
    .order("name");
  const mesas = await service
    .from("tables")
    .insert([
      { organization_id: id, branch_id: b1.data!.id, label: "Mesa 1" },
      { organization_id: id, branch_id: b2.data!.id, label: "Mesa 2" },
    ])
    .select("id, qr_token, branch_id, label")
    .order("label");
  if (mesas.error) throw new Error(`mesas: ${mesas.error.message}`);
  return {
    id,
    owner,
    staff,
    branch: b1.data!.id,
    branch2: b2.data!.id,
    categoria,
    platos: platos.data as Plato[],
    mesas: mesas.data!.map((m) => ({ id: m.id, token: m.qr_token, branch: m.branch_id })),
  };
}

const plato = (local: Local, nombre: string) => local.platos.find((p) => p.name === nombre)!.id;
const vistas = (donde = "true") => sql(`select coalesce(sum(views), 0) from public.dish_view_counts where ${donde}`)[0][0];
const filasVistas = (donde = "true") => Number(sql(`select count(*) from public.dish_view_counts where ${donde}`)[0][0]);
const registrar = (db: Db, branch: string, product: string | null) => db.rpc("record_dish_view", { p_branch: branch, p_product: product as string });

const top = (db: Db, org: string, extra: { p_days?: number; p_branch?: string; p_limit?: number } = {}) => db.rpc("owner_top_dishes", { p_org: org, ...extra });
const porHora = (db: Db, org: string, extra: { p_branch?: string } = {}) => db.rpc("owner_calls_by_hour", { p_org: org, ...extra });

/** Siembra vistas de un día concreto (como dueño de la tabla: la API no puede escribirla). */
function sembrar(local: Local, product: string, branch: string, dia: string, views: number) {
  sql(
    `insert into public.dish_view_counts (organization_id, branch_id, product_id, day, views) values ('${local.id}', '${branch}', '${product}', '${dia}', ${views}) ` +
      `on conflict (branch_id, product_id, day) do update set views = excluded.views`,
  );
}

beforeAll(async () => {
  service = serviceClient();
  [ajeno, comun] = await Promise.all([createUser(service, "ana-ajeno"), createUser(service, "ana-comun")]);
  users.push(ajeno, comun);
});

afterAll(async () => {
  for (const id of orgs) await deleteOrg(service, id);
  for (const u of users) await deleteUser(service, u);
});

describe("registrar una vista (pública, valida adentro)", () => {
  it("anon suma un contador del día de Argentina por plato y sucursal: dos vistas son una fila con 2, sin ningún dato del comensal", async () => {
    const local = await crearLocal();
    const p = plato(local, "Milanesa");
    expect((await registrar(anonClient(), local.branch, p)).data).toBe(true);
    expect((await registrar(anonClient(), local.branch, p)).data).toBe(true);
    expect(sql(`select day::text, views from public.dish_view_counts where product_id = '${p}'`)).toEqual([[hoyAr(), "2"]]);
    // Otra sucursal u otro plato: filas aparte.
    expect((await registrar(anonClient(), local.branch2, p)).data).toBe(true);
    expect((await registrar(anonClient(), local.branch, plato(local, "Flan"))).data).toBe(true);
    expect(filasVistas(`organization_id = '${local.id}'`)).toBe(3);
    // La tabla no tiene columna alguna que identifique a nadie.
    const columnas = sql(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'dish_view_counts' order by 1`).flat();
    expect(columnas).toEqual(["branch_id", "day", "organization_id", "product_id", "views"]);
  });

  it("también con sesión (el personal que mira la carta) y con la cuenta vencida en «solo lectura» (la analítica sigue)", async () => {
    const local = await crearLocal();
    expect((await registrar(local.staff.db, local.branch, plato(local, "Flan"))).data).toBe(true);
    await setSubscription(service, local.id, { finEnMs: -10 * DIA_MS });
    expect((await registrar(anonClient(), local.branch, plato(local, "Flan"))).data).toBe(true);
    expect(vistas(`organization_id = '${local.id}'`)).toBe("2");
  });

  it("no escribe nada, y devuelve false sin explicar por qué, si algo no cuadra", async () => {
    const local = await crearLocal();
    const otro = await crearLocal();
    const basico = await crearLocal("basic");
    const suspendido = await crearLocal();
    await setSubscription(service, suspendido.id, { finEnMs: -30 * DIA_MS });
    const inactivo = await crearLocal();
    sql(`update public.organizations set is_active = false where id = '${inactivo.id}'`);
    const sucursalInactiva = await crearLocal();
    sql(`update public.branches set is_active = false where id = '${sucursalInactiva.branch}'`);
    const platoInactivo = await crearLocal();
    sql(`update public.products set is_active = false where id = '${plato(platoInactivo, "Flan")}'`);
    const categoriaInactiva = await crearLocal();
    sql(`update public.categories set is_active = false where id = '${categoriaInactiva.categoria}'`);

    const casos: [string, string, string | null][] = [
      ["plan Básico", basico.branch, plato(basico, "Flan")],
      ["cuenta suspendida", suspendido.branch, plato(suspendido, "Flan")],
      ["organización inactiva", inactivo.branch, plato(inactivo, "Flan")],
      ["sucursal inactiva", sucursalInactiva.branch, plato(sucursalInactiva, "Flan")],
      ["plato inactivo", platoInactivo.branch, plato(platoInactivo, "Flan")],
      ["categoría inactiva", categoriaInactiva.branch, plato(categoriaInactiva, "Flan")],
      ["plato de OTRA organización", local.branch, plato(otro, "Flan")],
      ["sucursal de otra y plato propio", otro.branch, plato(local, "Flan")],
      ["sucursal inexistente", "00000000-0000-4000-8000-0000000000aa", plato(local, "Flan")],
      ["plato inexistente", local.branch, "00000000-0000-4000-8000-0000000000bb"],
      ["plato nulo", local.branch, null],
    ];
    const antes = filasVistas();
    for (const [nombre, branch, product] of casos) {
      const r = await registrar(anonClient(), branch, product);
      expect([nombre, r.error, r.data], nombre).toEqual([nombre, null, false]);
    }
    expect(filasVistas()).toBe(antes);
  });

  it("el contador tiene tope (no desborda): con 1.000.000 sigue en 1.000.000", async () => {
    const local = await crearLocal();
    const p = plato(local, "Milanesa");
    sembrar(local, p, local.branch, hoyAr(), 1_000_000);
    expect((await registrar(anonClient(), local.branch, p)).data).toBe(true);
    expect(vistas(`product_id = '${p}'`)).toBe("1000000");
  });

  it("con varias vistas a la vez no se pierde ninguna (la suma es atómica)", async () => {
    const local = await crearLocal();
    const p = plato(local, "Milanesa");
    const resultados = await Promise.all(Array.from({ length: 12 }, () => registrar(anonClient(), local.branch, p)));
    expect(resultados.every((r) => r.data === true)).toBe(true);
    expect(vistas(`product_id = '${p}'`)).toBe("12");
  });
});

describe("la tabla de contadores sigue cerrada", () => {
  it("ni anon, ni una sesión, ni service_role la leen o escriben por la API", async () => {
    const local = await crearLocal();
    await registrar(anonClient(), local.branch, plato(local, "Flan"));
    const antes = vistas();
    for (const [nombre, db] of [
      ["anon", anonClient()],
      ["Dueño", local.owner.db],
      ["Staff", local.staff.db],
      ["service_role", service],
    ] as const) {
      const lectura = await db.from("dish_view_counts").select("*");
      expect(lectura.data ?? [], `${nombre}: lectura`).toEqual([]);
      const alta = await db.from("dish_view_counts").insert({ organization_id: local.id, branch_id: local.branch, product_id: plato(local, "Flan"), day: hoyAr(), views: 99 });
      expect(alta.error, `${nombre}: insert`).not.toBeNull();
      await db.from("dish_view_counts").update({ views: 999 }).eq("organization_id", local.id);
      await db.from("dish_view_counts").delete().eq("organization_id", local.id);
    }
    expect(vistas()).toBe(antes);
  });
});

describe("platos más vistos (solo el Dueño con el plan)", () => {
  async function conVistas() {
    const local = await crearLocal();
    sembrar(local, plato(local, "Milanesa"), local.branch, hoyAr(), 5);
    sembrar(local, plato(local, "Milanesa"), local.branch2, hoyAr(), 3);
    sembrar(local, plato(local, "Ensalada"), local.branch, haceDias(2), 4);
    sembrar(local, plato(local, "Flan"), local.branch, haceDias(20), 50); // fuera de 14 días
    return local;
  }

  it("el Dueño ve el ranking con el total del período, y el filtro por sucursal y la ventana de días funcionan", async () => {
    const local = await conVistas();
    const r = await top(local.owner.db, local.id);
    expect(r.error).toBeNull();
    expect(r.data!.map((f) => [f.name, Number(f.views)])).toEqual([["Milanesa", 8], ["Ensalada", 4]]);
    expect(r.data!.every((f) => Number(f.total_views) === 12)).toBe(true);

    expect((await top(local.owner.db, local.id, { p_branch: local.branch2 })).data!.map((f) => [f.name, Number(f.views)])).toEqual([["Milanesa", 3]]);
    // 30 días incluye el Flan de hace 20; 1 día solo lo de hoy.
    expect((await top(local.owner.db, local.id, { p_days: 30 })).data![0]).toMatchObject({ name: "Flan", views: 50, total_views: 62 });
    expect((await top(local.owner.db, local.id, { p_days: 1 })).data!.map((f) => f.name)).toEqual(["Milanesa"]);
    // Tope y mínimo de la ventana y del límite.
    expect((await top(local.owner.db, local.id, { p_limit: 1 })).data).toHaveLength(1);
    expect((await top(local.owner.db, local.id, { p_limit: 0 })).data).toHaveLength(1);
    sembrar(local, plato(local, "Milanesa"), local.branch, haceDias(100), 1000); // más allá del máximo de 90 días
    const maximo = (await top(local.owner.db, local.id, { p_days: 100_000, p_limit: 100_000 })).data!;
    expect(maximo.map((f) => [f.name, Number(f.views)])).toEqual([["Flan", 50], ["Milanesa", 8], ["Ensalada", 4]]); // 90 días: el Flan de hace 20 entra, lo de hace 100 no
    expect((await top(local.owner.db, local.id, { p_days: -3 })).data!.map((f) => f.name)).toEqual(["Milanesa"]);
  });

  it("un plato desactivado se lista marcado como tal y sus vistas siguen en el total del período", async () => {
    const local = await conVistas();
    sql(`update public.products set is_active = false where id = '${plato(local, "Ensalada")}'`);
    const r = (await top(local.owner.db, local.id)).data!;
    expect(r.map((f) => [f.name, f.is_active])).toEqual([["Milanesa", true], ["Ensalada", false]]);
    expect(r.every((f) => Number(f.total_views) === 12)).toBe(true);
  });

  it("si TODOS los platos vistos se desactivaron, el total no se pierde (sigue habiendo filas con el total)", async () => {
    const local = await crearLocal();
    sembrar(local, plato(local, "Flan"), local.branch, hoyAr(), 7);
    sql(`update public.products set is_active = false where id = '${plato(local, "Flan")}'`);
    const r = (await top(local.owner.db, local.id)).data!;
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ name: "Flan", views: 7, total_views: 7, is_active: false });
  });

  it("nadie más recibe nada: Staff, Dueño de otro local, sin rol, anon, plan Básico y cuenta suspendida; en «solo lectura» sí", async () => {
    const local = await conVistas();
    const otro = await crearLocal();
    for (const [nombre, db] of [
      ["Staff", local.staff.db],
      ["Dueño de otro local", otro.owner.db],
      ["sin rol", comun.db],
      ["Dueño ajeno sin membresía", ajeno.db],
    ] as const) {
      const r = await top(db, local.id);
      expect([nombre, r.error, r.data], nombre).toEqual([nombre, null, []]);
    }
    expect((await top(anonClient(), local.id)).error).not.toBeNull();
    expect((await top(local.owner.db, "00000000-0000-4000-8000-0000000000aa")).data).toEqual([]);

    const basico = await crearLocal("basic");
    sembrar(basico, plato(basico, "Flan"), basico.branch, hoyAr(), 7); // aunque haya datos de antes
    expect((await top(basico.owner.db, basico.id)).data).toEqual([]);

    await setSubscription(service, local.id, { finEnMs: -10 * DIA_MS }); // solo lectura
    expect((await top(local.owner.db, local.id)).data!.length).toBeGreaterThan(0);
    await setSubscription(service, local.id, { finEnMs: -30 * DIA_MS }); // suspendida
    expect((await top(local.owner.db, local.id)).data).toEqual([]);
  });

  it("quien deja de ser Dueño deja de ver al instante; cada local ve solo lo suyo", async () => {
    const a = await conVistas();
    const b = await crearLocal();
    sembrar(b, plato(b, "Flan"), b.branch, hoyAr(), 99);
    expect((await top(a.owner.db, a.id)).data!.map((f) => f.name)).toEqual(["Milanesa", "Ensalada"]);
    expect((await top(b.owner.db, b.id)).data!.map((f) => [f.name, Number(f.views)])).toEqual([["Flan", 99]]);
    expect((await top(a.owner.db, b.id)).data).toEqual([]);
    // Hace falta otro Dueño para poder bajar a este (la base exige al menos uno).
    await addMembership(service, ajeno, a.id, "owner");
    sql(`update public.memberships set role = 'staff' where user_id = '${a.owner.id}' and organization_id = '${a.id}'`);
    expect((await top(a.owner.db, a.id)).data).toEqual([]);
    expect((await top(ajeno.db, a.id)).data!.length).toBeGreaterThan(0);
  });

  it("la respuesta tiene solo las columnas previstas y leer no escribe", async () => {
    const local = await conVistas();
    const antes = vistas();
    const r = (await top(local.owner.db, local.id)).data!;
    expect(Object.keys(r[0]).sort()).toEqual(["is_active", "name", "product_id", "total_views", "views"]);
    expect(vistas()).toBe(antes);
  });
});

describe("llamados por hora (solo el Dueño con el plan, últimos 14 días)", () => {
  /** Crea un llamado de verdad por la puerta pública y lo coloca en un instante concreto (como dueño de la tabla). */
  async function llamar(local: Local, mesa: number, kind: "waiter" | "bill", arHora: number, haceDiasN = 1) {
    const { error } = await anonClient().rpc("create_waiter_call", { p_token: local.mesas[mesa].token, p_kind: kind });
    expect(error).toBeNull();
    // Hora local de Argentina = UTC-3: la hora pedida en AR es hora+3 en UTC.
    sql(
      `update public.waiter_calls set created_at = (date_trunc('day', now() at time zone 'UTC') - interval '${haceDiasN} days' + interval '${arHora + 3} hours' + interval '10 minutes') at time zone 'UTC', status = 'attended' ` +
        `where table_id = '${local.mesas[mesa].id}' and kind = '${kind}' and status = 'pending'`,
    );
  }

  it("agrupa por hora de Argentina y por tipo, filtra por sucursal y deja afuera lo de más de 14 días", async () => {
    const local = await crearLocal();
    await llamar(local, 0, "waiter", 13);
    await llamar(local, 0, "bill", 13, 2);
    await llamar(local, 0, "waiter", 13, 3);
    await llamar(local, 1, "bill", 21);
    await llamar(local, 1, "waiter", 9, 20); // hace 20 días: afuera

    const todo = await porHora(local.owner.db, local.id);
    expect(todo.error).toBeNull();
    expect(todo.data!.map((f) => [f.hour_of_day, Number(f.waiter), Number(f.bill)])).toEqual([[13, 2, 1], [21, 0, 1]]);
    expect((await porHora(local.owner.db, local.id, { p_branch: local.branch2 })).data!.map((f) => [f.hour_of_day, Number(f.waiter), Number(f.bill)])).toEqual([[21, 0, 1]]);
    expect((await porHora(local.owner.db, local.id, { p_branch: "00000000-0000-4000-8000-0000000000aa" })).data).toEqual([]);
  });

  it("no devuelve datos del comensal: solo hora, mozo y cuenta", async () => {
    const local = await crearLocal();
    await llamar(local, 0, "waiter", 12);
    const r = (await porHora(local.owner.db, local.id)).data!;
    expect(Object.keys(r[0]).sort()).toEqual(["bill", "hour_of_day", "waiter"]);
    expect(JSON.stringify(r)).not.toMatch(/client|key|mesa|token/i);
  });

  it("nadie más recibe nada y el plan Básico o la cuenta suspendida tampoco", async () => {
    const local = await crearLocal();
    await llamar(local, 0, "waiter", 12);
    const otro = await crearLocal();
    for (const [nombre, db] of [
      ["Staff", local.staff.db],
      ["Dueño de otro local", otro.owner.db],
      ["sin rol", comun.db],
    ] as const) {
      const r = await porHora(db, local.id);
      expect([nombre, r.error, r.data], nombre).toEqual([nombre, null, []]);
    }
    expect((await porHora(anonClient(), local.id)).error).not.toBeNull();

    const basico = await crearLocal("basic");
    // El plan Básico no puede llamar (la función lo rechaza): se siembra la fila para comprobar que igual no se lee.
    sql(
      `insert into public.waiter_calls (organization_id, branch_id, table_id, kind, status, created_at) ` +
        `values ('${basico.id}', '${basico.branch}', '${basico.mesas[0].id}', 'waiter', 'attended', now() - interval '1 day')`,
    );
    expect((await porHora(basico.owner.db, basico.id)).data).toEqual([]);

    await setSubscription(service, local.id, { finEnMs: -10 * DIA_MS }); // solo lectura: sí
    expect((await porHora(local.owner.db, local.id)).data).toHaveLength(1);
    await setSubscription(service, local.id, { finEnMs: -30 * DIA_MS }); // suspendida: no
    expect((await porHora(local.owner.db, local.id)).data).toEqual([]);
  });
});

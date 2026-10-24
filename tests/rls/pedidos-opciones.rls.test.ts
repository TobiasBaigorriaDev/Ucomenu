import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMembership,
  anonClient,
  createCategory,
  createOrg,
  createUser,
  DIA_MS,
  deleteOrg,
  deleteUser,
  serviceClient,
  setSubscription,
  sql,
  type Db,
  type TestUser,
} from "./helpers";

/**
 * Variantes, adicionales y observaciones en las líneas del pedido (nivel C, ficha pedidos-variantes-adicionales-observaciones,
 * ADR 0041) contra el Supabase local: la base valida las opciones contra el catálogo (activas, de un grupo activo de ESE plato,
 * mínimos y máximos), suma sus diferencias al precio con el dinero en bigint, copia nombres y diferencias, y valida la nota.
 */

let service: Db;
let owner: TestUser;
let staff: TestUser;
let stranger: TestUser;
const orgs: string[] = [];
let contador = 0;
const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

type Local = { id: string; branch: string; table: string; category: string; product: string };
type Grupo = { id: string; opciones: string[] };

async function nuevoLocal(): Promise<Local> {
  contador += 1;
  const id = await createOrg(service, `tt-ped-op-${sufijo}-${contador}`, "pro");
  orgs.push(id);
  await setSubscription(service, id, { finEnMs: 30 * DIA_MS });
  const b = await service.from("branches").insert({ organization_id: id, slug: "principal", name: "Principal" }).select("id").single();
  if (b.error) throw new Error(`sucursal: ${b.error.message}`);
  const t = await service.from("tables").insert({ organization_id: id, branch_id: b.data.id, label: "Mesa 1" }).select("id").single();
  if (t.error) throw new Error(`mesa: ${t.error.message}`);
  const category = await createCategory(service, id, "Platos");
  const p = await service.from("products").insert({ organization_id: id, category_id: category, name: "Bife", price_cents: 10000 }).select("id").single();
  if (p.error) throw new Error(`plato: ${p.error.message}`);
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  return { id, branch: b.data.id, table: t.data.id, category, product: p.data.id };
}

/** Un grupo de opciones del plato con opciones `[nombre, diferencia]`. */
async function grupo(l: Local, nombre: string, min: number, max: number, opciones: [string, number][], product = l.product, activo = true): Promise<Grupo> {
  const g = await service
    .from("option_groups")
    .insert({ organization_id: l.id, product_id: product, name: nombre, min_choices: min, max_choices: max, is_active: activo })
    .select("id")
    .single();
  if (g.error) throw new Error(`grupo: ${g.error.message}`);
  const o = await service
    .from("options")
    .insert(opciones.map(([name, delta], i) => ({ organization_id: l.id, group_id: g.data.id, name, price_delta_cents: delta, sort_order: i })))
    .select("id, sort_order")
    .order("sort_order");
  if (o.error) throw new Error(`opciones: ${o.error.message}`);
  return { id: g.data.id, opciones: o.data.map((x) => x.id) };
}

type Linea = {
  order_id: string;
  item_id: string;
  unit_price_cents: number;
  base_price_cents: number;
  options_cents: number;
  options: { option_id: string | null; group_name: string; option_name: string; price_delta_cents: number }[];
  note: string | null;
  promotion_name: string | null;
  replayed: boolean;
};

const anotar = (db: Db, l: Pick<Local, "branch" | "table" | "product">, extra: Record<string, unknown> = {}) =>
  db.rpc("add_order_item", {
    p_branch: l.branch,
    p_table: l.table,
    p_product: l.product,
    p_quantity: 1,
    p_client_key: randomUUID(),
    ...extra,
  } as never);

const linea = (r: { data: unknown; error: { message: string } | null }): Linea => {
  if (r.error) throw new Error(`add_order_item: ${r.error.message}`);
  return r.data as Linea;
};

const cuenta = (tabla: "orders" | "order_items" | "order_item_options", orgId: string) =>
  Number(sql(`select count(*) from public.${tabla} where organization_id = '${orgId}'`)[0][0]);

beforeAll(async () => {
  service = serviceClient();
  [owner, staff, stranger] = await Promise.all([
    createUser(service, "pedop-owner"),
    createUser(service, "pedop-staff"),
    createUser(service, "pedop-ajeno"),
  ]);
});

afterAll(async () => {
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await Promise.all([owner, staff, stranger].map((u) => deleteUser(service, u)));
});

describe("variantes (1 de 1) y adicionales (0 a N)", () => {
  it("la variante obligatoria se anota eligiendo una; sin elegir o con dos, no", async () => {
    const l = await nuevoLocal();
    const punto = await grupo(l, "Punto", 1, 1, [["Jugoso", 0], ["A punto", 0], ["Cocido", 500]]);
    expect((await anotar(owner.db, l)).error?.message).toBe("options_required");
    expect((await anotar(owner.db, l, { p_options: [] })).error?.message).toBe("options_required");
    expect((await anotar(owner.db, l, { p_options: [punto.opciones[0], punto.opciones[1]] })).error?.message).toBe("options_exceeded");
    expect(cuenta("orders", l.id)).toBe(0);

    const ok = linea(await anotar(owner.db, l, { p_options: [punto.opciones[2]] }));
    expect(ok).toMatchObject({ base_price_cents: 10000, unit_price_cents: 10000, options_cents: 500, replayed: false });
    expect(ok.options).toEqual([{ option_id: punto.opciones[2], group_name: "Punto", option_name: "Cocido", price_delta_cents: 500 }]);
  });

  it("adicionales opcionales (0 a 3): ninguno, uno o tres entran; cuatro no; con mínimo 2, uno solo no", async () => {
    const l = await nuevoLocal();
    const extras = await grupo(l, "Extras", 0, 3, [["Bacon", 180], ["Huevo", 120], ["Queso", 100], ["Palta", 300]]);
    expect(linea(await anotar(owner.db, l)).options_cents).toBe(0);
    expect(linea(await anotar(owner.db, l, { p_options: [extras.opciones[0]] })).options_cents).toBe(180);
    expect(linea(await anotar(owner.db, l, { p_options: extras.opciones.slice(0, 3) })).options_cents).toBe(400);
    expect((await anotar(owner.db, l, { p_options: extras.opciones })).error?.message).toBe("options_exceeded");

    const l2 = await nuevoLocal();
    const minimo = await grupo(l2, "Acompañamientos", 2, 3, [["Papas", 0], ["Ensalada", 0], ["Puré", 0]]);
    expect((await anotar(owner.db, l2, { p_options: [minimo.opciones[0]] })).error?.message).toBe("options_required");
    expect(linea(await anotar(owner.db, l2, { p_options: minimo.opciones.slice(0, 2) })).options).toHaveLength(2);
  });

  it("varios grupos: se cumplen todos los activos del plato; un grupo opcional sin elegir no estorba", async () => {
    const l = await nuevoLocal();
    const punto = await grupo(l, "Punto", 1, 1, [["Jugoso", 0], ["Cocido", 0]]);
    const guarnicion = await grupo(l, "Guarnición", 1, 1, [["Papas", 0], ["Puré", 200]]);
    await grupo(l, "Extras", 0, 2, [["Huevo", 100]]);
    expect((await anotar(owner.db, l, { p_options: [punto.opciones[0]] })).error?.message).toBe("options_required");
    expect((await anotar(owner.db, l, { p_options: [guarnicion.opciones[1]] })).error?.message).toBe("options_required");
    const ok = linea(await anotar(owner.db, l, { p_options: [punto.opciones[0], guarnicion.opciones[1]] }));
    expect(ok.options.map((o) => o.group_name)).toEqual(["Punto", "Guarnición"]);
    expect(ok.options_cents).toBe(200);
  });

  it("un grupo obligatorio sin opciones activas no se puede cumplir: falla cerrado; pausado el grupo, ya no", async () => {
    const l = await nuevoLocal();
    const g = await grupo(l, "Tamaño", 1, 1, [["Chico", 0]]);
    await service.from("options").update({ is_active: false }).eq("group_id", g.id);
    expect((await anotar(owner.db, l)).error?.message).toBe("options_required");
    expect(cuenta("orders", l.id)).toBe(0);
    await service.from("option_groups").update({ is_active: false }).eq("id", g.id);
    expect(linea(await anotar(owner.db, l)).options).toEqual([]);
  });

  it("el precio de la unidad suma las diferencias y la promoción baja solo el precio base", async () => {
    const l = await nuevoLocal();
    const extras = await grupo(l, "Extras", 0, 2, [["Bacon", 3000], ["Huevo", 1000]]);
    const promo = await service
      .from("promotions")
      .insert({ organization_id: l.id, name: "Mitad", discount_type: "percent", discount_value: 50, weekdays_mask: 127, start_minute: 0, end_minute: 1440 })
      .select("id")
      .single();
    await service.from("promotion_targets").insert({ organization_id: l.id, promotion_id: promo.data!.id, product_id: l.product });
    const r = linea(await anotar(owner.db, l, { p_quantity: 2, p_options: extras.opciones }));
    expect(r).toMatchObject({ base_price_cents: 10000, unit_price_cents: 5000, options_cents: 4000, promotion_name: "Mitad" });
    const fila = await service.from("order_items").select("quantity, unit_price_cents, options_cents").eq("id", r.item_id).single();
    expect(fila.data).toEqual({ quantity: 2, unit_price_cents: 5000, options_cents: 4000 });
  });

  it("50 opciones de la diferencia máxima suman en bigint (más de lo que cabe en integer)", async () => {
    const l = await nuevoLocal();
    const g = await grupo(l, "Todo", 0, 50, Array.from({ length: 50 }, (_, i) => [`Opción ${i + 1}`, 1_000_000_000] as [string, number]));
    const r = linea(await anotar(owner.db, l, { p_options: g.opciones }));
    expect(r.options_cents).toBe(50_000_000_000);
    expect(r.options).toHaveLength(50);
    // 51 ids (aunque sean inexistentes) ni se miran: más de 50.
    expect((await anotar(owner.db, l, { p_options: Array.from({ length: 51 }, () => randomUUID()) })).error?.message).toBe("invalid_options");
  });
});

describe("qué opciones rechaza (invalid_options), sin dejar filas", () => {
  it("de otro plato, de otra organización, inactiva, de un grupo inactivo, repetida, nula o inexistente", async () => {
    const l = await nuevoLocal();
    const otra = await nuevoLocal();
    const otroPlato = await service.from("products").insert({ organization_id: l.id, category_id: l.category, name: "Pollo", price_cents: 5000 }).select("id").single();
    const delOtroPlato = await grupo(l, "Salsa", 0, 2, [["Criolla", 0]], otroPlato.data!.id);
    const ajena = await grupo(otra, "Salsa", 0, 2, [["Ajena", 0]], otra.product);
    const propio = await grupo(l, "Extras", 0, 3, [["Bacon", 100], ["Huevo", 100], ["Apagada", 100]]);
    await service.from("options").update({ is_active: false }).eq("id", propio.opciones[2]);
    const grupoApagado = await grupo(l, "Viejo", 0, 2, [["Fantasma", 100]], l.product, false);

    const casos: [string, unknown[]][] = [
      ["de otro plato", delOtroPlato.opciones],
      ["de otra organización", ajena.opciones],
      ["inactiva", [propio.opciones[2]]],
      ["de un grupo inactivo", grupoApagado.opciones],
      ["repetida", [propio.opciones[0], propio.opciones[0]]],
      ["nula", [propio.opciones[0], null]],
      ["inexistente", [randomUUID()]],
    ];
    for (const [nombre, opciones] of casos) {
      expect((await anotar(owner.db, l, { p_options: opciones })).error?.message, nombre).toBe("invalid_options");
    }
    expect(cuenta("orders", l.id)).toBe(0);
    expect(cuenta("order_items", l.id)).toBe(0);
    expect(cuenta("order_item_options", l.id)).toBe(0);
    // Con una válida, sí.
    expect(linea(await anotar(owner.db, l, { p_options: [propio.opciones[0]] })).options).toHaveLength(1);
  });
});

describe("la observación", () => {
  it("se guarda sin espacios en los bordes; vacía es nula; 200 caracteres sí, 201 no; sin saltos de línea ni caracteres de control", async () => {
    const l = await nuevoLocal();
    expect(linea(await anotar(owner.db, l, { p_note: "   sin cebolla  " })).note).toBe("sin cebolla");
    expect(linea(await anotar(owner.db, l, { p_note: "   " })).note).toBeNull();
    expect(linea(await anotar(owner.db, l, { p_note: "" })).note).toBeNull();
    expect(linea(await anotar(owner.db, l)).note).toBeNull();
    expect(linea(await anotar(owner.db, l, { p_note: "a".repeat(200) })).note).toHaveLength(200);
    for (const mala of ["a".repeat(201), "primera\nsegunda", "con\ttab", "nulo\u0000"]) {
      expect((await anotar(owner.db, l, { p_note: mala })).error, JSON.stringify(mala)).not.toBeNull();
    }
    expect((await anotar(owner.db, l, { p_note: "a".repeat(201) })).error?.message).toBe("invalid_note");
    expect((await anotar(owner.db, l, { p_note: "primera\nsegunda" })).error?.message).toBe("invalid_note");
    expect(cuenta("order_items", l.id)).toBe(5);
  });

  it("la tabla rechaza una nota sin recortar o con caracteres de control aunque alguien la escriba como dueño de la tabla", async () => {
    const l = await nuevoLocal();
    const r = linea(await anotar(owner.db, l));
    expect(() => sql(`update public.order_items set note = ' x ' where id = '${r.item_id}'`)).toThrow(/order_items_note_check/);
    expect(() => sql(`update public.order_items set note = E'a\\nb' where id = '${r.item_id}'`)).toThrow(/order_items_note_check/);
  });
});

describe("el reintento con opciones y observación", () => {
  it("la misma petición (aunque las opciones lleguen en otro orden) devuelve la línea; cambiar una opción, la nota o la cantidad, no", async () => {
    const l = await nuevoLocal();
    const extras = await grupo(l, "Extras", 0, 3, [["Bacon", 100], ["Huevo", 200], ["Queso", 300]]);
    const clave = randomUUID();
    const a = linea(await anotar(owner.db, l, { p_client_key: clave, p_options: [extras.opciones[0], extras.opciones[1]], p_note: "bien cocido" }));
    const b = linea(await anotar(owner.db, l, { p_client_key: clave, p_options: [extras.opciones[1], extras.opciones[0]], p_note: " bien cocido " }));
    expect(b).toMatchObject({ replayed: true, item_id: a.item_id, options_cents: 300, note: "bien cocido" });
    expect(b.options).toHaveLength(2);
    for (const cambio of [{ p_options: [extras.opciones[0]] }, { p_options: [extras.opciones[0], extras.opciones[2]] }, { p_note: "otra" }, { p_note: null }, { p_quantity: 2 }]) {
      const r = await anotar(owner.db, l, { p_client_key: clave, p_options: [extras.opciones[0], extras.opciones[1]], p_note: "bien cocido", ...cambio });
      expect(r.error?.message, JSON.stringify(cambio)).toBe("client_key_reused");
    }
    expect(cuenta("order_items", l.id)).toBe(1);
    expect(cuenta("order_item_options", l.id)).toBe(2);
  });

  it("tras borrar una opción del catálogo, repetir exactamente la petición devuelve la línea con su copia", async () => {
    const l = await nuevoLocal();
    const extras = await grupo(l, "Extras", 0, 2, [["Bacon", 100]]);
    const clave = randomUUID();
    const pedido = { p_client_key: clave, p_options: extras.opciones };
    const a = linea(await anotar(owner.db, l, pedido));
    expect((await service.from("options").delete().eq("id", extras.opciones[0])).error).toBeNull();
    const b = linea(await anotar(owner.db, l, pedido));
    expect(b).toMatchObject({ replayed: true, item_id: a.item_id });
    expect(b.options).toEqual([{ option_id: null, group_name: "Extras", option_name: "Bacon", price_delta_cents: 100 }]);
  });
});

describe("la copia", () => {
  it("renombrar o repreciar el catálogo no cambia lo anotado; borrar la opción deja el nombre y la diferencia", async () => {
    const l = await nuevoLocal();
    const g = await grupo(l, "Punto", 1, 1, [["Jugoso", 250]]);
    const r = linea(await anotar(owner.db, l, { p_options: g.opciones }));
    await service.from("options").update({ name: "Muy jugoso", price_delta_cents: 9999 }).eq("id", g.opciones[0]);
    await service.from("option_groups").update({ name: "Cocción" }).eq("id", g.id);
    const copia = async () => (await service.from("order_item_options").select("option_id, group_name, option_name, price_delta_cents").eq("order_item_id", r.item_id)).data;
    expect(await copia()).toEqual([{ option_id: g.opciones[0], group_name: "Punto", option_name: "Jugoso", price_delta_cents: 250 }]);
    expect((await service.from("options").delete().eq("id", g.opciones[0])).error).toBeNull();
    expect(await copia()).toEqual([{ option_id: null, group_name: "Punto", option_name: "Jugoso", price_delta_cents: 250 }]);
    const fila = await service.from("order_items").select("options_cents").eq("id", r.item_id).single();
    expect(fila.data?.options_cents).toBe(250);
  });

  it("si falla el alta de las opciones, no queda la línea ni el pedido recién abierto (una sola transacción)", async () => {
    const l = await nuevoLocal();
    const g = await grupo(l, "Extras", 0, 2, [["Bacon", 100]]);
    sql(`create function public.tt_falla_opcion() returns trigger language plpgsql as $$ begin raise exception 'tt_falla_opcion'; end $$`);
    sql(`create trigger tt_falla_opcion before insert on public.order_item_options for each row execute function public.tt_falla_opcion()`);
    try {
      expect((await anotar(owner.db, l, { p_options: g.opciones })).error?.message).toContain("tt_falla_opcion");
    } finally {
      sql("drop trigger tt_falla_opcion on public.order_item_options");
      sql("drop function public.tt_falla_opcion()");
    }
    expect(cuenta("orders", l.id)).toBe(0);
    expect(cuenta("order_items", l.id)).toBe(0);
    expect(cuenta("order_item_options", l.id)).toBe(0);
  });
});

describe("la tabla de opciones copiadas", () => {
  it("la leen los miembros de la organización y nadie más; nadie la escribe por la API", async () => {
    const l = await nuevoLocal();
    const otro = await nuevoLocal();
    const g = await grupo(l, "Extras", 0, 2, [["Bacon", 100]]);
    const r = linea(await anotar(owner.db, l, { p_options: g.opciones }));
    expect((await staff.db.from("order_item_options").select("id").eq("organization_id", l.id)).data).toHaveLength(1);
    await addMembership(service, stranger, otro.id, "owner");
    expect((await stranger.db.from("order_item_options").select("id").eq("organization_id", l.id)).data).toEqual([]);
    expect((await anonClient().from("order_item_options").select("id")).error).not.toBeNull();

    const fila = { organization_id: l.id, order_item_id: r.item_id, group_name: "x", option_name: "y", price_delta_cents: 0 };
    for (const [quien, db] of [["Dueño", owner.db], ["Staff", staff.db], ["anon", anonClient()], ["servicio", service]] as const) {
      expect((await db.from("order_item_options").insert(fila)).error?.code, `${quien}: insert`).toMatch(/42501|PGRST/);
      const upd = await db.from("order_item_options").update({ price_delta_cents: 1 }).eq("order_item_id", r.item_id).select("id");
      expect(upd.error?.code ?? "sin filas", `${quien}: update`).toMatch(/42501|PGRST|sin filas/);
      expect((await db.from("order_item_options").delete().eq("order_item_id", r.item_id).select("id")).data ?? []).toEqual([]);
    }
    expect(cuenta("order_item_options", l.id)).toBe(1);
    for (const [rol, select] of [["anon", "f"], ["authenticated", "t"], ["service_role", "t"]] as const) {
      const permisos = sql(
        `select ${["select", "insert", "update", "delete", "truncate", "references", "trigger"].map((p) => `has_table_privilege('${rol}', 'public.order_item_options', '${p}')`).join(", ")}`,
      )[0];
      expect(permisos, rol).toEqual([select, "f", "f", "f", "f", "f", "f"]);
    }
  });

  it("se va con la línea y con la organización", async () => {
    const l = await nuevoLocal();
    const g = await grupo(l, "Extras", 0, 2, [["Bacon", 100]]);
    linea(await anotar(owner.db, l, { p_options: g.opciones }));
    expect(cuenta("order_item_options", l.id)).toBe(1);
    orgs.splice(orgs.indexOf(l.id), 1);
    await deleteOrg(service, l.id);
    expect(cuenta("order_item_options", l.id)).toBe(0);
    expect(cuenta("order_items", l.id)).toBe(0);
  });
});

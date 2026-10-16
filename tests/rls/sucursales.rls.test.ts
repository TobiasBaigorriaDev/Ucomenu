import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMembership,
  anonClient,
  createOrg,
  createUser,
  DIA_MS,
  deleteOrg,
  deleteUser,
  serviceClient,
  setSubscription,
  type Db,
  type PlanCode,
  type TestUser,
} from "./helpers";
import { createBranch, loadSucursales, renameBranch } from "@/lib/sucursales/branches";

/**
 * Gestión de sucursales contra el Supabase local (ficha gestion-de-sucursales; migración gestion_de_sucursales):
 * solo el Dueño las crea y las renombra, con la cuenta al día y dentro del tope del plan; el identificador no cambia
 * nunca; sin falsos éxitos cuando la base descarta una escritura; aislamiento entre locales.
 */

let service: Db;
let owner: TestUser;
let staff: TestUser;
let stranger: TestUser;
const orgs: string[] = [];

/** Un local con una sucursal ya creada. `owner` es Dueño y `staff` es Personal (si `members`). */
async function nuevoLocal(slug: string, plan: PlanCode = "pro", members = true): Promise<{ id: string; branch: string }> {
  const id = await createOrg(service, slug, plan);
  orgs.push(id);
  const b = await service.from("branches").insert({ organization_id: id, slug: "principal", name: "Principal" }).select("id").single();
  if (b.error) throw new Error(`sucursal inicial: ${b.error.message}`);
  if (members) {
    await addMembership(service, owner, id, "owner");
    await addMembership(service, staff, id, "staff");
  }
  return { id, branch: b.data.id };
}

const sucursales = async (orgId: string) =>
  (await service.from("branches").select("slug, name").eq("organization_id", orgId).order("slug")).data ?? [];

beforeAll(async () => {
  service = serviceClient();
  [owner, staff, stranger] = await Promise.all([
    createUser(service, "sucursales-owner"),
    createUser(service, "sucursales-staff"),
    createUser(service, "sucursales-ajeno"),
  ]);
});

afterAll(async () => {
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await Promise.all([owner, staff, stranger].map((u) => deleteUser(service, u)));
});

describe("alta y renombrado por el Dueño", () => {
  it("el Dueño crea una sucursal; aparece en la lista con sus mesas y la ve el público", async () => {
    const local = await nuevoLocal("tt-suc-alta");

    const creada = await createBranch(owner.db, local.id, { name: "  Palermo  ", slug: " Palermo-2 " });
    expect(creada.ok).toBe(true);

    expect(await sucursales(local.id)).toEqual([
      { slug: "palermo-2", name: "Palermo" },
      { slug: "principal", name: "Principal" },
    ]);
    const lista = await loadSucursales(owner.db, local.id);
    expect(lista.map((s) => [s.name, s.tables, s.activeTables])).toEqual([["Palermo", 0, 0], ["Principal", 0, 0]]);
    // Con la cuenta al día y activa, cualquiera ve la sucursal nueva (la carta pública).
    const publica = await anonClient().from("branches").select("slug").eq("organization_id", local.id);
    expect(publica.data).toHaveLength(2);
  });

  it("renombrar persiste y no toca el identificador", async () => {
    const local = await nuevoLocal("tt-suc-renombrar");
    const creada = await createBranch(owner.db, local.id, { name: "Centro", slug: "centro" });
    if (!creada.ok) throw new Error("alta");

    expect((await renameBranch(owner.db, local.id, creada.data.id, " Centro histórico ")).ok).toBe(true);
    expect((await sucursales(local.id)).find((s) => s.slug === "centro")).toEqual({ slug: "centro", name: "Centro histórico" });
  });

  it("valida nombre e identificador, y los duplicados, sin guardar nada", async () => {
    const local = await nuevoLocal("tt-suc-valida");
    const otro = await nuevoLocal("tt-suc-valida-otro", "pro", false);

    expect(await createBranch(owner.db, local.id, { name: "   ", slug: "a" })).toEqual({ ok: false, error: "name_blank" });
    expect(await createBranch(owner.db, local.id, { name: "x".repeat(81), slug: "a" })).toEqual({ ok: false, error: "name_too_long" });
    expect(await createBranch(owner.db, local.id, { name: "A", slug: "" })).toEqual({ ok: false, error: "slug_blank" });
    for (const slug of ["con espacio", "Ñandú", "-guion", "doble--guion", "a".repeat(65), "con_guion_bajo"]) {
      expect(await createBranch(owner.db, local.id, { name: "A", slug }), slug).toEqual({ ok: false, error: "slug_invalid" });
    }
    expect(await createBranch(owner.db, local.id, { name: "Otra", slug: "principal" })).toEqual({ ok: false, error: "slug_duplicate" });
    expect(await sucursales(local.id)).toHaveLength(1);

    // El mismo identificador en otro local no choca (la unicidad es por local): `otro` también tiene «principal».
    expect(await sucursales(otro.id)).toEqual([{ slug: "principal", name: "Principal" }]);
    expect(await renameBranch(owner.db, local.id, local.branch, "x".repeat(81))).toEqual({ ok: false, error: "name_too_long" });
  });

  it("la base misma limita el nombre a 80 caracteres y valida el identificador (aunque se salteen las validaciones de la aplicación)", async () => {
    const local = await nuevoLocal("tt-suc-base", "premium");

    const largo = await owner.db.from("branches").insert({ organization_id: local.id, slug: "largo", name: "x".repeat(81) });
    const enBlanco = await owner.db.from("branches").insert({ organization_id: local.id, slug: "blanco", name: "   " });
    const slugMalo = await owner.db.from("branches").insert({ organization_id: local.id, slug: "Mal Slug", name: "Mal" });
    const justo = await owner.db.from("branches").insert({ organization_id: local.id, slug: "justo", name: "x".repeat(80) });

    expect(largo.error?.code).toBe("23514");
    expect(largo.error?.message).toContain("branches_name_max_length");
    expect(enBlanco.error?.code).toBe("23514");
    expect(slugMalo.error?.code).toBe("23514");
    expect(justo.error).toBeNull();
    // Renombrar también respeta el tope.
    const renombrar = await owner.db.from("branches").update({ name: "y".repeat(81) }).eq("id", local.branch).select("id");
    expect(renombrar.error?.code).toBe("23514");
  });
});

describe("quién puede escribir", () => {
  it("el Staff no crea, no renombra y no cambia el identificador (aunque la cuenta esté al día y haya cupo)", async () => {
    const local = await nuevoLocal("tt-suc-staff");
    const antes = JSON.stringify(await sucursales(local.id));

    expect(await createBranch(staff.db, local.id, { name: "Intrusa", slug: "intrusa" })).toEqual({ ok: false, error: "forbidden" });
    expect(await renameBranch(staff.db, local.id, local.branch, "Renombrada")).toEqual({ ok: false, error: "forbidden" });
    // Por la API directa: sin la capa del módulo.
    const insertar = await staff.db.from("branches").insert({ organization_id: local.id, slug: "api", name: "API" });
    const renombrar = await staff.db.from("branches").update({ name: "API" }).eq("id", local.branch).select("id");
    const slug = await staff.db.from("branches").update({ slug: "otro" }).eq("id", local.branch).select("id");
    expect(insertar.error?.code).toBe("42501");
    expect(renombrar.data).toEqual([]);
    expect(slug.error?.code).toBe("42501"); // la columna `slug` no es actualizable por nadie
    expect(JSON.stringify(await sucursales(local.id))).toBe(antes);
  });

  it("el Dueño tampoco puede cambiar el identificador, mover la sucursal de local ni elegir el id; nadie borra", async () => {
    const local = await nuevoLocal("tt-suc-inmutable");
    const otro = await nuevoLocal("tt-suc-inmutable-otro", "pro", false);

    const slug = await owner.db.from("branches").update({ slug: "otro" }).eq("id", local.branch).select("id");
    const org = await owner.db.from("branches").update({ organization_id: otro.id }).eq("id", local.branch).select("id");
    const conId = await owner.db
      .from("branches")
      .insert({ id: crypto.randomUUID(), organization_id: local.id, slug: "con-id", name: "Con id" });
    const borrar = await owner.db.from("branches").delete().eq("id", local.branch).select("id");

    expect(slug.error?.code).toBe("42501");
    expect(org.error?.code).toBe("42501");
    expect(conId.error?.code).toBe("42501");
    expect(borrar.error?.code).toBe("42501");
    expect(await sucursales(local.id)).toEqual([{ slug: "principal", name: "Principal" }]);
  });

  it("aislamiento: quien es Dueño de un local y Personal de otro, y quien no es miembro, solo escriben donde corresponde", async () => {
    const propio = await nuevoLocal("tt-suc-aisla-propio", "pro", false);
    const ajeno = await nuevoLocal("tt-suc-aisla-ajeno", "pro", false);
    await addMembership(service, owner, propio.id, "owner");
    await addMembership(service, owner, ajeno.id, "staff"); // en el local ajeno solo es Personal
    const antes = JSON.stringify(await sucursales(ajeno.id));

    expect((await createBranch(owner.db, propio.id, { name: "Nueva", slug: "nueva" })).ok).toBe(true);
    expect((await createBranch(owner.db, ajeno.id, { name: "Cruzada", slug: "cruzada" })).ok).toBe(false);
    expect((await createBranch(stranger.db, propio.id, { name: "Intrusa", slug: "intrusa" })).ok).toBe(false);
    expect(await renameBranch(owner.db, propio.id, ajeno.branch, "Robada")).toEqual({ ok: false, error: "not_found" });
    expect(await renameBranch(stranger.db, ajeno.id, ajeno.branch, "Robada")).toMatchObject({ ok: false });
    // Directo por la API, con el id del otro local en el cuerpo.
    const directo = await owner.db.from("branches").insert({ organization_id: ajeno.id, slug: "directa", name: "Directa" });
    expect(directo.error?.code).toBe("42501");

    // Dueño de los dos: el id de una sucursal del otro local no se renombra con el contexto de este (la aplicación acota por local).
    const doble = await nuevoLocal("tt-suc-aisla-doble", "pro", false);
    await addMembership(service, owner, doble.id, "owner");
    const antesDoble = JSON.stringify(await sucursales(doble.id));
    expect(await renameBranch(owner.db, propio.id, doble.branch, "Cruzada")).toEqual({ ok: false, error: "not_found" });
    expect(JSON.stringify(await sucursales(doble.id))).toBe(antesDoble);

    expect(JSON.stringify(await sucursales(ajeno.id))).toBe(antes);
    expect((await sucursales(propio.id)).map((s) => s.slug)).toEqual(["nueva", "principal"]);
  });
});

describe("tope de sucursales del plan", () => {
  it("Básico (1): la segunda se rechaza con el motivo del tope y no se guarda", async () => {
    const local = await nuevoLocal("tt-suc-tope-basico", "basic");

    expect(await createBranch(owner.db, local.id, { name: "Segunda", slug: "segunda" })).toEqual({ ok: false, error: "limit" });
    expect(await sucursales(local.id)).toHaveLength(1);
  });

  it("Pro (2): una más entra y la siguiente no; Premium no tiene tope", async () => {
    const pro = await nuevoLocal("tt-suc-tope-pro", "pro");
    expect((await createBranch(owner.db, pro.id, { name: "Segunda", slug: "segunda" })).ok).toBe(true);
    expect(await createBranch(owner.db, pro.id, { name: "Tercera", slug: "tercera" })).toEqual({ ok: false, error: "limit" });

    const premium = await nuevoLocal("tt-suc-tope-premium", "premium");
    for (const n of [1, 2, 3, 4]) expect((await createBranch(owner.db, premium.id, { name: `S${n}`, slug: `s${n}` })).ok).toBe(true);
  });

  it("pedidos paralelos con un solo cupo libre: entra exactamente uno", async () => {
    const local = await nuevoLocal("tt-suc-carrera", "pro");

    const resultados = await Promise.all(
      [1, 2, 3, 4].map((n) => createBranch(owner.db, local.id, { name: `Carrera ${n}`, slug: `carrera-${n}` })),
    );

    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(resultados.filter((r) => !r.ok).every((r) => !r.ok && r.error === "limit")).toBe(true);
    expect(await sucursales(local.id)).toHaveLength(2);
  });

  it("renombrar con el tope alcanzado sigue permitido", async () => {
    const local = await nuevoLocal("tt-suc-tope-renombrar", "basic");

    expect((await renameBranch(owner.db, local.id, local.branch, "Casa central")).ok).toBe(true);
  });
});

describe("cuenta bloqueada: sin falsos éxitos", () => {
  it("gracia: se edita con normalidad; solo lectura y suspendida: no se crea ni se renombra", async () => {
    // Premium (sin tope): así el único motivo posible del rechazo de la base es la cuenta, no el cupo.
    const local = await nuevoLocal("tt-suc-mora", "premium");

    await setSubscription(service, local.id, { finEnMs: -DIA_MS }); // venció ayer: gracia
    expect((await createBranch(owner.db, local.id, { name: "En gracia", slug: "gracia" })).ok).toBe(true);

    for (const [finEnMs, error] of [[-10 * DIA_MS, "blocked_read_only"], [-30 * DIA_MS, "blocked_suspended"]] as const) {
      await setSubscription(service, local.id, { finEnMs });
      const antes = JSON.stringify(await sucursales(local.id));

      expect(await createBranch(owner.db, local.id, { name: "Bloqueada", slug: "bloqueada" })).toEqual({ ok: false, error });
      expect(await renameBranch(owner.db, local.id, local.branch, "Bloqueada")).toEqual({ ok: false, error });
      // La base lo impide por sí sola aunque la aplicación no lo comprobara (estado desactualizado).
      const insertar = await owner.db.from("branches").insert({ organization_id: local.id, slug: "forzada", name: "Forzada" });
      const renombrar = await owner.db.from("branches").update({ name: "Forzada" }).eq("id", local.branch).select("id");
      expect(insertar.error?.code).toBe("42501");
      expect(renombrar.data).toEqual([]);
      expect(JSON.stringify(await sucursales(local.id))).toBe(antes);
    }
  });
});

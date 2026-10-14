import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMembership,
  createOrg,
  createUser,
  DIA_MS,
  deleteOrg,
  deleteUser,
  serviceClient,
  setSubscription,
  type Db,
  type TestUser,
} from "./helpers";
import { createTable, loadMesas, regenerateTableQr, renameTable, setTableActive } from "@/lib/mesas/tables";
import { isToken } from "@/lib/mesas/url";

/**
 * Módulo de gestión de mesas contra el Supabase local (ficha mesas-y-qr): escrituras con el cliente de la persona,
 * tope por sucursal, cuenta bloqueada sin falsos éxitos, aislamiento y regeneración del token.
 */

let service: Db;
let owner: TestUser;
let staff: TestUser;
let stranger: TestUser;
const orgs: string[] = [];

type Local = { id: string; branch: string; branch2: string };

async function nuevoLocal(slug: string, plan: "basic" | "pro" = "pro", members = true): Promise<Local> {
  const id = await createOrg(service, slug, "pro");
  orgs.push(id);
  const b1 = await service.from("branches").insert({ organization_id: id, slug: "uno", name: "Uno" }).select("id").single();
  const b2 = await service.from("branches").insert({ organization_id: id, slug: "dos", name: "Dos" }).select("id").single();
  if (b1.error || b2.error) throw new Error("sucursales");
  if (plan !== "pro") await setSubscription(service, id, { plan });
  if (members) {
    await addMembership(service, owner, id, "owner");
    await addMembership(service, staff, id, "staff");
  }
  return { id, branch: b1.data.id, branch2: b2.data.id };
}

const filas = async (orgId: string) => (await service.from("tables").select("*").eq("organization_id", orgId).order("created_at")).data ?? [];

beforeAll(async () => {
  service = serviceClient();
  [owner, staff, stranger] = await Promise.all([
    createUser(service, "mesasmod-owner"),
    createUser(service, "mesasmod-staff"),
    createUser(service, "mesasmod-ajeno"),
  ]);
});

afterAll(async () => {
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await Promise.all([owner, staff, stranger].map((u) => deleteUser(service, u)));
});

describe("alta, renombrar, activar y regenerar", () => {
  it("Dueño y Staff gestionan las mesas; la lista sale en orden natural por sucursal", async () => {
    const local = await nuevoLocal("tt-mesas-flujo");
    for (const [db, label] of [[owner.db, "Mesa 10"], [staff.db, "Mesa 2"], [owner.db, "Mesa 1"]] as const) {
      expect((await createTable(db, local.id, { branchId: local.branch, label: `  ${label} ` })).ok).toBe(true);
    }
    expect((await createTable(staff.db, local.id, { branchId: local.branch2, label: "Mesa 1" })).ok).toBe(true);

    const sucursales = await loadMesas(owner.db, local.id);
    expect(sucursales.map((b) => b.name)).toEqual(["Dos", "Uno"]); // las sucursales vienen por nombre
    expect(Object.fromEntries(sucursales.map((b) => [b.name, b.tables.map((t) => t.label)]))).toEqual({
      Uno: ["Mesa 1", "Mesa 2", "Mesa 10"],
      Dos: ["Mesa 1"],
    });
    expect(sucursales.flatMap((b) => b.tables).every((t) => isToken(t.qr_token) && t.is_active)).toBe(true);
  });

  it("renombrar y activar/desactivar persisten sin tocar el token; regenerar cambia solo el token", async () => {
    const local = await nuevoLocal("tt-mesas-cambios");
    const creada = await createTable(owner.db, local.id, { branchId: local.branch, label: "Mesa 1" });
    if (!creada.ok) throw new Error("alta");
    const id = creada.data.id;
    const original = (await filas(local.id))[0].qr_token;

    expect((await renameTable(staff.db, local.id, id, "Mesa uno")).ok).toBe(true);
    expect((await setTableActive(owner.db, local.id, id, false)).ok).toBe(true);
    expect((await filas(local.id))[0]).toMatchObject({ label: "Mesa uno", is_active: false, qr_token: original });

    const rota = await regenerateTableQr(staff.db, local.id, id);
    expect(rota.ok).toBe(true);
    if (!rota.ok) return;
    expect(isToken(rota.data.token)).toBe(true);
    expect(rota.data.token).not.toBe(original);
    expect((await filas(local.id))[0]).toMatchObject({ label: "Mesa uno", is_active: false, qr_token: rota.data.token });

    // Cada regeneración da uno nuevo.
    const otra = await regenerateTableQr(owner.db, local.id, id);
    expect(otra.ok && otra.data.token !== rota.data.token).toBe(true);
  });

  it("valida la etiqueta, los duplicados y la sucursal, sin guardar nada", async () => {
    const local = await nuevoLocal("tt-mesas-valida");
    expect(await createTable(owner.db, local.id, { branchId: local.branch, label: "   " })).toEqual({ ok: false, error: "label_blank" });
    expect(await createTable(owner.db, local.id, { branchId: local.branch, label: "x".repeat(41) })).toEqual({ ok: false, error: "label_too_long" });
    expect((await createTable(owner.db, local.id, { branchId: local.branch, label: "Mesa 1" })).ok).toBe(true);
    expect(await createTable(owner.db, local.id, { branchId: local.branch, label: "MESA 1" })).toEqual({ ok: false, error: "label_duplicate" });
    expect(await createTable(owner.db, local.id, { branchId: crypto.randomUUID(), label: "Mesa 2" })).toEqual({ ok: false, error: "branch_invalid" });

    const segunda = await createTable(owner.db, local.id, { branchId: local.branch, label: "Mesa 2" });
    if (!segunda.ok) throw new Error("alta");
    expect(await renameTable(owner.db, local.id, segunda.data.id, "mesa 1")).toEqual({ ok: false, error: "label_duplicate" });
    expect(await filas(local.id)).toHaveLength(2);
  });
});

describe("aislamiento", () => {
  it("una persona con dos locales no cruza datos: ids de otra sucursal u organización no existen para el otro slug", async () => {
    const a = await nuevoLocal("tt-mesas-doble-a");
    const x = await nuevoLocal("tt-mesas-doble-x"); // `owner` y `staff` son miembros de ambos
    const deX = await createTable(owner.db, x.id, { branchId: x.branch, label: "De X" });
    if (!deX.ok) throw new Error("alta");
    const antes = JSON.stringify(await filas(x.id));

    expect((await loadMesas(owner.db, a.id)).flatMap((b) => b.tables)).toHaveLength(0);
    expect(await renameTable(owner.db, a.id, deX.data.id, "Robada")).toEqual({ ok: false, error: "not_found" });
    expect(await setTableActive(owner.db, a.id, deX.data.id, false)).toEqual({ ok: false, error: "not_found" });
    expect(await regenerateTableQr(owner.db, a.id, deX.data.id)).toEqual({ ok: false, error: "not_found" });
    // La sucursal de X no sirve para el local A.
    expect(await createTable(owner.db, a.id, { branchId: x.branch, label: "Cruzada" })).toEqual({ ok: false, error: "branch_invalid" });
    expect(JSON.stringify(await filas(x.id))).toBe(antes);
  });

  it("quien no es miembro no escribe en ningún local", async () => {
    const local = await nuevoLocal("tt-mesas-ajeno");
    const creada = await createTable(owner.db, local.id, { branchId: local.branch, label: "Mesa 1" });
    if (!creada.ok) throw new Error("alta");
    const antes = JSON.stringify(await filas(local.id));

    for (const intento of [
      await createTable(stranger.db, local.id, { branchId: local.branch, label: "Intruso" }),
      await renameTable(stranger.db, local.id, creada.data.id, "Robada"),
      await setTableActive(stranger.db, local.id, creada.data.id, false),
      await regenerateTableQr(stranger.db, local.id, creada.data.id),
    ]) {
      expect(intento.ok).toBe(false);
    }
    expect(JSON.stringify(await filas(local.id))).toBe(antes);
  });
});

describe("tope de mesas activas (53400)", () => {
  it("al llegar al tope, crear activa y activar dicen «limit»; desactivar, renombrar y regenerar siguen", async () => {
    const local = await nuevoLocal("tt-mesas-tope", "basic");
    const lote = Array.from({ length: 20 }, (_, i) => ({ organization_id: local.id, branch_id: local.branch, label: `M${i + 1}` }));
    expect((await service.from("tables").insert(lote)).error).toBeNull();
    const dormida = await service
      .from("tables")
      .insert({ organization_id: local.id, branch_id: local.branch, label: "Dormida", is_active: false })
      .select("id")
      .single();

    expect(await createTable(owner.db, local.id, { branchId: local.branch, label: "M21" })).toEqual({ ok: false, error: "limit" });
    expect(await setTableActive(staff.db, local.id, dormida.data!.id, true)).toEqual({ ok: false, error: "limit" });
    expect((await filas(local.id)).filter((t) => t.is_active)).toHaveLength(20);

    // Una activa sigue pudiendo renombrarse y regenerarse; crear una inactiva se permite.
    const primera = (await filas(local.id))[0];
    expect((await renameTable(owner.db, local.id, primera.id, "Primera")).ok).toBe(true);
    expect((await regenerateTableQr(owner.db, local.id, primera.id)).ok).toBe(true);
    expect((await createTable(owner.db, local.id, { branchId: local.branch, label: "Guardada", active: false })).ok).toBe(true);

    // Otra sucursal tiene su propio cupo; desactivar libera el cupo de la primera.
    expect((await createTable(owner.db, local.id, { branchId: local.branch2, label: "M1" })).ok).toBe(true);
    expect((await setTableActive(owner.db, local.id, primera.id, false)).ok).toBe(true);
    expect((await setTableActive(staff.db, local.id, dormida.data!.id, true)).ok).toBe(true);
  });
});

describe("cuenta que no puede escribir", () => {
  type Bloqueo = "blocked_read_only" | "blocked_suspended";
  const casos: [string, number, Bloqueo][] = [
    ["solo lectura", 10, "blocked_read_only"],
    ["suspendida", 20, "blocked_suspended"],
  ];

  async function conMesas(slug: string) {
    const local = await nuevoLocal(slug);
    const m = await createTable(owner.db, local.id, { branchId: local.branch, label: "Mesa 1" });
    if (!m.ok) throw new Error("alta");
    return { local, id: m.data.id };
  }

  it.each(casos)("en %s ninguna acción escribe y todas dicen por qué", async (_nombre, dias, bloqueo) => {
    const { local, id } = await conMesas(`tt-mesas-mora-${bloqueo.slice(8, 12)}`);
    const antes = JSON.stringify(await filas(local.id));
    await setSubscription(service, local.id, { finEnMs: -dias * DIA_MS });

    for (const db of [owner.db, staff.db]) {
      const intentos = await Promise.all([
        createTable(db, local.id, { branchId: local.branch, label: "Nueva" }),
        renameTable(db, local.id, id, "Cambiada"),
        setTableActive(db, local.id, id, false),
        regenerateTableQr(db, local.id, id),
      ]);
      for (const r of intentos) expect(r).toEqual({ ok: false, error: bloqueo });
    }
    expect(JSON.stringify(await filas(local.id))).toBe(antes);
    expect((await loadMesas(owner.db, local.id)).flatMap((b) => b.tables)).toHaveLength(1); // se sigue leyendo
  });

  it.each(casos)(
    "si el estado cambia justo después de comprobarlo (%s), la base descarta la escritura y NO se informa un éxito",
    async (_nombre, dias, bloqueo) => {
      const { local, id } = await conMesas(`tt-mesas-carrera-${bloqueo.slice(8, 12)}`);
      await setSubscription(service, local.id, { finEnMs: -dias * DIA_MS });
      const antes = JSON.stringify(await filas(local.id));

      // Simula una comprobación desactualizada: la PRIMERA lectura de org_entitlements dice que se puede escribir.
      const rezagado = (db: Db): Db => {
        let primera = true;
        return new Proxy(db, {
          get(target, prop, receiver) {
            if (prop === "rpc") {
              return async (fn: string, args: { p_org: string }) => {
                const real = await target.rpc("org_entitlements", args);
                if (fn === "org_entitlements" && primera) {
                  primera = false;
                  return { ...real, data: { ...(real.data as object), can_write: true, state: "active" } };
                }
                return real;
              };
            }
            return Reflect.get(target, prop, receiver);
          },
        });
      };

      const results = [
        await renameTable(rezagado(owner.db), local.id, id, "Cambiada"),
        await setTableActive(rezagado(staff.db), local.id, id, false),
        await regenerateTableQr(rezagado(owner.db), local.id, id),
        await createTable(rezagado(owner.db), local.id, { branchId: local.branch, label: "Nueva" }),
      ];
      for (const [i, r] of results.entries()) expect(r, `intento ${i}`).toEqual({ ok: false, error: bloqueo });
      expect(JSON.stringify(await filas(local.id))).toBe(antes);
    },
  );

  it("en gracia se edita con normalidad", async () => {
    const { local, id } = await conMesas("tt-mesas-gracia");
    await setSubscription(service, local.id, { finEnMs: -3 * DIA_MS });
    expect((await renameTable(staff.db, local.id, id, "En gracia")).ok).toBe(true);
    expect((await regenerateTableQr(owner.db, local.id, id)).ok).toBe(true);
  });
});

import { spawn } from "node:child_process";
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
  sql,
  type Db,
  type PlanCode,
  type TestUser,
} from "./helpers";
import { createBranch, loadSucursales, setBranchActive } from "@/lib/sucursales/branches";
import { loadMesas } from "@/lib/mesas/tables";
import { loadLlamadoConfig } from "@/lib/llamados/config";
import { loadSala } from "@/lib/sala/pending";

/**
 * Desactivar y reactivar sucursales contra el Supabase local (ficha desactivar-sucursales; migración
 * desactivar_sucursales): solo el Dueño y con la cuenta al día; la inactiva no cuenta para el tope y reactivar lo respeta;
 * su carta, su alias y los QR de sus mesas dicen «no disponible»; no admite llamados nuevos; las mesas no se tocan.
 */

let service: Db;
let owner: TestUser;
let staff: TestUser;
let stranger: TestUser;
const orgs: string[] = [];

type Local = { id: string; slug: string; branch: string; table: string; token: string };

/** Un local con una sucursal («principal») y una mesa. `owner` es Dueño y `staff` es Personal. */
async function nuevoLocal(slug: string, plan: PlanCode = "pro"): Promise<Local> {
  const id = await createOrg(service, slug, plan);
  orgs.push(id);
  const b = await service.from("branches").insert({ organization_id: id, slug: "principal", name: "Principal" }).select("id").single();
  if (b.error) throw new Error(`sucursal inicial: ${b.error.message}`);
  const t = await service.from("tables").insert({ organization_id: id, branch_id: b.data.id, label: "Mesa 1" }).select("id, qr_token").single();
  if (t.error) throw new Error(`mesa inicial: ${t.error.message}`);
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  return { id, slug, branch: b.data.id, table: t.data.id, token: t.data.qr_token };
}

const activa = async (branchId: string) => (await service.from("branches").select("is_active").eq("id", branchId).single()).data?.is_active;
const estado = (local: Local, branch = "principal") =>
  anonClient().rpc("public_menu_status", { p_org_slug: local.slug, p_branch_slug: branch });
const llamar = (token: string, kind = "waiter") => anonClient().rpc("create_waiter_call", { p_token: token, p_kind: kind });
const uso = async (orgId: string) => {
  const { data } = await owner.db.rpc("org_entitlements", { p_org: orgId });
  return (data as { usage: { branches: number } }).usage.branches;
};

beforeAll(async () => {
  service = serviceClient();
  [owner, staff, stranger] = await Promise.all([
    createUser(service, "desactivar-owner"),
    createUser(service, "desactivar-staff"),
    createUser(service, "desactivar-ajeno"),
  ]);
});

afterAll(async () => {
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await Promise.all([owner, staff, stranger].map((u) => deleteUser(service, u)));
});

describe("el Dueño desactiva y reactiva", () => {
  it("desactivar y reactivar persiste; el resto de los datos de la sucursal no cambia", async () => {
    const local = await nuevoLocal("tt-des-ciclo");
    const antes = (await service.from("branches").select("slug, name, slug_aliases").eq("id", local.branch).single()).data;

    expect((await setBranchActive(owner.db, local.id, local.branch, false)).ok).toBe(true);
    expect(await activa(local.branch)).toBe(false);
    expect((await setBranchActive(owner.db, local.id, local.branch, true)).ok).toBe(true);
    expect(await activa(local.branch)).toBe(true);

    expect((await service.from("branches").select("slug, name, slug_aliases").eq("id", local.branch).single()).data).toEqual(antes);
  });

  it("repetir el mismo estado es idempotente (no alterna a ciegas)", async () => {
    const local = await nuevoLocal("tt-des-idem");
    expect((await setBranchActive(owner.db, local.id, local.branch, false)).ok).toBe(true);
    expect((await setBranchActive(owner.db, local.id, local.branch, false)).ok).toBe(true);
    expect(await activa(local.branch)).toBe(false);
  });

  it("se puede desactivar la última sucursal activa: el local queda sin carta pública hasta reactivar", async () => {
    const local = await nuevoLocal("tt-des-ultima");
    expect((await estado(local)).data).toBe("available");
    expect((await setBranchActive(owner.db, local.id, local.branch, false)).ok).toBe(true);
    expect((await estado(local)).data).toBe("inactive");
    expect((await setBranchActive(owner.db, local.id, local.branch, true)).ok).toBe(true);
    expect((await estado(local)).data).toBe("available");
  });

  it("una sucursal que no es de este local es «no encontrada» y no se toca", async () => {
    const a = await nuevoLocal("tt-des-ajena-a");
    const b = await nuevoLocal("tt-des-ajena-b");
    const r = await setBranchActive(owner.db, a.id, b.branch, false);
    expect(r).toEqual({ ok: false, error: "not_found" });
    expect(await activa(b.branch)).toBe(true);
  });
});

describe("quién puede cambiar el estado", () => {
  it("el Staff, un ajeno y el anónimo no cambian el estado (ni por la API directa)", async () => {
    const local = await nuevoLocal("tt-des-roles");

    for (const [quien, db] of [["staff", staff.db], ["ajeno", stranger.db], ["anónimo", anonClient()]] as const) {
      const r = await db.from("branches").update({ is_active: false }).eq("id", local.branch).select("id");
      expect(r.data ?? [], quien).toEqual([]);
      expect(await activa(local.branch), quien).toBe(true);
    }
    const viaModulo = await setBranchActive(staff.db, local.id, local.branch, false);
    expect(viaModulo.ok).toBe(false);
    expect(await activa(local.branch)).toBe(true);

    await service.from("branches").update({ is_active: false }).eq("id", local.branch);
    for (const [quien, db] of [["staff", staff.db], ["ajeno", stranger.db]] as const) {
      const r = await db.from("branches").update({ is_active: true }).eq("id", local.branch).select("id");
      expect(r.data ?? [], quien).toEqual([]);
    }
    expect(await activa(local.branch)).toBe(false);
  });

  it("la API no deja fijar is_active al crear (nace activa) ni tocar slug, organización o id al cambiar el estado", async () => {
    const local = await nuevoLocal("tt-des-columnas", "premium");
    const alta = await owner.db.from("branches").insert({ organization_id: local.id, slug: "otra", name: "Otra", is_active: false }).select("id");
    expect(alta.error?.code).toBe("42501");

    const creada = await createBranch(owner.db, local.id, { name: "Otra", slug: "otra" });
    expect(creada.ok).toBe(true);
    const otra = await service.from("branches").select("id, is_active").eq("slug", "otra").eq("organization_id", local.id).single();
    expect(otra.data?.is_active).toBe(true);

    const slug = await owner.db.from("branches").update({ slug: "cambiada" }).eq("id", local.branch).select("id");
    expect(slug.error?.code).toBe("42501");
  });

  it("nadie borra una sucursal", async () => {
    const local = await nuevoLocal("tt-des-borrar");
    const r = await owner.db.from("branches").delete().eq("id", local.branch).select("id");
    expect(r.data ?? []).toEqual([]);
    expect(await activa(local.branch)).toBe(true);
  });
});

describe("tope del plan: la inactiva no cuenta y reactivar lo respeta", () => {
  it("Básico (1): desactivar libera el cupo, se crea otra, y reactivar la primera se rechaza sin cambiar nada", async () => {
    const local = await nuevoLocal("tt-des-tope-basico", "basic");
    expect((await createBranch(owner.db, local.id, { name: "Segunda", slug: "segunda" })).ok).toBe(false);

    expect((await setBranchActive(owner.db, local.id, local.branch, false)).ok).toBe(true);
    expect(await uso(local.id)).toBe(0);
    const nueva = await createBranch(owner.db, local.id, { name: "Segunda", slug: "segunda" });
    expect(nueva.ok).toBe(true);
    expect(await uso(local.id)).toBe(1);

    const reactivar = await setBranchActive(owner.db, local.id, local.branch, true);
    expect(reactivar).toEqual({ ok: false, error: "limit_reactivate" });
    expect(await activa(local.branch)).toBe(false);
    expect(await uso(local.id)).toBe(1);
  });

  it("Pro (2): con una inactiva caben dos activas; la tercera no se crea ni se reactiva", async () => {
    const local = await nuevoLocal("tt-des-tope-pro", "pro");
    expect((await createBranch(owner.db, local.id, { name: "Segunda", slug: "segunda" })).ok).toBe(true);
    expect((await setBranchActive(owner.db, local.id, local.branch, false)).ok).toBe(true);
    expect((await createBranch(owner.db, local.id, { name: "Tercera", slug: "tercera" })).ok).toBe(true);
    expect(await uso(local.id)).toBe(2);
    expect((await createBranch(owner.db, local.id, { name: "Cuarta", slug: "cuarta" })).ok).toBe(false);
    expect(await setBranchActive(owner.db, local.id, local.branch, true)).toEqual({ ok: false, error: "limit_reactivate" });
    expect(await loadSucursales(owner.db, local.id)).toHaveLength(3);
  });

  it("Premium no tiene tope: reactivar siempre entra", async () => {
    const local = await nuevoLocal("tt-des-tope-premium", "premium");
    for (const n of ["a", "b", "c"]) await createBranch(owner.db, local.id, { name: n, slug: n });
    expect((await setBranchActive(owner.db, local.id, local.branch, false)).ok).toBe(true);
    expect((await setBranchActive(owner.db, local.id, local.branch, true)).ok).toBe(true);
  });

  it("renombrar con el tope alcanzado y una activa sigue permitido (no consume cupo)", async () => {
    const local = await nuevoLocal("tt-des-renombrar", "basic");
    const r = await owner.db.from("branches").update({ name: "Nuevo" }).eq("id", local.branch).select("name");
    expect(r.data).toEqual([{ name: "Nuevo" }]);
  });

  it("pedidos paralelos de reactivación con un solo cupo libre: se reactiva exactamente una", async () => {
    const local = await nuevoLocal("tt-des-carrera", "pro");
    const ids = [local.branch];
    for (const n of ["b", "c", "d"]) {
      // Las inactivas se cargan por el servidor (sin tope): quedan 3 inactivas y 0 activas más la inicial.
      const b = await service.from("branches").insert({ organization_id: local.id, slug: n, name: n, is_active: false }).select("id").single();
      if (b.error) throw new Error(b.error.message);
      ids.push(b.data.id);
    }
    // Pro (2): hay 1 activa; queda un cupo. Tres reactivaciones simultáneas: entra una sola.
    const resultados = await Promise.all(ids.slice(1).map((id) => setBranchActive(owner.db, local.id, id, true)));
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(resultados.filter((r) => !r.ok && r.error === "limit_reactivate")).toHaveLength(2);
    expect(await uso(local.id)).toBe(2);
  });
});

describe("publicación: carta, alias y QR dicen «no disponible»", () => {
  it("la inactiva no se lee por la API pública; las demás sucursales no cambian", async () => {
    const local = await nuevoLocal("tt-des-publica", "pro");
    await createBranch(owner.db, local.id, { name: "Segunda", slug: "segunda" });
    await setBranchActive(owner.db, local.id, local.branch, false);

    const publica = await anonClient().from("branches").select("slug").eq("organization_id", local.id);
    expect(publica.data).toEqual([{ slug: "segunda" }]);
    expect((await estado(local, "principal")).data).toBe("inactive");
    expect((await estado(local, "segunda")).data).toBe("available");
    expect((await estado(local, "inventada")).data).toBeNull();

    // Los miembros siguen viendo las dos (para poder reactivar).
    expect(await loadSucursales(owner.db, local.id)).toHaveLength(2);
    expect((await staff.db.from("branches").select("slug").eq("organization_id", local.id)).data).toHaveLength(2);
  });

  it("el alias de una sucursal inactiva dice «no disponible» igual que su dirección actual, y sigue reservado", async () => {
    const local = await nuevoLocal("tt-des-alias", "pro");
    await service.from("branches").update({ slug: "central" }).eq("id", local.branch); // «principal» pasa a alias
    expect((await estado(local, "principal")).data).toBe("available");

    await setBranchActive(owner.db, local.id, local.branch, false);
    expect((await estado(local, "principal")).data).toBe("inactive");
    expect((await estado(local, "central")).data).toBe("inactive");

    // Reservados mientras esté inactiva: ni el slug ni el alias se pueden tomar.
    for (const slug of ["central", "principal"]) {
      const r = await createBranch(owner.db, local.id, { name: "Intruso", slug });
      expect(r.ok, slug).toBe(false);
    }
  });

  it("la cuenta suspendida tiene prioridad sobre la sucursal inactiva", async () => {
    const local = await nuevoLocal("tt-des-prioridad");
    await setBranchActive(owner.db, local.id, local.branch, false);
    await setSubscription(service, local.id, { finEnMs: -30 * DIA_MS });
    expect((await estado(local)).data).toBe("suspended");
    const qr = await anonClient().rpc("resolve_table_qr", { p_token: local.token });
    expect(qr.data).toMatchObject({ status: "suspended", calls_enabled: false });
  });

  it("el QR de una mesa de la inactiva dice «inactive», sin botones de llamado; al reactivar vuelve a funcionar con el mismo token", async () => {
    const local = await nuevoLocal("tt-des-qr");
    expect((await anonClient().rpc("resolve_table_qr", { p_token: local.token })).data).toMatchObject({
      status: "available",
      calls_enabled: true,
    });

    await setBranchActive(owner.db, local.id, local.branch, false);
    expect((await anonClient().rpc("resolve_table_qr", { p_token: local.token })).data).toMatchObject({
      org_slug: local.slug,
      status: "inactive",
      calls_enabled: false,
    });

    await setBranchActive(owner.db, local.id, local.branch, true);
    expect((await anonClient().rpc("resolve_table_qr", { p_token: local.token })).data).toMatchObject({
      status: "available",
      calls_enabled: true,
    });
    const mesa = await service.from("tables").select("qr_token, is_active").eq("id", local.table).single();
    expect(mesa.data).toEqual({ qr_token: local.token, is_active: true });
  });
});

describe("llamados y mesas", () => {
  it("sin llamados nuevos para las mesas de una inactiva; el pendiente que ya existía no se pierde; al reactivar se llama de nuevo", async () => {
    const local = await nuevoLocal("tt-des-llamados");
    expect((await llamar(local.token, "waiter")).data).toEqual({ status: "created" });

    await setBranchActive(owner.db, local.id, local.branch, false);
    expect((await llamar(local.token, "bill")).data).toEqual({ status: "unavailable" });
    const filas = await service.from("waiter_calls").select("kind, status").eq("table_id", local.table);
    expect(filas.data).toEqual([{ kind: "waiter", status: "pending" }]); // ni se creó otro ni se tocó el pendiente

    await setBranchActive(owner.db, local.id, local.branch, true);
    expect((await llamar(local.token, "bill")).data).toEqual({ status: "created" });
  });

  it("carrera: un llamado que esperaba el lock de la mesa no usa un estado viejo de la sucursal (revisión de Codex, ronda 1)", async () => {
    const local = await nuevoLocal("tt-des-carrera-llamado");
    const contenedor = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_ucomenu";
    // Otra transacción retiene el lock de la mesa hasta que la prueba la libera por stdin (sin tiempos fijos: el rol anon
    // corta cualquier sentencia a los pocos segundos).
    const retenedor = spawn("docker", ["exec", "-i", contenedor, "psql", "-U", "postgres", "-q"], { stdio: ["pipe", "ignore", "ignore"] });
    retenedor.stdin.write(`begin; select pg_advisory_xact_lock(hashtextextended('waiter_call:${local.table}', 0));${String.fromCharCode(10)}`);
    const terminado = new Promise((resolve) => retenedor.on("close", resolve));
    // Sin esperas a ciegas: se avanza solo cuando pg_locks muestra que el retenedor TIENE el lock y que el llamado ESPERA.
    const hasta = async (descripcion: string, consulta: string) => {
      for (let i = 0; i < 100; i++) {
        if (sql(consulta)[0]?.[0] === "1") return;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`No se alcanzó: ${descripcion}`);
    };
    // El lock advisory de 64 bits se parte en classid (32 altos) y objid (32 bajos) en pg_locks: se identifica por su clave exacta.
    const lockDeLaMesa = (granted: boolean) =>
      `select (count(*) > 0)::int from pg_locks l,
         (select hashtextextended('waiter_call:${local.table}', 0) as k) h
       where l.locktype = 'advisory' and l.granted = ${granted}
         and l.classid::bigint = ((h.k >> 32) & 4294967295) and l.objid::bigint = (h.k & 4294967295)`;
    await hasta("el retenedor tiene el lock de la mesa", lockDeLaMesa(true));

    const llamado = llamar(local.token, "waiter").then((r) => r); // el builder es perezoso: .then() lo envía ya
    await hasta("el llamado espera el lock de la mesa", lockDeLaMesa(false));
    await service.from("branches").update({ is_active: false }).eq("id", local.branch); // se confirma mientras el llamado espera
    retenedor.stdin.end(`commit;${String.fromCharCode(10)}`); // libera el lock (y cierra psql al llegar al fin de la entrada)
    const respuesta = await llamado;
    expect(respuesta.error, JSON.stringify(respuesta.error)).toBeNull();
    expect(respuesta.data).toEqual({ status: "unavailable" });
    await terminado;
    expect((await service.from("waiter_calls").select("id").eq("table_id", local.table)).data).toEqual([]);
  });

  it("las mesas se conservan intactas al desactivar y reactivar (token, etiqueta, estado, silencio)", async () => {
    const local = await nuevoLocal("tt-des-mesas");
    await service.from("tables").update({ is_active: false }).eq("id", local.table);
    const antes = (await service.from("tables").select("*").eq("id", local.table).single()).data;
    await setBranchActive(owner.db, local.id, local.branch, false);
    await setBranchActive(owner.db, local.id, local.branch, true);
    expect((await service.from("tables").select("*").eq("id", local.table).single()).data).toEqual(antes);
  });

  it("la Sala, las Mesas y los Llamados del panel muestran solo las sucursales activas", async () => {
    const local = await nuevoLocal("tt-des-panel", "pro");
    await createBranch(owner.db, local.id, { name: "Segunda", slug: "segunda" });
    expect((await llamar(local.token)).data).toEqual({ status: "created" });

    expect((await loadMesas(owner.db, local.id)).map((b) => b.slug)).toEqual(["principal", "segunda"]);
    expect((await loadLlamadoConfig(owner.db, local.id)).map((b) => b.name)).toEqual(["Principal", "Segunda"]);
    expect((await loadSala(owner.db, local.id)).calls).toHaveLength(1);

    await setBranchActive(owner.db, local.id, local.branch, false);
    expect((await loadMesas(owner.db, local.id)).map((b) => b.slug)).toEqual(["segunda"]);
    expect((await loadLlamadoConfig(owner.db, local.id)).map((b) => b.name)).toEqual(["Segunda"]);
    const sala = await loadSala(owner.db, local.id);
    expect(sala.calls).toEqual([]);
    expect(sala.multiBranch).toBe(false);

    // El llamado pendiente sigue guardado: reaparece al reactivar si no venció.
    await setBranchActive(owner.db, local.id, local.branch, true);
    expect((await loadSala(owner.db, local.id)).calls).toHaveLength(1);
  });
});

describe("cuenta bloqueada: sin falsos éxitos", () => {
  it("gracia: se cambia el estado; solo lectura y suspendida: ni se desactiva ni se reactiva, ni por la API directa", async () => {
    const local = await nuevoLocal("tt-des-bloqueo");

    await setSubscription(service, local.id, { finEnMs: -DIA_MS }); // venció ayer: gracia
    expect((await setBranchActive(owner.db, local.id, local.branch, false)).ok).toBe(true);
    expect((await setBranchActive(owner.db, local.id, local.branch, true)).ok).toBe(true);

    for (const [finEnMs, error] of [[-10 * DIA_MS, "blocked_read_only"], [-30 * DIA_MS, "blocked_suspended"]] as const) {
      await setSubscription(service, local.id, { finEnMs });

      expect(await setBranchActive(owner.db, local.id, local.branch, false), error).toEqual({ ok: false, error });
      expect(await activa(local.branch), error).toBe(true);

      await service.from("branches").update({ is_active: false }).eq("id", local.branch);
      expect(await setBranchActive(owner.db, local.id, local.branch, true), error).toEqual({ ok: false, error });
      const directo = await owner.db.from("branches").update({ is_active: true }).eq("id", local.branch).select("id");
      expect(directo.data ?? [], error).toEqual([]);
      expect(await activa(local.branch), error).toBe(false);
      await service.from("branches").update({ is_active: true }).eq("id", local.branch);
    }
  });
});

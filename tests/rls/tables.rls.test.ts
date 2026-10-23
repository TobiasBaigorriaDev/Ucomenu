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
  type TestUser,
} from "./helpers";

/**
 * Mesas y QR (ficha mesas-y-qr, ADR 0009) en la base: permisos por columna, RLS, token generado por la base,
 * tope por sucursal, cuenta bloqueada y la función pública de resolución. Contra el Supabase local.
 */

const TOKEN = /^[0-9a-f]{32}$/;
const LIMIT_EXCEEDED = "53400";

let service: Db;
let owner: TestUser;
let staff: TestUser;
let ajeno: TestUser; // dueño de otra organización
const orgs: string[] = [];

type Local = { id: string; branch: string; branch2: string };

async function nuevoLocal(slug: string, plan: "basic" | "pro" = "basic"): Promise<Local> {
  // Básico solo admite una sucursal: se crean con Pro y después se baja el plan (el tope de sucursales solo
  // se aplica al crear; bajar de plan no borra datos).
  const id = await createOrg(service, slug, "pro");
  orgs.push(id);
  const b1 = await service.from("branches").insert({ organization_id: id, slug: "uno", name: "Uno" }).select("id").single();
  const b2 = await service.from("branches").insert({ organization_id: id, slug: "dos", name: "Dos" }).select("id").single();
  if (b1.error || b2.error) throw new Error(`No se crearon las sucursales: ${b1.error?.message ?? b2.error?.message}`);
  if (plan !== "pro") await setSubscription(service, id, { plan });
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  return { id, branch: b1.data.id, branch2: b2.data.id };
}

const crear = (db: Db, local: Local, label: string, extra: Record<string, unknown> = {}) =>
  db.from("tables").insert({ organization_id: local.id, branch_id: local.branch, label, ...extra }).select("id, qr_token, is_active, label").single();

async function tokenDe(id: string): Promise<string> {
  const { data } = await service.from("tables").select("qr_token").eq("id", id).single();
  return data!.qr_token;
}

beforeAll(async () => {
  service = serviceClient();
  [owner, staff, ajeno] = await Promise.all([
    createUser(service, "mesas-owner"),
    createUser(service, "mesas-staff"),
    createUser(service, "mesas-ajeno"),
  ]);
});

afterAll(async () => {
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await Promise.all([owner, staff, ajeno].map((u) => deleteUser(service, u)));
});

describe("alta, lectura y token", () => {
  it("el Dueño y el Staff crean mesas; el token lo genera la base (32 hex distintos)", async () => {
    const local = await nuevoLocal("tt-mesa-alta");
    const a = await crear(owner.db, local, "Mesa 1");
    const b = await crear(staff.db, local, "Mesa 2");
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect(a.data?.qr_token).toMatch(TOKEN);
    expect(b.data?.qr_token).toMatch(TOKEN);
    expect(a.data?.qr_token).not.toBe(b.data?.qr_token);
    expect(a.data?.is_active).toBe(true);

    const lista = await staff.db.from("tables").select("label").eq("branch_id", local.branch).order("label");
    expect(lista.data?.map((m) => m.label)).toEqual(["Mesa 1", "Mesa 2"]);
  });

  it("nadie fija el token al crear (permiso por columna) ni cambia sucursal u organización después", async () => {
    const local = await nuevoLocal("tt-mesa-cols");
    const fijado = await crear(owner.db, local, "Mesa 1", { qr_token: "a".repeat(32) });
    expect(fijado.error?.code).toBe("42501");

    const mesa = await crear(owner.db, local, "Mesa 1");
    const id = mesa.data!.id;
    for (const cambio of [{ branch_id: local.branch2 }, { organization_id: local.id }, { id: crypto.randomUUID() }, { created_at: new Date().toISOString() }]) {
      const r = await owner.db.from("tables").update(cambio).eq("id", id).select("id");
      expect(r.error?.code, JSON.stringify(cambio)).toBe("42501");
    }
  });

  it("etiqueta vacía, de más de 40 caracteres o repetida (sin distinguir mayúsculas) se rechaza; otra sucursal puede repetirla", async () => {
    const local = await nuevoLocal("tt-mesa-label");
    expect((await crear(owner.db, local, "   ")).error?.code).toBe("23514");
    expect((await crear(owner.db, local, "x".repeat(41))).error?.code).toBe("23514");
    expect((await crear(owner.db, local, "x".repeat(40))).error).toBeNull();

    expect((await crear(owner.db, local, "Mesa 1")).error).toBeNull();
    expect((await crear(owner.db, local, "mesa 1")).error?.code).toBe("23505");
    expect((await crear(owner.db, local, "  MESA 1 ")).error?.code).toBe("23505");

    const otra = await owner.db.from("tables").insert({ organization_id: local.id, branch_id: local.branch2, label: "Mesa 1" });
    expect(otra.error).toBeNull();
  });
});

describe("regenerar el token", () => {
  it("tocar qr_token pone uno nuevo generado por la base; el valor enviado se descarta", async () => {
    const local = await nuevoLocal("tt-mesa-rota");
    const mesa = await crear(owner.db, local, "Mesa 1");
    const id = mesa.data!.id;
    const original = mesa.data!.qr_token;

    const elegido = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    for (const enviado of ["regenerar", elegido, "0".repeat(32)]) {
      const antes = await tokenDe(id);
      const r = await staff.db.from("tables").update({ qr_token: enviado }).eq("id", id).select("qr_token");
      expect(r.error).toBeNull();
      const nuevo = r.data![0].qr_token;
      expect(nuevo).toMatch(TOKEN);
      expect(nuevo).not.toBe(enviado);
      expect(nuevo).not.toBe(antes);
    }
    expect(await tokenDe(id)).not.toBe(original);
  });

  it("mandar el valor actual, o cambiar solo otros campos, no regenera", async () => {
    const local = await nuevoLocal("tt-mesa-igual");
    const mesa = await crear(owner.db, local, "Mesa 1");
    const id = mesa.data!.id;
    const original = mesa.data!.qr_token;

    await owner.db.from("tables").update({ qr_token: original }).eq("id", id);
    expect(await tokenDe(id)).toBe(original);

    await owner.db.from("tables").update({ label: "Mesa uno", is_active: false }).eq("id", id);
    expect(await tokenDe(id)).toBe(original);
  });

  it("una persona de otra organización no puede regenerar ni cambiar la mesa", async () => {
    const local = await nuevoLocal("tt-mesa-ajena");
    const mesa = await crear(owner.db, local, "Mesa 1");
    const original = mesa.data!.qr_token;

    const r = await ajeno.db.from("tables").update({ qr_token: "x", label: "Robada" }).eq("id", mesa.data!.id).select("id");
    expect(r.data ?? []).toHaveLength(0);
    expect(await tokenDe(mesa.data!.id)).toBe(original);
    expect((await service.from("tables").select("label").eq("id", mesa.data!.id).single()).data?.label).toBe("Mesa 1");
  });
});

describe("aislamiento", () => {
  it("anónimos no leen ni escriben la tabla; otra organización no ve ni escribe las mesas ajenas", async () => {
    const local = await nuevoLocal("tt-mesa-aisla");
    await crear(owner.db, local, "Mesa 1");

    const anon = anonClient();
    expect((await anon.from("tables").select("id")).error?.code).toBe("42501");
    expect((await anon.from("tables").select("qr_token")).error?.code).toBe("42501");
    expect((await anon.from("tables").insert({ organization_id: local.id, branch_id: local.branch, label: "X" })).error?.code).toBe("42501");

    const ve = await ajeno.db.from("tables").select("id").eq("organization_id", local.id);
    expect(ve.data ?? []).toHaveLength(0);
    const inserta = await ajeno.db.from("tables").insert({ organization_id: local.id, branch_id: local.branch, label: "Intruso" });
    expect(inserta.error?.code).toBe("42501");
    // anon no borra por la API (sin permiso); una persona de otra organización afecta 0 filas (RLS) y el borrado de mesas
    // de los miembros se prueba en mesas.rls.test.ts (ficha borrado-de-mesas).
    expect((await anon.from("tables").delete().eq("organization_id", local.id)).error?.code).toBe("42501");
    const ajenoBorra = await ajeno.db.from("tables").delete().eq("organization_id", local.id).select("id");
    expect(ajenoBorra.error).toBeNull();
    expect(ajenoBorra.data).toHaveLength(0);
    expect((await service.from("tables").select("id").eq("organization_id", local.id)).data).toHaveLength(1);
  });

  it("una sucursal de otra organización no sirve: la clave compuesta lo rechaza y no se filtra el uso", async () => {
    const mia = await nuevoLocal("tt-mesa-mia");
    const otra = await nuevoLocal("tt-mesa-otra");
    // Llena la sucursal ajena hasta el tope para que, si el trigger contara, saltara 53400 con datos.
    const filas = Array.from({ length: 20 }, (_, i) => ({ organization_id: otra.id, branch_id: otra.branch, label: `M${i + 1}` }));
    expect((await service.from("tables").insert(filas)).error).toBeNull();

    // Soy miembro de AMBAS (el helper los suma): ni así se puede cruzar organización y sucursal.
    const r = await owner.db.from("tables").insert({ organization_id: mia.id, branch_id: otra.branch, label: "Cruzada" });
    expect(r.error?.code).toBe("23503");
    expect(JSON.stringify(r.error)).not.toMatch(/limit|active|53400|cupo|plan/i);

    // Una persona sin ninguna membresía en la organización llena: 42501 sin pistas del tope.
    const intruso = await ajeno.db.from("tables").insert({ organization_id: otra.id, branch_id: otra.branch, label: "Intruso" });
    expect(intruso.error?.code).toBe("42501");
    expect(JSON.stringify(intruso.error)).not.toMatch(/limit|active|53400|cupo|plan/i);
  });
});

describe("tope de mesas activas por sucursal (53400)", () => {
  it("Básico (20 por sucursal): bloquea crear activa y activar al llegar al tope; desactivar, editar y crear inactiva siguen", async () => {
    const local = await nuevoLocal("tt-mesa-tope", "basic");
    const filas = Array.from({ length: 20 }, (_, i) => ({ organization_id: local.id, branch_id: local.branch, label: `M${i + 1}` }));
    expect((await service.from("tables").insert(filas)).error).toBeNull();
    const dormida = await service
      .from("tables")
      .insert({ organization_id: local.id, branch_id: local.branch, label: "Dormida", is_active: false })
      .select("id")
      .single();
    expect(dormida.error).toBeNull();

    const porApi = await crear(owner.db, local, "M21");
    const porServidor = await service.from("tables").insert({ organization_id: local.id, branch_id: local.branch, label: "M21" });
    expect(porApi.error?.code).toBe(LIMIT_EXCEEDED);
    expect(porServidor.error?.code).toBe(LIMIT_EXCEEDED);
    expect(porApi.error?.message).toContain("limit_exceeded:tables_per_branch");

    // Activar una inactiva también se bloquea.
    const activar = await staff.db.from("tables").update({ is_active: true }).eq("id", dormida.data!.id).select("id");
    expect(activar.error?.code).toBe(LIMIT_EXCEEDED);

    // Crear inactiva, editar una activa y desactivar: sí.
    expect((await crear(owner.db, local, "Inactiva nueva", { is_active: false })).error).toBeNull();
    const editar = await owner.db.from("tables").update({ label: "M1 editada" }).eq("organization_id", local.id).eq("label", "M1").select("id");
    expect(editar.error).toBeNull();
    expect(editar.data).toHaveLength(1);
    const desactivar = await owner.db.from("tables").update({ is_active: false }).eq("organization_id", local.id).eq("label", "M2").select("id");
    expect(desactivar.error).toBeNull();

    // Con el cupo liberado, ahora sí.
    const ahora = await staff.db.from("tables").update({ is_active: true }).eq("id", dormida.data!.id).select("id");
    expect(ahora.error).toBeNull();
    expect(ahora.data).toHaveLength(1);
  });

  it("el tope es por sucursal: la otra sucursal tiene su propio cupo", async () => {
    const local = await nuevoLocal("tt-mesa-tope2", "basic");
    const filas = Array.from({ length: 20 }, (_, i) => ({ organization_id: local.id, branch_id: local.branch, label: `M${i + 1}` }));
    expect((await service.from("tables").insert(filas)).error).toBeNull();

    const enOtra = await owner.db.from("tables").insert({ organization_id: local.id, branch_id: local.branch2, label: "M1" });
    expect(enOtra.error).toBeNull();
  });

  it("Pro permite 50 por sucursal", async () => {
    const local = await nuevoLocal("tt-mesa-pro", "pro");
    const filas = Array.from({ length: 50 }, (_, i) => ({ organization_id: local.id, branch_id: local.branch, label: `M${i + 1}` }));
    expect((await service.from("tables").insert(filas)).error).toBeNull();
    expect((await crear(owner.db, local, "M51")).error?.code).toBe(LIMIT_EXCEEDED);
  });
});

describe("cuenta que no puede escribir", () => {
  it("en solo lectura y suspendida no se crea, renombra, activa ni regenera; en gracia sí", async () => {
    const local = await nuevoLocal("tt-mesa-mora");
    const mesa = await crear(owner.db, local, "Mesa 1");
    const id = mesa.data!.id;
    const original = mesa.data!.qr_token;

    await setSubscription(service, local.id, { finEnMs: -3 * DIA_MS });
    expect((await crear(staff.db, local, "En gracia")).error).toBeNull();
    expect((await owner.db.from("tables").update({ label: "Gracia" }).eq("id", id).select("id")).data).toHaveLength(1);

    for (const dias of [10, 20]) {
      await setSubscription(service, local.id, { finEnMs: -dias * DIA_MS });
      for (const db of [owner.db, staff.db]) {
        expect((await crear(db, local, `Nueva ${dias}`)).error?.code, `crear a ${dias} días`).toBe("42501");
        for (const cambio of [{ label: "Cambiada" }, { is_active: false }, { qr_token: "regenerar" }]) {
          const r = await db.from("tables").update(cambio).eq("id", id).select("id");
          expect(r.data ?? [], `${JSON.stringify(cambio)} a ${dias} días`).toHaveLength(0);
        }
      }
      // Se puede leer.
      expect((await owner.db.from("tables").select("id").eq("id", id)).data).toHaveLength(1);
    }
    expect(await tokenDe(id)).toBe(original);
    expect((await service.from("tables").select("label, is_active").eq("id", id).single()).data).toEqual({ label: "Gracia", is_active: true });
  });
});

describe("resolve_table_qr (entrada pública)", () => {
  const resolver = (db: Db, token: unknown) => db.rpc("resolve_table_qr", { p_token: token as string });

  it("devuelve lo mínimo para un token válido, a anónimos y a autenticados", async () => {
    const local = await nuevoLocal("tt-mesa-resuelve");
    const mesa = await crear(owner.db, local, "Mesa 7");
    const token = mesa.data!.qr_token;

    for (const db of [anonClient(), ajeno.db]) {
      const { data, error } = await resolver(db, token);
      expect(error).toBeNull();
      expect(data).toEqual({
        org_slug: "tt-mesa-resuelve",
        org_name: "tt-mesa-resuelve",
        branch_slug: "uno",
        table_label: "Mesa 7",
        table_active: true,
        status: "available",
        calls_enabled: false, // el local de la prueba es Básico: sin llamado al mozo
        likes_enabled: false, // ni feed de videos (Premium)
      });
    }
  });

  it("una mesa inactiva se resuelve como inactiva", async () => {
    const local = await nuevoLocal("tt-mesa-inactiva");
    const mesa = await crear(owner.db, local, "Mesa 9", { is_active: false });
    const { data } = await resolver(anonClient(), mesa.data!.qr_token);
    expect(data).toMatchObject({ table_label: "Mesa 9", table_active: false, status: "available" });
  });

  it("token inexistente, con formato inválido o raro devuelve null sin error", async () => {
    const anon = anonClient();
    for (const token of [
      "0".repeat(32),
      "",
      "abc",
      "A".repeat(32),
      "c0ffee01000000000000000000000000x",
      "c0ffee0100000000000000000000000",
      "' or '1'='1",
      "c0ffee01000000000000000000000000' --",
      "%".repeat(32),
      "mesa-1",
    ]) {
      const { data, error } = await resolver(anon, token);
      expect(error, token).toBeNull();
      expect(data, token).toBeNull();
    }
    expect((await resolver(anon, null)).data).toBeNull();
  });

  it("los tokens del seed: activa, inactiva, organización inactiva (null) y cuenta suspendida", async () => {
    const anon = anonClient();
    expect((await resolver(anon, "c0ffee01000000000000000000000000")).data).toMatchObject({ org_slug: "cafe-ejemplo", branch_slug: "centro", table_label: "Mesa 1", status: "available" });
    expect((await resolver(anon, "c0ffee03000000000000000000000000")).data).toMatchObject({ table_label: "Mesa 3 (fuera de servicio)", table_active: false });
    expect((await resolver(anon, "bad00001000000000000000000000000")).data).toBeNull(); // organización inactiva
    expect((await resolver(anon, "dead0001000000000000000000000000")).data).toMatchObject({ org_slug: "resto-moroso", status: "suspended" });
  });

  it("solo lectura sigue disponible; el token anterior deja de resolver tras regenerar", async () => {
    const local = await nuevoLocal("tt-mesa-rota-resuelve");
    const mesa = await crear(owner.db, local, "Mesa 1");
    const viejo = mesa.data!.qr_token;
    const anon = anonClient();

    await setSubscription(service, local.id, { finEnMs: -10 * DIA_MS });
    expect((await resolver(anon, viejo)).data).toMatchObject({ status: "available" });

    await setSubscription(service, local.id, { finEnMs: 5 * DIA_MS });
    await owner.db.from("tables").update({ qr_token: "regenerar" }).eq("id", mesa.data!.id);
    const nuevo = await tokenDe(mesa.data!.id);
    expect((await resolver(anon, viejo)).data).toBeNull();
    expect((await resolver(anon, nuevo)).data).toMatchObject({ table_label: "Mesa 1" });

    await setSubscription(service, local.id, { finEnMs: -20 * DIA_MS });
    expect((await resolver(anon, nuevo)).data).toMatchObject({ status: "suspended" });
  });

  it("la respuesta nunca incluye ids ni el token", async () => {
    const { data } = await resolver(anonClient(), "c0ffee01000000000000000000000000");
    expect(Object.keys(data as object).sort()).toEqual(["branch_slug", "calls_enabled", "likes_enabled", "org_name", "org_slug", "status", "table_active", "table_label"]);
    expect(JSON.stringify(data)).not.toContain("c0ffee01");
  });
});

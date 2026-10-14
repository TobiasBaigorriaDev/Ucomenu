import { randomBytes } from "node:crypto";
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
 * Llamado desde la mesa (nivel C; ficha llamado-desde-la-mesa, ADR 0010) en la base: la función pública es la única
 * puerta de escritura, con un pendiente por mesa y tipo, vencimiento derivado, cooldown, límite por cliente,
 * disponibilidad por plan y mora, y sin filtrar información. Contra el Supabase local.
 */

const MIN = 60 * 1000;
/** El límite por cliente cuenta en TODOS los locales: cada prueba usa un identificador propio para no pisarse. */
const nuevoCliente = () => randomBytes(16).toString("hex");
const UNAVAILABLE = { status: "unavailable" };
const NOT_FOUND = { status: "not_found" };

let service: Db;
let owner: TestUser;
let staff: TestUser;
let ajeno: TestUser;
const orgs: string[] = [];

type Local = { id: string; branch: string; table: string; token: string; table2: string; token2: string };

async function nuevoLocal(slug: string, plan: "basic" | "pro" = "pro", members = true): Promise<Local> {
  const id = await createOrg(service, slug, plan);
  orgs.push(id);
  const branch = await service.from("branches").insert({ organization_id: id, slug: "uno", name: "Uno" }).select("id").single();
  if (branch.error) throw new Error(branch.error.message);
  const tables = await service
    .from("tables")
    .insert([
      { organization_id: id, branch_id: branch.data.id, label: "Mesa 1" },
      { organization_id: id, branch_id: branch.data.id, label: "Mesa 2" },
    ])
    .select("id, label, qr_token")
    .order("label");
  if (tables.error) throw new Error(tables.error.message);
  if (members) {
    await addMembership(service, owner, id, "owner");
    await addMembership(service, staff, id, "staff");
  }
  return {
    id,
    branch: branch.data.id,
    table: tables.data[0].id,
    token: tables.data[0].qr_token,
    table2: tables.data[1].id,
    token2: tables.data[1].qr_token,
  };
}

const llamar = async (token: unknown, kind: unknown, client?: unknown, db: Db = anonClient()) => {
  const { data, error } = await db.rpc("create_waiter_call", { p_token: token as string, p_kind: kind as string, ...(client === undefined ? {} : { p_client: client as string }) });
  expect(error).toBeNull();
  return data as Record<string, unknown>;
};

const filas = async (orgId: string) =>
  (await service.from("waiter_calls").select("*").eq("organization_id", orgId).order("created_at")).data ?? [];

/** Hace que los llamados existentes de una mesa parezcan de hace `ms` milisegundos. */
async function envejecer(tableId: string, ms: number) {
  const { error } = await service
    .from("waiter_calls")
    .update({ created_at: new Date(Date.now() - ms).toISOString() })
    .eq("table_id", tableId);
  expect(error).toBeNull();
}

beforeAll(async () => {
  service = serviceClient();
  [owner, staff, ajeno] = await Promise.all([
    createUser(service, "llamado-owner"),
    createUser(service, "llamado-staff"),
    createUser(service, "llamado-ajeno"),
  ]);
});

afterAll(async () => {
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await Promise.all([owner, staff, ajeno].map((u) => deleteUser(service, u)));
});

describe("crear un llamado", () => {
  it("crea un pendiente en la sucursal y organización de la mesa; la respuesta es mínima", async () => {
    const local = await nuevoLocal("tt-llamado-crea");
    const cliente = nuevoCliente();
    const r = await llamar(local.token, "waiter", cliente);
    expect(r).toEqual({ status: "created" });

    const [fila, ...resto] = await filas(local.id);
    expect(resto).toHaveLength(0);
    expect(fila).toMatchObject({
      organization_id: local.id,
      branch_id: local.branch,
      table_id: local.table,
      kind: "waiter",
      status: "pending",
      attended_at: null,
      attended_by: null,
      client_key: cliente,
    });
  });

  it("«Pedir la cuenta» es independiente de «Llamar al mozo» y de otra mesa", async () => {
    const local = await nuevoLocal("tt-llamado-tipos");
    expect(await llamar(local.token, "waiter")).toEqual({ status: "created" });
    expect(await llamar(local.token, "bill")).toEqual({ status: "created" });
    expect(await llamar(local.token2, "waiter")).toEqual({ status: "created" });
    expect((await filas(local.id)).map((f) => `${f.table_id === local.table ? 1 : 2}:${f.kind}`).sort()).toEqual(["1:bill", "1:waiter", "2:waiter"]);
  });

  it("con uno pendiente, repetir el mismo tipo responde already_pending y no inserta", async () => {
    const local = await nuevoLocal("tt-llamado-pendiente");
    await llamar(local.token, "waiter");
    for (let i = 0; i < 3; i++) expect(await llamar(local.token, "waiter")).toEqual({ status: "already_pending" });
    expect(await filas(local.id)).toHaveLength(1);
  });

  it("diez toques simultáneos (de distintos clientes) dejan exactamente un pendiente por tipo", async () => {
    const local = await nuevoLocal("tt-llamado-carrera");
    const clientes = Array.from({ length: 10 }, (_, i) => String(i).repeat(32));
    const resultados = await Promise.all([
      ...clientes.map((c) => llamar(local.token, "waiter", c)),
      ...clientes.map((c) => llamar(local.token, "bill", c)),
    ]);
    const estados = resultados.map((r) => r.status);
    expect(estados.filter((s) => s === "created")).toHaveLength(2);
    expect(estados.filter((s) => s === "already_pending")).toHaveLength(18);
    expect((await filas(local.id)).filter((f) => f.status === "pending")).toHaveLength(2);
  });

  it("la presión alta no rompe la regla: 60 llamados paralelos de la misma mesa y tipo dejan un pendiente y ningún error", async () => {
    const local = await nuevoLocal("tt-llamado-presion");
    const clientes = Array.from({ length: 60 }, () => nuevoCliente());
    const resultados = await Promise.all(clientes.map((c) => llamar(local.token, "bill", c)));
    expect(resultados.filter((r) => r.status === "created")).toHaveLength(1);
    expect(resultados.filter((r) => r.status === "already_pending")).toHaveLength(59);
    expect((await filas(local.id)).filter((f) => f.status === "pending")).toHaveLength(1);
  });

  it("el índice único parcial lo impone la base: un segundo pendiente directo falla", async () => {
    const local = await nuevoLocal("tt-llamado-indice");
    await llamar(local.token, "waiter");
    const otra = await service
      .from("waiter_calls")
      .insert({ organization_id: local.id, branch_id: local.branch, table_id: local.table, kind: "waiter" });
    expect(otra.error?.code).toBe("23505");
    // Uno atendido y otro pendiente conviven.
    await service.from("waiter_calls").update({ status: "attended" }).eq("table_id", local.table);
    expect((await service.from("waiter_calls").insert({ organization_id: local.id, branch_id: local.branch, table_id: local.table, kind: "waiter" })).error).toBeNull();
  });
});

describe("cooldown y vencimiento", () => {
  it("tras atenderse, otro llamado del mismo tipo dentro de 60 s es cooldown; pasado el tiempo se crea", async () => {
    const local = await nuevoLocal("tt-llamado-cooldown");
    await llamar(local.token, "waiter");
    await service.from("waiter_calls").update({ status: "attended" }).eq("table_id", local.table);

    const r = await llamar(local.token, "waiter");
    expect(r.status).toBe("cooldown");
    expect(r.retry_after_seconds).toBeGreaterThanOrEqual(1);
    expect(r.retry_after_seconds).toBeLessThanOrEqual(60);
    expect(Object.keys(r).sort()).toEqual(["retry_after_seconds", "status"]);
    // El otro tipo no se ve afectado.
    expect(await llamar(local.token, "bill")).toEqual({ status: "created" });

    await envejecer(local.table, 59 * 1000);
    expect((await llamar(local.token, "waiter")).status).toBe("cooldown");
    await envejecer(local.table, 61 * 1000);
    expect(await llamar(local.token, "waiter")).toEqual({ status: "created" });
  });

  it("el cooldown es el configurado en la sucursal", async () => {
    const local = await nuevoLocal("tt-llamado-cooldown-cfg");
    expect((await service.from("branches").update({ waiter_call_cooldown_seconds: 10 }).eq("id", local.branch)).error).toBeNull();
    await llamar(local.token, "bill");
    await service.from("waiter_calls").update({ status: "attended" }).eq("table_id", local.table);

    await envejecer(local.table, 9 * 1000);
    expect((await llamar(local.token, "bill")).status).toBe("cooldown");
    await envejecer(local.table, 11 * 1000);
    expect(await llamar(local.token, "bill")).toEqual({ status: "created" });

    // El rango lo impone la base.
    expect((await service.from("branches").update({ waiter_call_cooldown_seconds: 9 }).eq("id", local.branch)).error?.code).toBe("23514");
    expect((await service.from("branches").update({ waiter_call_cooldown_seconds: 3601 }).eq("id", local.branch)).error?.code).toBe("23514");
  });

  it("un pendiente de más de 30 minutos vence solo y no bloquea; uno de 29 minutos sigue pendiente", async () => {
    const local = await nuevoLocal("tt-llamado-vence");
    await llamar(local.token, "waiter");

    await envejecer(local.table, 29 * MIN);
    expect(await llamar(local.token, "waiter")).toEqual({ status: "already_pending" });

    await envejecer(local.table, 31 * MIN);
    expect(await llamar(local.token, "waiter")).toEqual({ status: "created" });

    const estados = (await filas(local.id)).map((f) => f.status).sort();
    expect(estados).toEqual(["expired", "pending"]);
  });
});

describe("disponibilidad: un único «unavailable», sin revelar la causa", () => {
  it("plan Básico, solo lectura, suspendida, mesa inactiva, mesa silenciada: unavailable y sin filas", async () => {
    const local = await nuevoLocal("tt-llamado-indispone");
    const resultados: Record<string, unknown> = {};

    await setSubscription(service, local.id, { plan: "basic" });
    resultados.basico = await llamar(local.token, "waiter");
    await setSubscription(service, local.id, { plan: "pro" });

    await setSubscription(service, local.id, { finEnMs: -10 * DIA_MS });
    resultados.soloLectura = await llamar(local.token, "waiter");
    await setSubscription(service, local.id, { finEnMs: -20 * DIA_MS });
    resultados.suspendida = await llamar(local.token, "waiter");
    await setSubscription(service, local.id, { finEnMs: 5 * DIA_MS });

    await service.from("tables").update({ is_active: false }).eq("id", local.table);
    resultados.inactiva = await llamar(local.token, "waiter");
    await service.from("tables").update({ is_active: true }).eq("id", local.table);

    await service.from("tables").update({ muted_until: new Date(Date.now() + 10 * MIN).toISOString() }).eq("id", local.table);
    resultados.silenciada = await llamar(local.token, "waiter");

    for (const [causa, r] of Object.entries(resultados)) expect(r, causa).toEqual(UNAVAILABLE);
    expect(await filas(local.id)).toHaveLength(0);
  });

  it("en gracia funciona; una mesa con el silencio vencido también", async () => {
    const local = await nuevoLocal("tt-llamado-gracia");
    await setSubscription(service, local.id, { finEnMs: -3 * DIA_MS });
    expect(await llamar(local.token, "waiter")).toEqual({ status: "created" });

    await service.from("tables").update({ muted_until: new Date(Date.now() - MIN).toISOString() }).eq("id", local.table2);
    expect(await llamar(local.token2, "waiter")).toEqual({ status: "created" });
  });

  it("una organización inactiva es «no existe»", async () => {
    const local = await nuevoLocal("tt-llamado-org-inactiva");
    await service.from("organizations").update({ is_active: false }).eq("id", local.id);
    expect(await llamar(local.token, "waiter")).toEqual(NOT_FOUND);
    expect(await filas(local.id)).toHaveLength(0);
  });

  it("resolve_table_qr informa calls_enabled con las mismas condiciones", async () => {
    const local = await nuevoLocal("tt-llamado-resuelve");
    const habilitado = async (token = local.token) => {
      const { data } = await anonClient().rpc("resolve_table_qr", { p_token: token });
      return (data as { calls_enabled: boolean }).calls_enabled;
    };
    expect(await habilitado()).toBe(true);

    await setSubscription(service, local.id, { plan: "basic" });
    expect(await habilitado()).toBe(false);
    await setSubscription(service, local.id, { plan: "pro" });

    await setSubscription(service, local.id, { finEnMs: -10 * DIA_MS });
    expect(await habilitado()).toBe(false);
    await setSubscription(service, local.id, { finEnMs: 5 * DIA_MS });

    await service.from("tables").update({ is_active: false }).eq("id", local.table);
    expect(await habilitado()).toBe(false);
    await service.from("tables").update({ is_active: true, muted_until: new Date(Date.now() + 10 * MIN).toISOString() }).eq("id", local.table);
    expect(await habilitado()).toBe(false);
    await service.from("tables").update({ muted_until: null }).eq("id", local.table);
    expect(await habilitado()).toBe(true);
    expect(await habilitado(local.token2)).toBe(true);
  });
});

describe("token y tipo inválidos: not_found idéntico", () => {
  it("no revela nada y no crea filas", async () => {
    const local = await nuevoLocal("tt-llamado-invalido");
    const respuestas = [
      await llamar("0".repeat(32), "waiter"),
      await llamar("", "waiter"),
      await llamar("abc", "waiter"),
      await llamar(local.token.toUpperCase(), "waiter"),
      await llamar(`${local.token}0`, "waiter"),
      await llamar("' or '1'='1", "waiter"),
      await llamar(`${local.token}' --`, "waiter"),
      await llamar(null, "waiter"),
      await llamar(local.token, "cuenta"),
      await llamar(local.token, ""),
      await llamar(local.token, null),
      await llamar(local.token, "WAITER"),
      await llamar(local.token, "waiter'; drop table waiter_calls; --"),
    ];
    for (const r of respuestas) expect(r).toEqual(NOT_FOUND);
    expect(await filas(local.id)).toHaveLength(0);
  });
});

describe("límite por cliente (30 cada 10 minutos)", () => {
  /** 30 llamados ya atendidos del mismo cliente en otra mesa de la misma organización (no chocan con el índice único). */
  async function sembrarRuido(local: Local, client: string, haceMs: number) {
    const lote = Array.from({ length: 30 }, (_, i) => ({
      organization_id: local.id,
      branch_id: local.branch,
      table_id: local.table2,
      kind: i % 2 === 0 ? "waiter" : "bill",
      status: "attended",
      client_key: client,
      created_at: new Date(Date.now() - haceMs - i * 1000).toISOString(),
    }));
    expect((await service.from("waiter_calls").insert(lote)).error).toBeNull();
  }

  it("el llamado 31 del mismo cliente es rate_limited; otro cliente o ninguno, no", async () => {
    const local = await nuevoLocal("tt-llamado-limite");
    const [a, b] = [nuevoCliente(), nuevoCliente()];
    await sembrarRuido(local, a, 1 * MIN);

    const r = await llamar(local.token, "waiter", a);
    expect(r.status).toBe("rate_limited");
    expect(r.retry_after_seconds).toBeGreaterThanOrEqual(1);
    expect(r.retry_after_seconds).toBeLessThanOrEqual(600);

    expect(await llamar(local.token, "waiter", b)).toEqual({ status: "created" });
    expect(await llamar(local.token, "bill")).toEqual({ status: "created" }); // sin identificador no se cuenta
  });

  it("los llamados de hace más de 10 minutos no cuentan", async () => {
    const local = await nuevoLocal("tt-llamado-limite-vence");
    const cliente = nuevoCliente();
    await sembrarRuido(local, cliente, 11 * MIN);
    expect(await llamar(local.token, "waiter", cliente)).toEqual({ status: "created" });
  });

  it("un identificador con formato inválido no se guarda ni se cuenta", async () => {
    const local = await nuevoLocal("tt-llamado-cliente-malo");
    for (const [i, malo] of ["xyz", "A".repeat(32), "a".repeat(31), "a".repeat(33), "' or 1=1 --", ""].entries()) {
      const mesa = i % 2 === 0 ? local.token : local.token2;
      const tipo = i < 2 ? "waiter" : i < 4 ? "bill" : "waiter";
      await service.from("waiter_calls").delete().eq("organization_id", local.id).then(() => undefined);
      expect(await llamar(mesa, tipo, malo), malo).toEqual({ status: "created" });
      const [fila] = await filas(local.id);
      expect(fila.client_key, malo).toBeNull();
    }
  });
});

describe("acceso directo a waiter_calls", () => {
  it("anon no lee ni escribe; ningún rol de la API inserta, modifica ni borra", async () => {
    const local = await nuevoLocal("tt-llamado-directo");
    await llamar(local.token, "waiter");
    const nuevo = { organization_id: local.id, branch_id: local.branch, table_id: local.table2, kind: "waiter" };

    const anon = anonClient();
    expect((await anon.from("waiter_calls").select("id")).error?.code).toBe("42501");
    expect((await anon.from("waiter_calls").insert(nuevo)).error?.code).toBe("42501");
    expect((await anon.from("waiter_calls").update({ status: "attended" }).eq("organization_id", local.id)).error?.code).toBe("42501");
    expect((await anon.from("waiter_calls").delete().eq("organization_id", local.id)).error?.code).toBe("42501");

    for (const usuario of [owner, staff, ajeno]) {
      expect((await usuario.db.from("waiter_calls").insert(nuevo)).error?.code).toBe("42501");
      expect((await usuario.db.from("waiter_calls").update({ status: "attended" }).eq("organization_id", local.id)).error?.code).toBe("42501");
      expect((await usuario.db.from("waiter_calls").delete().eq("organization_id", local.id)).error?.code).toBe("42501");
    }
    expect((await filas(local.id))[0].status).toBe("pending");
  });

  it("los miembros leen los llamados de su organización y nada de otras", async () => {
    const a = await nuevoLocal("tt-llamado-lee-a");
    const b = await nuevoLocal("tt-llamado-lee-b", "pro", false);
    await addMembership(service, ajeno, b.id, "owner");
    await llamar(a.token, "waiter");
    await llamar(b.token, "bill");

    for (const usuario of [owner, staff]) {
      const { data } = await usuario.db.from("waiter_calls").select("organization_id, kind");
      expect(data?.filter((f) => f.organization_id === a.id)).toEqual([{ organization_id: a.id, kind: "waiter" }]);
      expect(data?.some((f) => f.organization_id === b.id)).toBe(false);
    }
    const { data: deB } = await ajeno.db.from("waiter_calls").select("organization_id, kind").eq("organization_id", b.id);
    expect(deB).toEqual([{ organization_id: b.id, kind: "bill" }]);
    expect((await ajeno.db.from("waiter_calls").select("id").eq("organization_id", a.id)).data).toEqual([]);
  });

  it("el token de un local solo crea llamados en ese local", async () => {
    const a = await nuevoLocal("tt-llamado-aislado-a");
    const b = await nuevoLocal("tt-llamado-aislado-b");
    await llamar(a.token, "waiter", nuevoCliente());
    expect(await filas(b.id)).toHaveLength(0);
    expect((await filas(a.id))[0]).toMatchObject({ organization_id: a.id, branch_id: a.branch });

    // La clave compuesta no deja armar un llamado con la mesa de uno y la organización de otro.
    const cruzado = await service
      .from("waiter_calls")
      .insert({ organization_id: b.id, branch_id: b.branch, table_id: a.table, kind: "bill" });
    expect(cruzado.error?.code).toBe("23503");
  });

  it("la base impone los valores: tipo, estado y formato del identificador", async () => {
    const local = await nuevoLocal("tt-llamado-checks");
    const base = { organization_id: local.id, branch_id: local.branch, table_id: local.table };
    expect((await service.from("waiter_calls").insert({ ...base, kind: "otro" })).error?.code).toBe("23514");
    expect((await service.from("waiter_calls").insert({ ...base, kind: "waiter", status: "otro" })).error?.code).toBe("23514");
    expect((await service.from("waiter_calls").insert({ ...base, kind: "waiter", client_key: "192.168.0.1" })).error?.code).toBe("23514");
  });

  it("borrar la mesa o la organización borra sus llamados", async () => {
    const local = await nuevoLocal("tt-llamado-cascada");
    await llamar(local.token, "waiter");
    await llamar(local.token2, "bill");
    expect((await service.from("tables").delete().eq("id", local.table)).error).toBeNull();
    expect((await filas(local.id)).map((f) => f.table_id)).toEqual([local.table2]);
    await service.from("organizations").delete().eq("id", local.id);
    expect(await filas(local.id)).toHaveLength(0);
  });
});

import { spawn } from "node:child_process";
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
  type Db,
  type TestUser,
  sql,
} from "./helpers";
import { asegurarDestinoLocal } from "./purge-price-history";

/**
 * Purga de `waiter_calls` por antigüedad (nivel C; ficha purga-de-waiter-calls, ADR 0014) contra el Supabase local:
 * solo service_role la ejecuta, tiene un piso de retención, borra solo lo viejo, por lotes y sin molestar a los
 * llamados en curso.
 *
 * La purga es global (no mira organizaciones): las filas de estas pruebas llevan fechas muy anteriores a cualquier otra
 * (año 2000) cuando hace falta que sean las primeras en salir, y las comprobaciones se hacen sobre filas propias.
 */

let service: Db;
let owner: TestUser;
let staff: TestUser;
const orgs: string[] = [];

type Local = { id: string; branch: string; table: string; token: string; table2: string };

async function nuevoLocal(slug: string): Promise<Local> {
  const id = await createOrg(service, slug, "pro");
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
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  return { id, branch: branch.data.id, table: tables.data[0].id, token: tables.data[0].qr_token, table2: tables.data[1].id };
}

/** Inserta un llamado (como service_role, que es quien prepara datos) con la antigüedad y el estado pedidos. */
async function sembrar(
  local: Local,
  hace: number,
  opciones: { kind?: "waiter" | "bill"; status?: "pending" | "attended" | "expired"; table?: string; fecha?: Date } = {},
) {
  const { kind = "waiter", status = "attended", table = local.table, fecha } = opciones;
  const { data, error } = await service
    .from("waiter_calls")
    .insert({
      organization_id: local.id,
      branch_id: local.branch,
      table_id: table,
      kind,
      status,
      created_at: (fecha ?? new Date(Date.now() - hace)).toISOString(),
      ...(status === "attended" ? { attended_at: new Date().toISOString() } : {}),
    })
    .select("id")
    .single();
  if (error) throw new Error(`No se pudo sembrar el llamado: ${error.message}`);
  return data.id;
}

const idsDe = async (orgId: string) =>
  ((await service.from("waiter_calls").select("id").eq("organization_id", orgId)).data ?? []).map((f) => f.id);

const purgar = (args?: { p_retention?: string; p_batch?: number }, db: Db = service) =>
  db.rpc("purge_waiter_calls", args as never);

beforeAll(async () => {
  service = serviceClient();
  [owner, staff] = await Promise.all([createUser(service, "purga-owner"), createUser(service, "purga-staff")]);
});

afterAll(async () => {
  await Promise.all(orgs.map((id) => deleteOrg(service, id)));
  await Promise.all([owner, staff].map((u) => deleteUser(service, u)));
});

describe("quién puede purgar", () => {
  it("anon, Dueño y Staff no pueden ejecutarla por la API y no se borra nada", async () => {
    const local = await nuevoLocal("tt-purga-permisos");
    const vieja = await sembrar(local, 60 * DIA_MS);
    for (const db of [anonClient(), owner.db, staff.db]) {
      const { error } = await purgar(undefined, db);
      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
    }
    expect(await idsDe(local.id)).toEqual([vieja]);
  });

  it("anon, Dueño y Staff siguen sin poder borrar waiter_calls directamente", async () => {
    const local = await nuevoLocal("tt-purga-directo");
    const vieja = await sembrar(local, 60 * DIA_MS);
    for (const db of [anonClient(), owner.db, staff.db]) {
      await db.from("waiter_calls").delete().eq("id", vieja);
    }
    expect(await idsDe(local.id)).toEqual([vieja]);
  });
});

describe("qué borra", () => {
  it("borra lo anterior a 14 días (de cualquier estado) y conserva lo posterior; los bordes de 13 y 15 días", async () => {
    const local = await nuevoLocal("tt-purga-bordes");
    const viejoAtendido = await sembrar(local, 15 * DIA_MS, { status: "attended" });
    const viejoVencido = await sembrar(local, 45 * DIA_MS, { status: "expired", kind: "bill" });
    // Un pendiente de semanas ya está vencido por derivación: no es un aviso vivo, se purga igual.
    const viejoPendiente = await sembrar(local, 90 * DIA_MS, { status: "pending", table: local.table2 });
    const casiViejo = await sembrar(local, 13 * DIA_MS, { status: "attended", kind: "bill" });
    // De otro tipo que el pendiente viejo: el índice único parcial admite un solo pendiente por (mesa, tipo).
    const reciente = await sembrar(local, 60 * 1000, { status: "pending", kind: "bill", table: local.table2 });
    expect(await idsDe(local.id)).toHaveLength(5);

    const { data, error } = await purgar();
    expect(error).toBeNull();
    expect(data).toBeGreaterThanOrEqual(3);

    const quedan = await idsDe(local.id);
    expect(quedan.sort()).toEqual([casiViejo, reciente].sort());
    expect(quedan).not.toContain(viejoAtendido);
    expect(quedan).not.toContain(viejoVencido);
    expect(quedan).not.toContain(viejoPendiente);
  });

  it("es idempotente: una segunda corrida inmediata no borra nada de lo propio", async () => {
    const local = await nuevoLocal("tt-purga-idempotente");
    await sembrar(local, 40 * DIA_MS);
    const keep = await sembrar(local, 2 * DIA_MS, { kind: "bill" });
    await purgar();
    const despues = await idsDe(local.id);
    expect(despues).toEqual([keep]);
    const otra = await purgar();
    expect(otra.error).toBeNull();
    expect(await idsDe(local.id)).toEqual([keep]);
  });

  it("una retención mayor se respeta (60 días conserva lo de 45)", async () => {
    const local = await nuevoLocal("tt-purga-retencion-larga");
    const de45 = await sembrar(local, 45 * DIA_MS);
    const de70 = await sembrar(local, 70 * DIA_MS, { kind: "bill" });
    const { error } = await purgar({ p_retention: "60 days" });
    expect(error).toBeNull();
    expect(await idsDe(local.id)).toEqual([de45]);
    expect(de70).not.toBe(de45);
  });

  it("borra de todas las organizaciones, pero solo lo viejo de cada una", async () => {
    const a = await nuevoLocal("tt-purga-org-a");
    const b = await nuevoLocal("tt-purga-org-b");
    await sembrar(a, 50 * DIA_MS);
    await sembrar(b, 50 * DIA_MS);
    const recienteB = await sembrar(b, 3 * DIA_MS, { kind: "bill" });
    await purgar();
    expect(await idsDe(a.id)).toEqual([]);
    expect(await idsDe(b.id)).toEqual([recienteB]);
  });
});

describe("piso y validación", () => {
  it.each([
    ["6 days 23 hours", "menos de 7 días"],
    ["1 day", "un día"],
    ["0 seconds", "cero"],
    ["-30 days", "negativa"],
  ])("rechaza la retención %s (%s) con 22023 y no borra nada", async (retencion) => {
    const local = await nuevoLocal(`tt-purga-piso-${randomBytes(3).toString("hex")}`);
    const vieja = await sembrar(local, 60 * DIA_MS);
    const { error } = await purgar({ p_retention: retencion });
    expect(error?.code).toBe("22023");
    expect(error?.message).toContain("invalid_retention");
    expect(await idsDe(local.id)).toEqual([vieja]);
  });

  // PostgreSQL compara un mes como 30 días pero lo aplica por calendario: el piso se valida sobre la fecha de corte efectiva.
  it.each([
    ["1 month -26 days", "de 2 a 5 días según el mes (el caso `1 month -23 days` da 5 en febrero, pero 7 en otros meses)"],
    ["2 months -58 days", "de 1 a 4 días según los meses"],
    ["-4800 months 144007 days", "corte en el futuro"],
    ["-1 month", "corte en el futuro"],
    ["-infinity", "corte en el futuro"],
    ["1 day 12 hours", "un día y medio"],
  ])("rechaza la retención mixta %s (%s) con 22023 y no borra nada", async (retencion) => {
    const local = await nuevoLocal(`tt-purga-mixta-${randomBytes(3).toString("hex")}`);
    const reciente = await sembrar(local, 60 * 1000, { status: "pending", kind: "bill" });
    const deCuatroDias = await sembrar(local, 4 * DIA_MS);
    const { error } = await purgar({ p_retention: retencion });
    expect(error?.code).toBe("22023");
    expect(error?.message).toContain("invalid_retention");
    expect((await idsDe(local.id)).sort()).toEqual([reciente, deCuatroDias].sort());
  });

  it("un intervalo que desborda las fechas se rechaza con 22023, no con un error interno", async () => {
    const { error } = await purgar({ p_retention: "2000000000 days" });
    expect(error?.code).toBe("22023");
    expect(error?.message).toContain("invalid_retention");
  });

  it("una retención en meses o años válida (cutoff anterior a 7 días) se acepta y respeta el calendario", async () => {
    const local = await nuevoLocal("tt-purga-meses");
    const deCuatroMeses = await sembrar(local, 120 * DIA_MS);
    const deTresDias = await sembrar(local, 3 * DIA_MS, { kind: "bill" });
    const { error } = await purgar({ p_retention: "2 months" });
    expect(error).toBeNull();
    expect(await idsDe(local.id)).toEqual([deTresDias]);
    expect(deCuatroMeses).not.toBe(deTresDias);
  });

  it("acepta exactamente 7 días como piso", async () => {
    const local = await nuevoLocal("tt-purga-piso-justo");
    const deSiete = await sembrar(local, 7 * DIA_MS + 60 * 1000);
    const deSeisYMedio = await sembrar(local, 6.5 * DIA_MS, { kind: "bill" });
    const { error } = await purgar({ p_retention: "7 days" });
    expect(error).toBeNull();
    expect(await idsDe(local.id)).toEqual([deSeisYMedio]);
    expect(deSiete).not.toBe(deSeisYMedio);
  });

  it("una retención nula se rechaza", async () => {
    const { error } = await purgar({ p_retention: null as unknown as string });
    expect(error?.code).toBe("22023");
  });

  it.each([0, -1, 50001, null])("un lote de %s se rechaza con 22023", async (lote) => {
    const { error } = await purgar({ p_batch: lote as number });
    expect(error?.code).toBe("22023");
    expect(error?.message).toContain("invalid_batch");
  });
});

describe("por lotes", () => {
  it("borra como mucho p_batch por llamada, las más viejas primero, y devuelve cuántas", async () => {
    const local = await nuevoLocal("tt-purga-lotes");
    // Año 2000: son las primeras en salir aunque haya otras filas viejas en la base.
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const kind = i % 2 === 0 ? "waiter" : "bill";
      const table = i < 2 ? local.table : local.table2;
      // Estados no pendientes: el índice único parcial solo limita los pendientes.
      ids.push(await sembrar(local, 0, { kind, table, fecha: new Date(Date.UTC(2000, 0, 1, 0, i)) }));
    }
    const primera = await purgar({ p_batch: 2 });
    expect(primera.error).toBeNull();
    expect(primera.data).toBe(2);
    expect((await idsDe(local.id)).sort()).toEqual(ids.slice(2).sort());

    const segunda = await purgar({ p_batch: 2 });
    expect(segunda.data).toBe(2);
    expect((await idsDe(local.id)).sort()).toEqual(ids.slice(4).sort());

    const tercera = await purgar({ p_batch: 2 });
    expect(tercera.data).toBeGreaterThanOrEqual(1);
    expect(await idsDe(local.id)).toEqual([]);
  });
});

describe("convive con los llamados en curso", () => {
  it("tras purgar, el cooldown y el límite por cliente siguen funcionando con lo reciente", async () => {
    const local = await nuevoLocal("tt-purga-convive");
    await sembrar(local, 80 * DIA_MS);
    const cliente = randomBytes(16).toString("hex");
    const db = serviceClient();
    const llamar = async () =>
      (await db.rpc("create_waiter_call", { p_token: local.token, p_kind: "waiter", p_client: cliente })).data;
    expect(await llamar()).toEqual({ status: "created" });
    await purgar();
    expect(await llamar()).toEqual({ status: "already_pending" });
    const pendientes = (await service.from("waiter_calls").select("id").eq("organization_id", local.id).eq("status", "pending")).data;
    expect(pendientes).toHaveLength(1);
  });

  it("purgar mientras entran llamados no da errores ni interbloqueos, y no toca lo recién creado", async () => {
    const local = await nuevoLocal("tt-purga-concurrente");
    for (let i = 0; i < 20; i++) await sembrar(local, 0, { fecha: new Date(Date.UTC(2000, 1, 1, 0, i)), kind: i % 2 ? "bill" : "waiter" });

    const db = serviceClient();
    const llamadas = Array.from({ length: 12 }, () => db.rpc("create_waiter_call", { p_token: local.token, p_kind: "bill" }));
    const purgas = Array.from({ length: 4 }, () => purgar({ p_batch: 50 }));
    const resultados = await Promise.all([...llamadas, ...purgas]);
    for (const r of resultados) expect(r.error).toBeNull();

    const pendientes = (await service.from("waiter_calls").select("id").eq("organization_id", local.id).eq("status", "pending")).data;
    expect(pendientes).toHaveLength(1);
    const viejas = (await service.from("waiter_calls").select("id").eq("organization_id", local.id).lt("created_at", "2001-01-01")).data;
    expect(viejas).toEqual([]);
  });

  it("una fila bloqueada por otra transacción se salta sin esperar y se purga cuando se libera", async () => {
    const contenedor = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_ucomenu";
    asegurarDestinoLocal(contenedor);
    const local = await nuevoLocal("tt-purga-bloqueo");
    // Año 2000: son las primeras en salir. La bloqueada es la más vieja; la libre, la siguiente.
    const bloqueada = await sembrar(local, 0, { fecha: new Date(Date.UTC(2000, 3, 1, 0, 0)) });
    const libre = await sembrar(local, 0, { fecha: new Date(Date.UTC(2000, 3, 1, 0, 1)), kind: "bill" });

    // Otra transacción retiene el bloqueo de la fila unos segundos (como lo haría un «atender» lento).
    const SEGUNDOS = 8;
    const titular = spawn(
      "docker",
      [
        "exec", contenedor, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-c",
        `begin; select id from public.waiter_calls where id = '${bloqueada}' for update; select pg_sleep(${SEGUNDOS}); commit;`,
      ],
      { stdio: "ignore" },
    );
    const termino = new Promise<void>((resolve) => titular.once("close", () => resolve()));
    try {
      // Espera a que el bloqueo esté tomado: un intento NOWAIT falla mientras la fila esté retenida.
      let retenida = false;
      for (let i = 0; i < 50 && !retenida; i++) {
        try {
          sql(`select 1 from public.waiter_calls where id = '${bloqueada}' for update nowait`);
          await new Promise((r) => setTimeout(r, 100));
        } catch (error) {
          if (!String(error).includes("could not obtain lock")) throw error;
          retenida = true;
        }
      }
      expect(retenida, "el titular no llegó a bloquear la fila").toBe(true);

      const t0 = Date.now();
      const durante = await purgar({ p_batch: 10 });
      const tardo = Date.now() - t0;
      expect(durante.error).toBeNull();
      expect(tardo, "la purga esperó al bloqueo en vez de saltar la fila").toBeLessThan(4000);
      // Se llevó la libre y dejó la bloqueada.
      expect(await idsDe(local.id)).toEqual([bloqueada]);
      expect(libre).not.toBe(bloqueada);
    } finally {
      await termino; // libera el bloqueo (commit) antes de seguir
    }
    // Liberada, la siguiente purga ya la borra.
    const despues = await purgar({ p_batch: 10 });
    expect(despues.error).toBeNull();
    expect(await idsDe(local.id)).toEqual([]);
  }, 30_000);

  it("la fila que otra transacción tiene bloqueada se salta, no se espera", async () => {
    // Un UPDATE de «atender» tiene la fila bloqueada un instante: la purga la ignora y sigue (skip locked).
    // Se comprueba por comportamiento: con una purga y un atender simultáneos de una fila vieja, ninguno falla.
    const local = await nuevoLocal("tt-purga-skip-locked");
    const vieja = await sembrar(local, 0, { status: "pending", fecha: new Date(Date.UTC(2000, 2, 1)) });
    const [atender, purga] = await Promise.all([
      service.from("waiter_calls").update({ status: "attended" }).eq("id", vieja),
      purgar({ p_batch: 10 }),
    ]);
    expect(atender.error).toBeNull();
    expect(purga.error).toBeNull();
    // Si la purga ganó, la fila no existe; si el UPDATE ganó, quedó atendida y la próxima purga se la lleva.
    await purgar({ p_batch: 10 });
    expect(await idsDe(local.id)).toEqual([]);
  });
});

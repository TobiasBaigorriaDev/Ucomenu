import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMembership,
  anonClient,
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
 * Resumen de la analítica con IA (nivel C; ficha resumen-de-analitica-con-ia, ADR 0047) contra el Supabase local: solo el Dueño
 * de un local con el plan lee su resumen y reserva el período; SOLO el servidor (servicio técnico) lo guarda, así el Dueño no puede
 * escribir por la API un texto que no pasó la validación; la reserva es atómica (dos pedidos simultáneos no pasan los dos); la tabla
 * no admite escrituras directas; la fila es una por período y alcance y desaparece con la sucursal.
 */

const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

let service: Db;
let ajeno: TestUser; // Dueño de otro local
let comun: TestUser; // sin rol
const users: TestUser[] = [];
const orgs: string[] = [];
let contador = 0;

type Local = { id: string; owner: TestUser; staff: TestUser; uno: string; dos: string };

async function crearLocal(plan: PlanCode = "pro"): Promise<Local> {
  contador += 1;
  const id = await createOrg(service, `tt-resia-${sufijo}-${contador}`, plan);
  orgs.push(id);
  await setSubscription(service, id, { finEnMs: 30 * DIA_MS });
  const [owner, staff] = await Promise.all([createUser(service, `resia-d${contador}`), createUser(service, `resia-s${contador}`)]);
  users.push(owner, staff);
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  const b1 = await service.from("branches").insert({ organization_id: id, slug: "uno", name: "Uno" }).select("id").single();
  const b2 = plan === "basic" ? b1 : await service.from("branches").insert({ organization_id: id, slug: "dos", name: "Dos" }).select("id").single();
  if (b1.error || b2.error) throw new Error(`sucursales: ${b1.error?.message ?? b2.error?.message}`);
  return { id, owner, staff, uno: b1.data!.id, dos: b2.data!.id };
}

const CONTENIDO = {
  summary: "Vendiste más que antes.",
  highlights: [{ title: "El viernes manda", detail: "Fue el día fuerte." }],
  actions: [{ action: "Revisá el flan", reason: "Se mira y no se pide." }],
};

/** Guarda como lo hace el servidor: con el servicio técnico y diciendo quién pidió. */
const guardar = (org: string, user: string | null, dias: number, contenido: unknown = CONTENIDO, branch?: string, provider = "gemini") =>
  service.rpc("save_analytics_summary", {
    p_org: org,
    p_user: user as string,
    p_days: dias,
    p_content: contenido as never,
    p_provider: provider,
    ...(branch ? { p_branch: branch } : {}),
  });

const leer = (db: Db, org: string) => db.from("analytics_summaries").select("days, branch_id, content, provider, generated_by").eq("organization_id", org).order("days");

type Reserva = { claimed: boolean; claim?: string; wait_seconds?: number };
const reservar = (db: Db, org: string, dias = 30, branch?: string, minutos = 10) =>
  db.rpc("claim_analytics_summary", { p_org: org, p_days: dias, p_cooldown_minutes: minutos, ...(branch ? { p_branch: branch } : {}) });
const reservaDe = async (db: Db, org: string, dias = 30, branch?: string, minutos = 10) => {
  const r = await reservar(db, org, dias, branch, minutos);
  if (r.error) throw new Error(`reservar: ${r.error.message}`);
  return r.data as unknown as Reserva;
};
const devolver = (db: Db, org: string, dias: number, claim: string, branch?: string) =>
  db.rpc("release_analytics_summary_claim", { p_org: org, p_days: dias, p_claim: claim, ...(branch ? { p_branch: branch } : {}) });

const filas = (org: string) => Number(sql(`select count(*) from public.analytics_summaries where organization_id = '${org}'`)[0][0]);

beforeAll(async () => {
  service = serviceClient();
  [ajeno, comun] = await Promise.all([createUser(service, "resia-ajeno"), createUser(service, "resia-comun")]);
  users.push(ajeno, comun);
});

afterAll(async () => {
  for (const id of orgs) await deleteOrg(service, id);
  for (const u of users) await deleteUser(service, u);
});

describe("guardar y leer", () => {
  it("el servidor guarda el resumen pedido por el Dueño y el Dueño lo lee; la fila anota quién y con qué servicio", async () => {
    const local = await crearLocal();
    const guardado = await guardar(local.id, local.owner.id, 30);
    expect(guardado.error).toBeNull();
    expect(typeof guardado.data).toBe("string");

    const r = await leer(local.owner.db, local.id);
    expect(r.error).toBeNull();
    expect(r.data).toEqual([{ days: 30, branch_id: null, content: CONTENIDO, provider: "gemini", generated_by: local.owner.id }]);
  });

  it("una fila por período y alcance: regenerar la reemplaza; otro período u otra sucursal es otra fila", async () => {
    const local = await crearLocal();
    await guardar(local.id, local.owner.id, 30);
    await guardar(local.id, local.owner.id, 30, { ...CONTENIDO, summary: "Segunda versión." });
    expect(filas(local.id)).toBe(1);
    expect((await leer(local.owner.db, local.id)).data?.[0].content).toMatchObject({ summary: "Segunda versión." });

    await guardar(local.id, local.owner.id, 7);
    await guardar(local.id, local.owner.id, 30, CONTENIDO, local.uno);
    await guardar(local.id, local.owner.id, 30, CONTENIDO, local.dos);
    await guardar(local.id, local.owner.id, 30, { ...CONTENIDO, summary: "Sucursal uno, versión 2." }, local.uno);
    expect(filas(local.id)).toBe(4);
    const porSucursal = (await leer(local.owner.db, local.id)).data!.filter((fila) => fila.branch_id === local.uno);
    expect(porSucursal).toHaveLength(1);
    expect(porSucursal[0].content).toMatchObject({ summary: "Sucursal uno, versión 2." });
  });

  it("las filas desaparecen con la sucursal", async () => {
    const local = await crearLocal();
    await guardar(local.id, local.owner.id, 30, CONTENIDO, local.dos);
    await guardar(local.id, local.owner.id, 30);
    await reservaDe(local.owner.db, local.id, 30, local.dos);
    sql(`delete from public.branches where id = '${local.dos}'`);
    expect((await leer(local.owner.db, local.id)).data?.map((fila) => fila.branch_id)).toEqual([null]);
    expect(Number(sql(`select count(*) from public.analytics_summary_claims where organization_id = '${local.id}'`)[0][0])).toBe(0);
  });
});

describe("quién puede guardar", () => {
  it("el Dueño NO puede escribir por la API un texto que no pasó la validación del servidor; tampoco anon ni nadie", async () => {
    const local = await crearLocal();
    const falso = { summary: "Vendiste $ 9.999.999. Mirá https://ejemplo.com", highlights: [], actions: [] };
    for (const [nombre, db] of [
      ["Dueño", local.owner.db],
      ["Staff", local.staff.db],
      ["sin rol", comun.db],
      ["anon", anonClient()],
    ] as const) {
      const g = await db.rpc("save_analytics_summary", { p_org: local.id, p_user: local.owner.id, p_days: 30, p_content: falso as never, p_provider: "gemini" });
      expect([nombre, g.error?.code], nombre).toEqual([nombre, "42501"]);
    }
    expect(filas(local.id)).toBe(0);
  });

  it("el servidor tampoco guarda a nombre de Staff, de un Dueño de otro local, de alguien sin rol, sin usuario ni con plan Básico", async () => {
    const local = await crearLocal();
    for (const [nombre, user] of [
      ["Staff", local.staff.id],
      ["Dueño de otro local", ajeno.id],
      ["sin rol", comun.id],
      ["sin usuario", null],
    ] as const) {
      const g = await guardar(local.id, user, 30);
      expect([nombre, g.error?.code], nombre).toEqual([nombre, "42501"]);
    }
    expect(filas(local.id)).toBe(0);

    const basico = await crearLocal("basic");
    expect((await guardar(basico.id, basico.owner.id, 30)).error?.code).toBe("42501");
    expect(filas(basico.id)).toBe(0);
  });

  it("en «solo lectura» guarda y lee (como la analítica); suspendida no", async () => {
    const local = await crearLocal();
    await setSubscription(service, local.id, { finEnMs: -10 * DIA_MS });
    expect((await guardar(local.id, local.owner.id, 30)).error).toBeNull();
    expect((await leer(local.owner.db, local.id)).data).toHaveLength(1);

    await setSubscription(service, local.id, { finEnMs: -30 * DIA_MS });
    expect((await guardar(local.id, local.owner.id, 7)).error?.code).toBe("42501");
    expect((await leer(local.owner.db, local.id)).data).toEqual([]);
  });

  it("quien deja de ser Dueño deja de leer y de guardar al instante", async () => {
    const local = await crearLocal();
    await guardar(local.id, local.owner.id, 30);
    await addMembership(service, ajeno, local.id, "owner"); // la base exige al menos un Dueño
    sql(`update public.memberships set role = 'staff' where user_id = '${local.owner.id}' and organization_id = '${local.id}'`);
    expect((await leer(local.owner.db, local.id)).data).toEqual([]);
    expect((await guardar(local.id, local.owner.id, 7)).error?.code).toBe("42501");
    expect((await leer(ajeno.db, local.id)).data).toHaveLength(1);
  });
});

describe("quién puede leer", () => {
  it("Staff, Dueño de otro local, sin rol y plan Básico no leen nada; anon se rechaza", async () => {
    const local = await crearLocal();
    await guardar(local.id, local.owner.id, 30);
    const otro = await crearLocal();
    for (const [nombre, db] of [
      ["Staff", local.staff.db],
      ["Dueño de otro local", otro.owner.db],
      ["sin rol", comun.db],
      ["Dueño ajeno sin membresía", ajeno.db],
    ] as const) {
      const r = await leer(db, local.id);
      expect([nombre, r.error, r.data], nombre).toEqual([nombre, null, []]);
    }
    expect((await leer(anonClient(), local.id)).error).not.toBeNull();

    const basico = await crearLocal("basic");
    sql(`insert into public.analytics_summaries (organization_id, days, content, provider) values ('${basico.id}', 30, '{}'::jsonb, 'gemini')`);
    expect((await leer(basico.owner.db, basico.id)).data).toEqual([]);
  });

  it("un local no ve los resúmenes de otro", async () => {
    const a = await crearLocal();
    const b = await crearLocal();
    await guardar(a.id, a.owner.id, 30);
    await guardar(b.id, b.owner.id, 30, { ...CONTENIDO, summary: "De B." });
    expect((await leer(a.owner.db, a.id)).data?.map((fila) => fila.content)).toEqual([CONTENIDO]);
    expect((await leer(a.owner.db, b.id)).data).toEqual([]);
  });
});

describe("las tablas no admiten escrituras directas", () => {
  it("ni el Dueño ni el servicio técnico insertan, modifican ni borran por la API; las reservas no se ven ni se tocan", async () => {
    const local = await crearLocal();
    await guardar(local.id, local.owner.id, 30);
    await reservaDe(local.owner.db, local.id);
    for (const [nombre, db] of [
      ["Dueño", local.owner.db],
      ["servicio técnico", service],
    ] as const) {
      const ins = await db.from("analytics_summaries").insert({ organization_id: local.id, days: 7, content: CONTENIDO, provider: "x" });
      expect([nombre, ins.error?.code], nombre).toEqual([nombre, "42501"]);
      const upd = await db.from("analytics_summaries").update({ provider: "otro" }).eq("organization_id", local.id).select("id");
      expect([nombre, upd.error?.code ?? upd.data?.length], nombre).toSatisfy(([, v]) => v === "42501" || v === 0);
      const del = await db.from("analytics_summaries").delete().eq("organization_id", local.id).select("id");
      expect([nombre, del.error?.code ?? del.data?.length], nombre).toSatisfy(([, v]) => v === "42501" || v === 0);

      for (const accion of [
        db.from("analytics_summary_claims").select("claimed_at"),
        db.from("analytics_summary_claims").insert({ organization_id: local.id, days: 7, claimed_at: new Date().toISOString() }),
        db.from("analytics_summary_claims").update({ claimed_at: "-infinity" }).eq("organization_id", local.id).select("days"),
        db.from("analytics_summary_claims").delete().eq("organization_id", local.id).select("days"),
      ]) {
        const r = await accion;
        expect([nombre, r.error?.code], nombre).toEqual([nombre, "42501"]);
      }
    }
    expect(filas(local.id)).toBe(1);
    expect(sql(`select provider from public.analytics_summaries where organization_id = '${local.id}'`)[0][0]).toBe("gemini");
    expect(Number(sql(`select count(*) from public.analytics_summary_claims where organization_id = '${local.id}'`)[0][0])).toBe(1);
  });
});

describe("reserva del período (antes de llamar al servicio externo)", () => {
  it("la primera reserva pasa y la segunda espera; devuelve cuántos segundos faltan", async () => {
    const local = await crearLocal();
    const primera = await reservaDe(local.owner.db, local.id);
    expect(primera.claimed).toBe(true);
    expect(typeof primera.claim).toBe("string");

    const segunda = await reservaDe(local.owner.db, local.id);
    expect(segunda.claimed).toBe(false);
    expect(segunda.wait_seconds).toBeGreaterThan(590);
    expect(segunda.wait_seconds).toBeLessThanOrEqual(600);
  });

  it("pedidos SIMULTÁNEOS del mismo período y alcance: pasa uno solo", async () => {
    const local = await crearLocal();
    const resultados = await Promise.all(Array.from({ length: 10 }, () => reservaDe(local.owner.db, local.id)));
    expect(resultados.filter((r) => r.claimed)).toHaveLength(1);
    expect(Number(sql(`select count(*) from public.analytics_summary_claims where organization_id = '${local.id}'`)[0][0])).toBe(1);
  });

  it("cada período y cada alcance tienen su propia reserva", async () => {
    const local = await crearLocal();
    const reservas = [
      await reservaDe(local.owner.db, local.id, 30),
      await reservaDe(local.owner.db, local.id, 7),
      await reservaDe(local.owner.db, local.id, 90),
      await reservaDe(local.owner.db, local.id, 30, local.uno),
      await reservaDe(local.owner.db, local.id, 30, local.dos),
    ];
    expect(reservas.map((r) => r.claimed)).toEqual([true, true, true, true, true]);
    expect((await reservaDe(local.owner.db, local.id, 30, local.uno)).claimed).toBe(false);
  });

  it("pasado el tiempo mínimo se puede reservar de nuevo; devolver la reserva la libera, pero solo si sigue siendo la misma", async () => {
    const local = await crearLocal();
    const primera = await reservaDe(local.owner.db, local.id);
    sql(`update public.analytics_summary_claims set claimed_at = now() - interval '11 minutes' where organization_id = '${local.id}'`);
    const segunda = await reservaDe(local.owner.db, local.id);
    expect(segunda.claimed).toBe(true);

    // Devolver la reserva VIEJA no libera la nueva.
    expect((await devolver(local.owner.db, local.id, 30, primera.claim!)).error).toBeNull();
    expect((await reservaDe(local.owner.db, local.id)).claimed).toBe(false);
    // Devolver la vigente sí.
    expect((await devolver(local.owner.db, local.id, 30, segunda.claim!)).error).toBeNull();
    expect((await reservaDe(local.owner.db, local.id)).claimed).toBe(true);
  });

  it("la reserva respeta el tiempo mínimo que pide quien llama", async () => {
    const local = await crearLocal();
    await reservaDe(local.owner.db, local.id, 30, undefined, 5);
    sql(`update public.analytics_summary_claims set claimed_at = now() - interval '6 minutes' where organization_id = '${local.id}'`);
    expect((await reservaDe(local.owner.db, local.id, 30, undefined, 10)).claimed).toBe(false);
    expect((await reservaDe(local.owner.db, local.id, 30, undefined, 5)).claimed).toBe(true);
  });

  it("solo el Dueño con el plan reserva y devuelve: Staff, Dueño de otro local, sin rol y plan Básico no; anon se rechaza", async () => {
    const local = await crearLocal();
    const reserva = await reservaDe(local.owner.db, local.id);
    for (const [nombre, db] of [
      ["Staff", local.staff.db],
      ["Dueño de otro local", ajeno.db],
      ["sin rol", comun.db],
    ] as const) {
      expect([nombre, (await reservar(db, local.id)).error?.code], nombre).toEqual([nombre, "42501"]);
      expect([nombre, (await devolver(db, local.id, 30, reserva.claim!)).error?.code], nombre).toEqual([nombre, "42501"]);
    }
    expect((await reservar(anonClient(), local.id)).error).not.toBeNull();
    expect((await devolver(anonClient(), local.id, 30, reserva.claim!)).error).not.toBeNull();
    // Nadie ajeno liberó la reserva.
    expect((await reservaDe(local.owner.db, local.id)).claimed).toBe(false);

    const basico = await crearLocal("basic");
    expect((await reservar(basico.owner.db, basico.id)).error?.code).toBe("42501");
  });

  it("en «solo lectura» reserva (como la analítica); suspendida no", async () => {
    const local = await crearLocal();
    await setSubscription(service, local.id, { finEnMs: -10 * DIA_MS });
    expect((await reservaDe(local.owner.db, local.id)).claimed).toBe(true);
    await setSubscription(service, local.id, { finEnMs: -30 * DIA_MS });
    expect((await reservar(local.owner.db, local.id, 7)).error?.code).toBe("42501");
  });

  it("parámetros inválidos y sucursal ajena se rechazan sin reservar nada", async () => {
    const local = await crearLocal();
    const otro = await crearLocal();
    expect((await reservar(local.owner.db, local.id, 14)).error?.code).toBe("22023");
    expect((await reservar(local.owner.db, local.id, 30, undefined, 0)).error?.code).toBe("22023");
    expect((await reservar(local.owner.db, local.id, 30, undefined, 61)).error?.code).toBe("22023");
    expect((await reservar(local.owner.db, local.id, 30, otro.uno)).error?.code).toBe("22023");
    expect(Number(sql(`select count(*) from public.analytics_summary_claims where organization_id = '${local.id}'`)[0][0])).toBe(0);
  });
});

describe("validaciones al guardar", () => {
  it("período, sucursal y contenido inválidos se rechazan sin guardar nada", async () => {
    const local = await crearLocal();
    const otro = await crearLocal();

    expect((await guardar(local.id, local.owner.id, 14)).error?.code).toBe("22023");
    expect((await guardar(local.id, local.owner.id, 30, CONTENIDO, otro.uno)).error?.code).toBe("22023"); // sucursal de otro local
    expect((await guardar(local.id, local.owner.id, 30, ["no", "es", "objeto"])).error?.code).toBe("23514");
    expect((await guardar(local.id, local.owner.id, 30, { texto: "x".repeat(9000) })).error?.code).toBe("23514");
    expect((await guardar(local.id, local.owner.id, 30, CONTENIDO, undefined, "  ")).error?.code).toBe("23514");
    expect((await guardar(local.id, local.owner.id, 30, CONTENIDO, undefined, "p".repeat(41))).error?.code).toBe("23514");
    expect(filas(local.id)).toBe(0);
    expect(filas(otro.id)).toBe(0);
  });
});

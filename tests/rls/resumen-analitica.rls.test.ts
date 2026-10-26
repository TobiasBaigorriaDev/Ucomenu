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
 * de un local con el plan guarda y lee su resumen; la tabla no admite escrituras directas de nadie (ni del servicio técnico);
 * la fila es una por período y alcance, se reemplaza al regenerar y desaparece con la sucursal.
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

const guardar = (db: Db, org: string, dias: number, contenido: unknown = CONTENIDO, branch?: string, provider = "gemini") =>
  db.rpc("save_analytics_summary", { p_org: org, p_days: dias, p_content: contenido as never, p_provider: provider, ...(branch ? { p_branch: branch } : {}) });

const leer = (db: Db, org: string) => db.from("analytics_summaries").select("days, branch_id, content, provider, generated_by").eq("organization_id", org).order("days");

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
  it("el Dueño guarda su resumen y lo lee; la fila anota quién y con qué servicio", async () => {
    const local = await crearLocal();
    const guardado = await guardar(local.owner.db, local.id, 30);
    expect(guardado.error).toBeNull();
    expect(typeof guardado.data).toBe("string");

    const r = await leer(local.owner.db, local.id);
    expect(r.error).toBeNull();
    expect(r.data).toEqual([{ days: 30, branch_id: null, content: CONTENIDO, provider: "gemini", generated_by: local.owner.id }]);
  });

  it("una fila por período y alcance: regenerar la reemplaza; otro período u otra sucursal es otra fila", async () => {
    const local = await crearLocal();
    await guardar(local.owner.db, local.id, 30);
    await guardar(local.owner.db, local.id, 30, { ...CONTENIDO, summary: "Segunda versión." });
    expect(filas(local.id)).toBe(1);
    expect((await leer(local.owner.db, local.id)).data?.[0].content).toMatchObject({ summary: "Segunda versión." });

    await guardar(local.owner.db, local.id, 7);
    await guardar(local.owner.db, local.id, 30, CONTENIDO, local.uno);
    await guardar(local.owner.db, local.id, 30, CONTENIDO, local.dos);
    await guardar(local.owner.db, local.id, 30, { ...CONTENIDO, summary: "Sucursal uno, versión 2." }, local.uno);
    expect(filas(local.id)).toBe(4);
    const porSucursal = (await leer(local.owner.db, local.id)).data!.filter((fila) => fila.branch_id === local.uno);
    expect(porSucursal).toHaveLength(1);
    expect(porSucursal[0].content).toMatchObject({ summary: "Sucursal uno, versión 2." });
  });

  it("la fila desaparece con la sucursal", async () => {
    const local = await crearLocal();
    await guardar(local.owner.db, local.id, 30, CONTENIDO, local.dos);
    await guardar(local.owner.db, local.id, 30);
    sql(`delete from public.branches where id = '${local.dos}'`);
    expect((await leer(local.owner.db, local.id)).data?.map((fila) => fila.branch_id)).toEqual([null]);
  });
});

describe("quién puede guardar y leer", () => {
  it("Staff, Dueño de otro local, sin rol y plan Básico no guardan; anon se rechaza; el Staff y los ajenos no leen nada", async () => {
    const local = await crearLocal();
    await guardar(local.owner.db, local.id, 30);
    const otro = await crearLocal();

    for (const [nombre, db] of [
      ["Staff", local.staff.db],
      ["Dueño de otro local", otro.owner.db],
      ["sin rol", comun.db],
      ["Dueño ajeno sin membresía", ajeno.db],
    ] as const) {
      const g = await guardar(db, local.id, 7);
      expect([nombre, g.error?.code], nombre).toEqual([nombre, "42501"]);
      const r = await leer(db, local.id);
      expect([nombre, r.error, r.data], nombre).toEqual([nombre, null, []]);
    }
    expect((await guardar(anonClient(), local.id, 7)).error).not.toBeNull();
    expect((await leer(anonClient(), local.id)).error).not.toBeNull();
    expect(filas(local.id)).toBe(1);

    const basico = await crearLocal("basic");
    expect((await guardar(basico.owner.db, basico.id, 30)).error?.code).toBe("42501");
    sql(`insert into public.analytics_summaries (organization_id, days, content, provider) values ('${basico.id}', 30, '{}'::jsonb, 'gemini')`);
    expect((await leer(basico.owner.db, basico.id)).data).toEqual([]);
  });

  it("en «solo lectura» guarda y lee (como la analítica); suspendida no", async () => {
    const local = await crearLocal();
    await setSubscription(service, local.id, { finEnMs: -10 * DIA_MS });
    expect((await guardar(local.owner.db, local.id, 30)).error).toBeNull();
    expect((await leer(local.owner.db, local.id)).data).toHaveLength(1);

    await setSubscription(service, local.id, { finEnMs: -30 * DIA_MS });
    expect((await guardar(local.owner.db, local.id, 7)).error?.code).toBe("42501");
    expect((await leer(local.owner.db, local.id)).data).toEqual([]);
  });

  it("quien deja de ser Dueño deja de leer y de guardar al instante", async () => {
    const local = await crearLocal();
    await guardar(local.owner.db, local.id, 30);
    await addMembership(service, ajeno, local.id, "owner"); // la base exige al menos un Dueño
    sql(`update public.memberships set role = 'staff' where user_id = '${local.owner.id}' and organization_id = '${local.id}'`);
    expect((await leer(local.owner.db, local.id)).data).toEqual([]);
    expect((await guardar(local.owner.db, local.id, 7)).error?.code).toBe("42501");
    expect((await leer(ajeno.db, local.id)).data).toHaveLength(1);
  });

  it("un local no ve los resúmenes de otro", async () => {
    const a = await crearLocal();
    const b = await crearLocal();
    await guardar(a.owner.db, a.id, 30);
    await guardar(b.owner.db, b.id, 30, { ...CONTENIDO, summary: "De B." });
    expect((await leer(a.owner.db, a.id)).data?.map((fila) => fila.content)).toEqual([CONTENIDO]);
    expect((await leer(a.owner.db, b.id)).data).toEqual([]);
  });
});

describe("la tabla no admite escrituras directas", () => {
  it("ni el Dueño ni el servicio técnico insertan, modifican ni borran por la API", async () => {
    const local = await crearLocal();
    await guardar(local.owner.db, local.id, 30);
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
    }
    expect(filas(local.id)).toBe(1);
    expect(sql(`select provider from public.analytics_summaries where organization_id = '${local.id}'`)[0][0]).toBe("gemini");
  });
});

describe("validaciones", () => {
  it("período, sucursal y contenido inválidos se rechazan sin guardar nada", async () => {
    const local = await crearLocal();
    const otro = await crearLocal();

    expect((await guardar(local.owner.db, local.id, 14)).error?.code).toBe("22023");
    expect((await guardar(local.owner.db, local.id, 30, CONTENIDO, otro.uno)).error?.code).toBe("22023"); // sucursal de otro local
    expect((await guardar(local.owner.db, local.id, 30, ["no", "es", "objeto"])).error?.code).toBe("23514");
    expect((await guardar(local.owner.db, local.id, 30, { texto: "x".repeat(9000) })).error?.code).toBe("23514");
    expect((await guardar(local.owner.db, local.id, 30, CONTENIDO, undefined, "  ")).error?.code).toBe("23514");
    expect((await guardar(local.owner.db, local.id, 30, CONTENIDO, undefined, "p".repeat(41))).error?.code).toBe("23514");
    expect(filas(local.id)).toBe(0);
    expect(filas(otro.id)).toBe(0);
  });
});

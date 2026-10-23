import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMembership, anonClient, createOrg, createUser, deleteOrg, deleteUser, DIA_MS, serviceClient, setSubscription, sql, type Db, type PlanCode, type TestUser } from "./helpers";

/**
 * Comentarios con aprobación previa del feed (nivel C, ficha comentarios-del-feed, ADR 0031) en la base: `submit_video_comment` es la
 * única puerta de alta y la fila nace pendiente; `anon` solo lee aprobados de videos públicos; Dueño y Staff moderan solo su
 * organización y solo el estado; `comment_count` coincide siempre con los aprobados; disponibilidad en vivo, sesión cerrada,
 * límite por conexión, tope de pendientes y la purga de retención. Contra el Supabase local.
 */

const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const MIN = 60 * 1000;
const INSUFFICIENT_PRIVILEGE = "42501";
const UNAVAILABLE = { status: "unavailable" };
const NOT_FOUND = { status: "not_found" };
const INVALID = { status: "invalid" };
const OK = { status: "ok" };

let service: Db;
let anon: Db;
const users: TestUser[] = [];
const orgs: string[] = [];
let contador = 0;

const nuevaClave = () => randomBytes(16).toString("hex");

type Local = { id: string; owner: TestUser; staff: TestUser; branch: string; table: string; token: string; table2: string; token2: string };

async function crearLocal(plan: PlanCode = "premium", finEnMs = 30 * DIA_MS): Promise<Local> {
  contador += 1;
  const id = await createOrg(service, `tt-vcom-${sufijo}-${contador}`, plan);
  orgs.push(id);
  await setSubscription(service, id, { finEnMs });
  const owner = await createUser(service, `vcom-d${contador}`);
  const staff = await createUser(service, `vcom-s${contador}`);
  users.push(owner, staff);
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
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
  return { id, owner, staff, branch: branch.data.id, table: tables.data[0].id, token: tables.data[0].qr_token, table2: tables.data[1].id, token2: tables.data[1].qr_token };
}

async function sembrarVideo(orgId: string, cambios: { status?: "draft" | "published" | "deleting"; mux_status?: "processing" | "ready" } = {}): Promise<string> {
  const mux_status = cambios.mux_status ?? "ready";
  const listo = mux_status === "ready";
  const marca = `${sufijo}-${randomUUID().slice(0, 8)}`;
  const { data, error } = await service
    .from("menu_videos")
    .insert({
      organization_id: orgId,
      title: "tt-video",
      status: cambios.status ?? "published",
      mux_status,
      mux_upload_id: `up-${marca}`,
      mux_asset_id: listo ? `as-${marca}` : null,
      mux_playback_id: listo ? `pb-${marca}` : null,
      duration_seconds: listo ? 10 : null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

type Pedido = { token: string; video: string; body?: string; alias?: string | null; rate?: string | null; visita?: string | null };
const enviar = async ({ token, video, body = "Qué rico se ve", alias = null, rate = nuevaClave(), visita = null }: Pedido, db: Db = anon) => {
  const r = await db.rpc("submit_video_comment", {
    p_token: token,
    p_video: video,
    p_body: body,
    ...(alias === null ? {} : { p_alias: alias }),
    ...(rate ? { p_rate: rate } : {}),
    ...(visita ? { p_visit_started_at: visita } : {}),
  });
  expect(r.error).toBeNull();
  return r.data as Record<string, unknown>;
};

/** Cambia fechas de filas ya creadas: el trigger de moderación (que las fija) se salta con `session_replication_role = replica`. */
const sinTriggers = (statement: string) => sql(`set session_replication_role = replica; ${statement}`);

const conteo = async (video: string) => (await service.from("menu_videos").select("comment_count").eq("id", video).single()).data?.comment_count;
const filas = async (video: string) => (await service.from("video_comments").select("*").eq("video_id", video).order("created_at")).data ?? [];
const unico = async (video: string) => {
  const todas = await filas(video);
  expect(todas).toHaveLength(1);
  return todas[0];
};
const moderar = async (db: Db, id: string, status: "approved" | "rejected" | "pending") => db.from("video_comments").update({ status }).eq("id", id).select("id");
/** Lo que ve el público de un video (la política decide; el cliente no filtra por estado). */
const publico = async (video: string) => (await anon.from("video_comments").select("id, body, alias").eq("video_id", video)).data ?? [];

beforeAll(() => {
  service = serviceClient();
  anon = anonClient();
});

afterAll(async () => {
  for (const id of orgs) await deleteOrg(service, id);
  for (const u of users) await deleteUser(service, u);
});

describe("enviar y moderar", () => {
  it("nace pendiente, sin datos de la mesa, y el público no lo ve ni lo cuenta", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    const rate = nuevaClave();
    expect(await enviar({ token: local.token, video, body: "Muy rico", alias: "Ana", rate })).toEqual(OK);
    const fila = await unico(video);
    expect(Object.keys(fila).sort()).toEqual(["alias", "body", "created_at", "id", "moderated_at", "organization_id", "rate_key", "status", "video_id"]);
    expect(fila).toMatchObject({ video_id: video, organization_id: local.id, body: "Muy rico", alias: "Ana", status: "pending", rate_key: rate, moderated_at: null });
    expect(await publico(video)).toEqual([]);
    expect(await conteo(video)).toBe(0);
  });

  it("el alias es opcional: vacío o solo espacios queda sin alias; el texto se guarda recortado", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    expect(await enviar({ token: local.token, video, body: "  Hola  ", alias: "   " })).toEqual(OK);
    expect(await enviar({ token: local.token2, video, body: "Sin alias" })).toEqual(OK);
    const todas = await filas(video);
    expect(todas.map((f) => [f.body, f.alias])).toEqual([["Hola", null], ["Sin alias", null]]);
  });

  it("el Dueño y el Staff lo ven pendiente (sin rate_key), lo aprueban y recién ahí lo ve el público, con el conteo", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    await enviar({ token: local.token, video, body: "Para el Dueño", alias: "Luz" });
    await enviar({ token: local.token, video, body: "Para el Staff" });
    const todas = await filas(video);
    const a = todas.find((f) => f.body === "Para el Dueño")!.id;
    const b = todas.find((f) => f.body === "Para el Staff")!.id;

    for (const miembro of [local.owner, local.staff]) {
      const vistos = await miembro.db.from("video_comments").select("id, body, alias, status, created_at, moderated_at").eq("video_id", video);
      expect(vistos.error).toBeNull();
      expect(vistos.data).toHaveLength(2);
      // Ni siquiera quien modera lee la clave de conexión (ni puede pedir todas las columnas).
      expect((await miembro.db.from("video_comments").select("rate_key")).error?.code).toBe(INSUFFICIENT_PRIVILEGE);
      expect((await miembro.db.from("video_comments").select("*")).error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    }

    expect((await moderar(local.owner.db, a, "approved")).data).toHaveLength(1);
    expect((await moderar(local.staff.db, b, "approved")).data).toHaveLength(1);
    expect(await conteo(video)).toBe(2);
    const visibles = await publico(video);
    expect(visibles.map((c) => c.body).sort()).toEqual(["Para el Dueño", "Para el Staff"]);
    // El público lee cinco columnas: ni el estado de moderación ni la organización ni la clave de conexión.
    expect((await anon.from("video_comments").select("*").eq("video_id", video)).error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    const columnas = await anon.from("video_comments").select("id, video_id, body, alias, created_at").eq("video_id", video);
    expect(columnas.error).toBeNull();
    expect(Object.keys(columnas.data![0]).sort()).toEqual(["alias", "body", "created_at", "id", "video_id"]);
  });

  it("rechazar lo oculta, se puede recuperar, retirar un publicado lo saca y resta; cada paso deja moderated_at", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    await enviar({ token: local.token, video });
    const { id } = await unico(video);

    await moderar(local.owner.db, id, "approved");
    expect(await conteo(video)).toBe(1);
    expect((await unico(video)).moderated_at).not.toBeNull();
    expect(await publico(video)).toHaveLength(1);

    await moderar(local.staff.db, id, "rejected"); // retirar
    expect(await conteo(video)).toBe(0);
    expect(await publico(video)).toEqual([]);
    expect((await unico(video)).status).toBe("rejected");

    await moderar(local.owner.db, id, "approved"); // recuperar
    expect(await conteo(video)).toBe(1);
    expect(await publico(video)).toHaveLength(1);

    await moderar(local.owner.db, id, "rejected");
    await moderar(local.owner.db, id, "rejected"); // repetir no resta dos veces
    expect(await conteo(video)).toBe(0);
  });

  it("rechazar un pendiente no cuenta y recuperarlo sí: el conteo solo mira aprobados", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    await enviar({ token: local.token, video });
    const { id } = await unico(video);
    await moderar(local.owner.db, id, "rejected");
    expect(await conteo(video)).toBe(0);
    await moderar(local.owner.db, id, "approved");
    expect(await conteo(video)).toBe(1);
  });

  it("comment_count coincide con los aprobados con altas simultáneas, bajas directas y el borrado del video", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    await Promise.all(Array.from({ length: 6 }, (_, i) => enviar({ token: local.token, video, body: `c${i}` })));
    const todas = await filas(video);
    expect(todas).toHaveLength(6);
    await Promise.all(todas.map((f) => moderar(local.owner.db, f.id, "approved")));
    expect(await conteo(video)).toBe(6);
    sql(`delete from public.video_comments where id in (select id from public.video_comments where video_id = '${video}' and status = 'approved' limit 2)`);
    expect(await conteo(video)).toBe(4);
    expect((await service.from("menu_videos").delete().eq("id", video)).error).toBeNull();
    expect(await filas(video)).toEqual([]);
  });
});

describe("moderación: quién y qué", () => {
  it("otra organización no ve ni modera mis comentarios; el público tampoco toca nada", async () => {
    const local = await crearLocal();
    const ajeno = await crearLocal();
    const video = await sembrarVideo(local.id);
    await enviar({ token: local.token, video });
    const { id } = await unico(video);

    expect((await ajeno.owner.db.from("video_comments").select("id").eq("id", id)).data).toEqual([]);
    expect((await moderar(ajeno.owner.db, id, "approved")).data).toEqual([]);
    expect((await unico(video)).status).toBe("pending");
    // anon no lee pendientes ni siquiera por id; tampoco puede moderar.
    expect(await publico(video)).toEqual([]);
    expect((await moderar(anon, id, "approved")).error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect((await unico(video)).status).toBe("pending");
  });

  it("un miembro cambia solo el estado: el texto, el alias y el video no se tocan (tampoco con el servidor)", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    const otroVideo = await sembrarVideo(local.id);
    await enviar({ token: local.token, video, alias: "Ana" });
    const { id } = await unico(video);

    for (const cambios of [{ body: "otro" }, { alias: "otro" }, { video_id: otroVideo }, { organization_id: randomUUID() }, { rate_key: null }, { created_at: new Date().toISOString() }, { moderated_at: new Date().toISOString() }]) {
      const r = await local.owner.db.from("video_comments").update(cambios as never).eq("id", id);
      expect(r.error?.code, JSON.stringify(cambios)).toBe(INSUFFICIENT_PRIVILEGE);
    }
    const servidor = await service.from("video_comments").update({ body: "reescrito" }).eq("id", id);
    expect(servidor.error?.code).toBe("55000");
    const mover = await service.from("video_comments").update({ video_id: otroVideo }).eq("id", id);
    expect(mover.error?.code).toBe("55000");
    expect(await unico(video)).toMatchObject({ body: "Qué rico se ve", alias: "Ana", video_id: video });
  });

  it("nada vuelve a «pendiente»: ni un miembro ni el servidor", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    await enviar({ token: local.token, video });
    const { id } = await unico(video);
    await moderar(local.owner.db, id, "approved");
    expect((await moderar(local.owner.db, id, "pending")).error).not.toBeNull();
    expect((await service.from("video_comments").update({ status: "pending", moderated_at: null }).eq("id", id)).error?.code).toBe("55000");
    expect((await unico(video)).status).toBe("approved");
    // Un valor fuera del dominio tampoco entra.
    expect((await service.from("video_comments").update({ status: "otro" }).eq("id", id)).error).not.toBeNull();
  });

  it("nadie inserta ni borra por la API; anon no lee el estado ni la clave de conexión", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    await enviar({ token: local.token, video });
    const { id } = await unico(video);
    for (const [nombre, db] of [["anon", anon], ["Dueño", local.owner.db], ["Staff", local.staff.db]] as const) {
      const alta = await db.from("video_comments").insert({ video_id: video, organization_id: local.id, body: "colado" });
      expect(alta.error?.code, `${nombre} inserta`).toBe(INSUFFICIENT_PRIVILEGE);
      expect((await db.from("video_comments").delete().eq("id", id)).error?.code, `${nombre} borra`).toBe(INSUFFICIENT_PRIVILEGE);
    }
    for (const columna of ["rate_key", "status", "organization_id", "moderated_at"]) {
      expect((await anon.from("video_comments").select(columna)).error?.code, `anon lee ${columna}`).toBe(INSUFFICIENT_PRIVILEGE);
    }
    expect(await filas(video)).toHaveLength(1);
  });

  it("comment_count: anon lo lee del video público pero nadie lo escribe por la API; ni negativo ni con el servidor", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    await enviar({ token: local.token, video });
    await moderar(local.owner.db, (await unico(video)).id, "approved");
    expect((await anon.from("menu_videos").select("comment_count").eq("id", video).single()).data).toEqual({ comment_count: 1 });
    for (const [nombre, db] of [["anon", anon], ["Dueño", local.owner.db]] as const) {
      expect((await db.from("menu_videos").update({ comment_count: 99 }).eq("id", video).select("id")).error?.code, nombre).toBe(INSUFFICIENT_PRIVILEGE);
    }
    expect((await service.from("menu_videos").update({ comment_count: -1 }).eq("id", video)).error).not.toBeNull();
    expect(await conteo(video)).toBe(1);
  });

  it("con la cuenta en solo lectura se puede rechazar y retirar, pero no aprobar; suspendida, igual", async () => {
    for (const [nombre, finEnMs] of [["solo lectura", -9 * DIA_MS], ["suspendida", -30 * DIA_MS]] as const) {
      const local = await crearLocal();
      const video = await sembrarVideo(local.id);
      await enviar({ token: local.token, video, body: "uno" });
      await enviar({ token: local.token, video, body: "dos" });
      const [uno, dos] = await filas(video);
      await moderar(local.owner.db, uno.id, "approved"); // aprobado con la cuenta al día
      await setSubscription(service, local.id, { finEnMs });

      const aprobar = await moderar(local.owner.db, dos.id, "approved");
      expect(aprobar.error?.code ?? "sin error", `${nombre}: aprobar`).toBe(INSUFFICIENT_PRIVILEGE);
      expect((await filas(video)).find((f) => f.id === dos.id)?.status, `${nombre}: sigue pendiente`).toBe("pending");

      expect((await moderar(local.staff.db, uno.id, "rejected")).data, `${nombre}: retirar`).toHaveLength(1);
      expect((await moderar(local.owner.db, dos.id, "rejected")).data, `${nombre}: rechazar`).toHaveLength(1);
      expect(await conteo(video), nombre).toBe(0);
      // Recuperar es aprobar: tampoco.
      expect((await moderar(local.owner.db, uno.id, "approved")).error, `${nombre}: recuperar`).not.toBeNull();
    }
  });
});

describe("lo que ve el público", () => {
  it("solo aprobados de un video público: despublicar lo oculta; republicar lo devuelve", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    await enviar({ token: local.token, video });
    await moderar(local.owner.db, (await unico(video)).id, "approved");
    expect(await publico(video)).toHaveLength(1);
    await local.owner.db.from("menu_videos").update({ status: "draft" }).eq("id", video);
    expect(await publico(video)).toEqual([]);
    await local.owner.db.from("menu_videos").update({ status: "published" }).eq("id", video);
    expect(await publico(video)).toHaveLength(1);
  });

  it("sigue el plan y la cuenta como el feed: Básico y Pro no; en solo lectura sí; suspendida no", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    await enviar({ token: local.token, video });
    await moderar(local.owner.db, (await unico(video)).id, "approved");
    for (const plan of ["pro", "basic"] as const) {
      await setSubscription(service, local.id, { plan });
      expect(await publico(video), plan).toEqual([]);
    }
    await setSubscription(service, local.id, { plan: "premium", finEnMs: -9 * DIA_MS });
    expect(await publico(video)).toHaveLength(1); // solo lectura: los videos y sus comentarios se siguen viendo
    await setSubscription(service, local.id, { finEnMs: -30 * DIA_MS });
    expect(await publico(video)).toEqual([]);
  });

  it("los más nuevos primero y por páginas", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    for (let i = 0; i < 5; i += 1) await enviar({ token: local.token, video, body: `n${i}` });
    const todas = await filas(video);
    for (const f of todas) await moderar(local.owner.db, f.id, "approved");
    const pagina = await anon.from("video_comments").select("body").eq("video_id", video).order("created_at", { ascending: false }).order("id", { ascending: false }).range(0, 2);
    expect(pagina.data).toHaveLength(3);
    expect(pagina.data![0].body).toBe("n4");
  });
});

describe("validaciones de forma", () => {
  it("token, video o texto imposibles: sin escribir", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    const llamar = async (args: Record<string, unknown>) => (await anon.rpc("submit_video_comment", args as never)).data;
    const base = { p_token: local.token, p_video: video, p_body: "hola" };
    expect(await llamar({ ...base, p_token: "no-es-un-token" })).toEqual(NOT_FOUND);
    expect(await llamar({ ...base, p_token: "A".repeat(32) })).toEqual(NOT_FOUND);
    expect(await llamar({ ...base, p_token: nuevaClave() })).toEqual(NOT_FOUND);
    expect(await llamar({ ...base, p_video: null })).toEqual(NOT_FOUND);
    expect(await llamar({ ...base, p_body: null })).toEqual(INVALID);
    expect(await llamar({ ...base, p_body: "" })).toEqual(INVALID);
    expect(await llamar({ ...base, p_body: "   " })).toEqual(INVALID);
    expect(await llamar({ ...base, p_body: "x".repeat(281) })).toEqual(INVALID);
    expect(await llamar({ ...base, p_body: "con\ntab\t" })).toEqual(INVALID);
    expect(await llamar({ ...base, p_body: "con\u0000nulo" })).not.toEqual(OK);
    expect(await llamar({ ...base, p_alias: "a".repeat(31) })).toEqual(INVALID);
    expect(await llamar({ ...base, p_alias: "con\nsalto" })).toEqual(INVALID);
    expect(await filas(video)).toEqual([]);
  });

  it("280 caracteres y alias de 30 entran; los emojis y los acentos cuentan como caracteres", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    expect(await enviar({ token: local.token, video, body: "ñ".repeat(280), alias: "á".repeat(30) })).toEqual(OK);
    expect(await enviar({ token: local.token2, video, body: "🍕".repeat(280), alias: "😀".repeat(30) })).toEqual(OK);
    expect(await filas(video)).toHaveLength(2);
  });

  it("una conexión con otro formato no se cuenta ni se guarda", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    const r = await anon.rpc("submit_video_comment", { p_token: local.token, p_video: video, p_body: "hola", p_rate: "no-es-hex" });
    expect(r.data).toEqual(OK);
    expect((await unico(video)).rate_key).toBeNull();
  });

  it("hay una sola submit_video_comment y una sola purge_video_comments", () => {
    const argumentos = (nombre: string) => sql(`select pg_get_function_identity_arguments(oid) from pg_proc where proname = '${nombre}' and pronamespace = 'public'::regnamespace`);
    expect(argumentos("submit_video_comment")).toEqual([["p_token text, p_video uuid, p_body text, p_alias text, p_rate text, p_visit_started_at timestamp with time zone"]]);
    expect(argumentos("purge_video_comments")).toEqual([["p_rejected_retention interval, p_pending_retention interval, p_batch integer"]]);
  });
});

describe("disponibilidad en vivo", () => {
  it("el video tiene que estar publicado y listo y ser de la organización de la mesa", async () => {
    const local = await crearLocal();
    const otro = await crearLocal();
    const borrador = await sembrarVideo(local.id, { status: "draft" });
    const borrandose = await sembrarVideo(local.id, { status: "deleting" });
    const procesando = await sembrarVideo(local.id, { status: "draft", mux_status: "processing" });
    const ajeno = await sembrarVideo(otro.id);
    for (const video of [borrador, borrandose, procesando, ajeno, randomUUID()]) {
      expect(await enviar({ token: local.token, video }), video).toEqual(UNAVAILABLE);
    }
    for (const video of [borrador, borrandose, procesando, ajeno]) expect(await filas(video)).toEqual([]);
  });

  it("Básico y Pro no reciben comentarios aunque haya videos; volver a Premium los devuelve", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    for (const plan of ["pro", "basic"] as const) {
      await setSubscription(service, local.id, { plan });
      expect(await enviar({ token: local.token, video }), plan).toEqual(UNAVAILABLE);
    }
    await setSubscription(service, local.id, { plan: "premium" });
    expect(await enviar({ token: local.token, video })).toEqual(OK);
  });

  it("al día y en gracia reciben; en solo lectura y suspendida, no", async () => {
    for (const [nombre, finEnMs, esperado] of [
      ["al día", 5 * DIA_MS, "ok"],
      ["en gracia", -2 * DIA_MS, "ok"],
      ["en solo lectura", -9 * DIA_MS, "unavailable"],
      ["suspendida por mora", -30 * DIA_MS, "unavailable"],
    ] as const) {
      const local = await crearLocal();
      const video = await sembrarVideo(local.id);
      await setSubscription(service, local.id, { finEnMs });
      expect((await enviar({ token: local.token, video })).status, nombre).toBe(esperado);
      expect(await filas(video), nombre).toHaveLength(esperado === "ok" ? 1 : 0);
    }
  });

  it("la suspensión manual y la baja de la organización cortan los comentarios", async () => {
    const manual = await crearLocal();
    const video = await sembrarVideo(manual.id);
    sql(`update public.subscriptions set suspended_at = now() where organization_id = '${manual.id}'`);
    expect(await enviar({ token: manual.token, video })).toEqual(UNAVAILABLE);
    sql(`update public.subscriptions set suspended_at = null where organization_id = '${manual.id}'`);
    expect(await enviar({ token: manual.token, video })).toEqual(OK);

    const baja = await crearLocal();
    const videoBaja = await sembrarVideo(baja.id);
    sql(`update public.organizations set is_active = false where id = '${baja.id}'`);
    expect(await enviar({ token: baja.token, video: videoBaja })).toEqual(NOT_FOUND);
  });

  it("una mesa o una sucursal desactivada no reciben; una mesa silenciada sí", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    await service.from("tables").update({ muted_until: new Date(Date.now() + 30 * MIN).toISOString() }).eq("id", local.table);
    expect(await enviar({ token: local.token, video })).toEqual(OK);
    await service.from("tables").update({ muted_until: null, is_active: false }).eq("id", local.table);
    expect(await enviar({ token: local.token, video })).toEqual(UNAVAILABLE);
    expect(await enviar({ token: local.token2, video })).toEqual(OK);
    await service.from("branches").update({ is_active: false }).eq("id", local.branch);
    expect(await enviar({ token: local.token2, video })).toEqual(UNAVAILABLE);
    await service.from("branches").update({ is_active: true }).eq("id", local.branch);
    expect(await enviar({ token: local.token2, video })).toEqual(OK);
  });

  it("regenerar el QR de la mesa deja sin efecto el token anterior", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    await service.from("tables").update({ qr_token: nuevaClave() }).eq("id", local.table);
    expect(await enviar({ token: local.token, video })).toEqual(NOT_FOUND);
  });

  it("resolve_table_qr informa comments_enabled con las mismas condiciones", async () => {
    const habilitado = async (token: string) => ((await anon.rpc("resolve_table_qr", { p_token: token })).data as { comments_enabled: boolean }).comments_enabled;
    const local = await crearLocal();
    expect(await habilitado(local.token)).toBe(true);
    await setSubscription(service, local.id, { plan: "pro" });
    expect(await habilitado(local.token)).toBe(false);
    await setSubscription(service, local.id, { plan: "premium", finEnMs: -9 * DIA_MS });
    expect(await habilitado(local.token)).toBe(false);
    await setSubscription(service, local.id, { finEnMs: 5 * DIA_MS });
    expect(await habilitado(local.token)).toBe(true);
    await service.from("tables").update({ is_active: false }).eq("id", local.table);
    expect(await habilitado(local.token)).toBe(false);
    expect(await habilitado(local.token2)).toBe(true);
    await service.from("branches").update({ is_active: false }).eq("id", local.branch);
    expect(await habilitado(local.token2)).toBe(false);
  });
});

describe("sesión cerrada por la cuenta atendida", () => {
  const atenderCuentaHace = async (local: Local, minutos: number) => {
    const r = await service.from("waiter_calls").insert({ organization_id: local.id, branch_id: local.branch, table_id: local.table, kind: "bill", status: "attended", attended_at: new Date(Date.now() - minutos * MIN).toISOString() });
    expect(r.error).toBeNull();
  };
  const ticketDeHace = (ms: number) => new Date(Math.floor((Date.now() - ms) / 1000) * 1000).toISOString();

  it("un ticket anterior a la cuenta atendida hace más de 10 minutos ya no comenta; con menos, sí; uno posterior, sí", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    await atenderCuentaHace(local, 5);
    expect(await enviar({ token: local.token, video, visita: ticketDeHace(30 * MIN) })).toEqual(OK); // gracia
    sql(`update public.waiter_calls set attended_at = now() - interval '11 minutes' where table_id = '${local.table}'`);
    expect(await enviar({ token: local.token, video, body: "tarde", visita: ticketDeHace(30 * MIN) })).toEqual({ status: "session_closed" });
    expect(await enviar({ token: local.token, video, body: "después", visita: ticketDeHace(2 * MIN) })).toEqual(OK);
    expect((await filas(video)).map((f) => f.body).sort()).toEqual(["después", "Qué rico se ve"].sort());
  });

  it("sin ticket verosímil no hay nada que comparar", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    await atenderCuentaHace(local, 11);
    for (const visita of [null, new Date(Date.now() - 25 * 60 * MIN).toISOString(), new Date(Date.now() + 5 * MIN).toISOString()]) {
      expect(await enviar({ token: local.token, video, body: `v-${String(visita).slice(0, 4)}`, visita })).toEqual(OK);
    }
  });
});

describe("límite por cliente, reenvío y tope de pendientes", () => {
  it("10 comentarios por conexión cada 10 minutos; el 11 se rechaza con el tiempo de espera y no se crea; otra conexión sigue", async () => {
    const local = await crearLocal();
    const rate = nuevaClave();
    const video = await sembrarVideo(local.id);
    for (let i = 0; i < 10; i += 1) expect(await enviar({ token: local.token, video, body: `c${i}`, rate })).toEqual(OK);
    const r = await enviar({ token: local.token, video, body: "c10", rate });
    expect(r.status).toBe("rate_limited");
    expect(r.retry_after_seconds).toBeGreaterThanOrEqual(1);
    expect(r.retry_after_seconds).toBeLessThanOrEqual(600);
    expect(await filas(video)).toHaveLength(10);
    expect(await enviar({ token: local.token, video, body: "otra conexión" })).toEqual(OK);
    sinTriggers(`update public.video_comments set created_at = now() - interval '11 minutes' where video_id = '${video}' and rate_key = '${rate}'`);
    expect(await enviar({ token: local.token, video, body: "c10", rate })).toEqual(OK);
  }, 60_000);

  it("el límite cuenta todos los videos de la conexión, no cada uno por separado", async () => {
    const local = await crearLocal();
    const rate = nuevaClave();
    const a = await sembrarVideo(local.id);
    const b = await sembrarVideo(local.id);
    for (let i = 0; i < 5; i += 1) {
      await enviar({ token: local.token, video: a, body: `a${i}`, rate });
      await enviar({ token: local.token, video: b, body: `b${i}`, rate });
    }
    expect((await enviar({ token: local.token, video: a, body: "uno más", rate })).status).toBe("rate_limited");
  });

  it("un reenvío idéntico no duplica (aunque llegue en simultáneo) y no gasta el límite; otro texto u otro video sí es otro comentario", async () => {
    const local = await crearLocal();
    const rate = nuevaClave();
    const video = await sembrarVideo(local.id);
    const otro = await sembrarVideo(local.id);
    const respuestas = await Promise.all(Array.from({ length: 6 }, () => enviar({ token: local.token, video, body: "igual", alias: "Ana", rate })));
    for (const r of respuestas) expect(r).toEqual(OK);
    expect(await filas(video)).toHaveLength(1);
    expect(await enviar({ token: local.token, video, body: "igual", alias: "Bea", rate })).toEqual(OK); // otro alias
    expect(await enviar({ token: local.token, video: otro, body: "igual", alias: "Ana", rate })).toEqual(OK); // otro video
    expect(await filas(video)).toHaveLength(2);
    expect(await filas(otro)).toHaveLength(1);
    // Pasados 10 minutos el mismo texto vuelve a ser un comentario nuevo.
    sinTriggers(`update public.video_comments set created_at = now() - interval '11 minutes' where video_id = '${video}'`);
    expect(await enviar({ token: local.token, video, body: "igual", alias: "Ana", rate })).toEqual(OK);
    expect(await filas(video)).toHaveLength(3);
  });

  it("dos pedidos idénticos que esperan el lock con el cupo en 9: el segundo responde «ya estaba», no «límite»", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    const rate = nuevaClave();
    const previos = Array.from({ length: 9 }, (_, i) => ({ video_id: video, organization_id: local.id, body: `p${i}`, rate_key: rate }));
    expect((await service.from("video_comments").insert(previos)).error).toBeNull();

    // Otra sesión retiene el lock de esa conexión 3 segundos: los dos pedidos llegan, pasan las validaciones y quedan esperando.
    const retenedor = spawn("docker", ["exec", "supabase_db_ucomenu", "psql", "-U", "postgres", "-c", `select pg_advisory_lock(hashtextextended('video_comment_rate:${rate}', 0)), pg_sleep(3)`], { stdio: "ignore" });
    try {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const [a, b] = await Promise.all([enviar({ token: local.token, video, body: "décimo", rate }), enviar({ token: local.token, video, body: "décimo", rate })]);
      expect(a).toEqual(OK);
      expect(b).toEqual(OK);
      expect(await filas(video)).toHaveLength(10);
    } finally {
      retenedor.kill();
    }
  }, 60_000);

  it("100 pendientes por organización: el siguiente responde «cola llena» sin escribir; moderar uno libera lugar; otra organización no se afecta", async () => {
    const local = await crearLocal();
    const otra = await crearLocal();
    const video = await sembrarVideo(local.id);
    const videoOtra = await sembrarVideo(otra.id);
    const lote = Array.from({ length: 100 }, (_, i) => ({ video_id: video, organization_id: local.id, body: `p${i}` }));
    expect((await service.from("video_comments").insert(lote)).error).toBeNull();
    expect(await enviar({ token: local.token, video, body: "uno más" })).toEqual({ status: "queue_full" });
    expect(await filas(video)).toHaveLength(100);
    expect(await enviar({ token: otra.token, video: videoOtra })).toEqual(OK);
    const primero = (await filas(video))[0];
    await moderar(local.owner.db, primero.id, "rejected");
    expect(await enviar({ token: local.token, video, body: "ahora sí" })).toEqual(OK);
    // Con la cola llena un aprobado no cuenta como pendiente.
    expect(await enviar({ token: local.token, video, body: "el 101" })).toEqual({ status: "queue_full" });
  }, 60_000);

  it("altas simultáneas con la cola en 99: entra una sola", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    const lote = Array.from({ length: 99 }, (_, i) => ({ video_id: video, organization_id: local.id, body: `p${i}` }));
    expect((await service.from("video_comments").insert(lote)).error).toBeNull();
    const respuestas = await Promise.all(Array.from({ length: 5 }, (_, i) => enviar({ token: local.token, video, body: `s${i}` })));
    expect(respuestas.filter((r) => r.status === "ok")).toHaveLength(1);
    expect(respuestas.filter((r) => r.status === "queue_full")).toHaveLength(4);
    expect(await filas(video)).toHaveLength(100);
  }, 60_000);

  it("el rate_key se borra pasada una hora (en el próximo envío); el comentario queda", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    await enviar({ token: local.token, video, body: "viejo", rate: nuevaClave() });
    sinTriggers(`update public.video_comments set created_at = now() - interval '61 minutes' where video_id = '${video}'`);
    await enviar({ token: local.token2, video, body: "nuevo" }); // otro envío, de otra mesa: dispara la limpieza
    const vieja = (await service.from("video_comments").select("body, rate_key, status").eq("video_id", video).eq("body", "viejo").single()).data;
    expect(vieja).toEqual({ body: "viejo", rate_key: null, status: "pending" });
  });
});

describe("purga de retención", () => {
  const sembrarComentario = async (local: Local, video: string, estado: "pending" | "approved" | "rejected", hace: string, body = `${estado}-${hace}`) => {
    const moderado = estado === "pending" ? "null" : `now() - interval '${hace}'`;
    sql(
      `insert into public.video_comments (video_id, organization_id, body, status, created_at, moderated_at) values ('${video}', '${local.id}', '${body}', '${estado}', now() - interval '${hace}', ${moderado})`,
    );
  };
  const cuerpos = async (video: string) => (await filas(video)).map((f) => f.body).sort();
  const purgar = (args: Record<string, unknown> = {}) => service.rpc("purge_video_comments", args as never);

  it("borra rechazados de más de 7 días y pendientes de más de 30; nunca aprobados ni lo más reciente", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    await sembrarComentario(local, video, "rejected", "8 days", "rechazado viejo");
    await sembrarComentario(local, video, "rejected", "6 days", "rechazado reciente");
    await sembrarComentario(local, video, "pending", "31 days", "pendiente viejo");
    await sembrarComentario(local, video, "pending", "29 days", "pendiente reciente");
    await sembrarComentario(local, video, "approved", "400 days", "aprobado antiguo");
    const r = await purgar();
    expect(r.error).toBeNull();
    expect(r.data).toBeGreaterThanOrEqual(2); // puede haber filas viejas de otras pruebas en paralelo
    expect(await cuerpos(video)).toEqual(["aprobado antiguo", "pendiente reciente", "rechazado reciente"]);
  });

  it("el plazo del rechazado se cuenta desde que se rechazó, no desde que se envió", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    sql(`insert into public.video_comments (video_id, organization_id, body, status, created_at, moderated_at) values ('${video}', '${local.id}', 'enviado hace mucho, rechazado hoy', 'rejected', now() - interval '40 days', now() - interval '1 hour')`);
    await purgar();
    expect(await cuerpos(video)).toEqual(["enviado hace mucho, rechazado hoy"]);
  });

  it("un rechazo recuperado y vuelto a rechazar reinicia el plazo", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    await enviar({ token: local.token, video });
    const { id } = await unico(video);
    await moderar(local.owner.db, id, "rejected");
    sinTriggers(`update public.video_comments set moderated_at = now() - interval '8 days' where id = '${id}'`);
    await moderar(local.owner.db, id, "approved");
    await moderar(local.owner.db, id, "rejected");
    await purgar();
    expect(await filas(video)).toHaveLength(1);
  });

  it("respeta el lote, borrando de a poco", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    for (let i = 0; i < 4; i += 1) await sembrarComentario(local, video, "rejected", `${10 + i} days`, `r${i}`);
    expect((await purgar({ p_batch: 1 })).data).toBe(1);
    expect((await filas(video)).length).toBeGreaterThanOrEqual(3);
    expect((await purgar({ p_batch: 50000 })).error).toBeNull();
    expect(await filas(video)).toEqual([]);
  });

  it("rechaza plazos por debajo del piso, nulos, desbordados o lotes fuera de rango, sin borrar nada", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    await sembrarComentario(local, video, "rejected", "2 days", "r");
    await sembrarComentario(local, video, "pending", "8 days", "p");
    const casos: Record<string, unknown>[] = [
      { p_rejected_retention: "23 hours" },
      { p_rejected_retention: "0 days" },
      { p_rejected_retention: "-3 days" },
      { p_pending_retention: "6 days" },
      { p_pending_retention: "-3 days" },
      { p_batch: 0 },
      { p_batch: 50001 },
    ];
    for (const args of casos) {
      const r = await purgar(args);
      expect(r.error?.code, JSON.stringify(args)).toBe("22023");
    }
    expect((await purgar({ p_rejected_retention: null as never })).error?.code).toBe("22023");
    expect(await cuerpos(video)).toEqual(["p", "r"]);
    // Plazos más largos no borran lo de hace 2 u 8 días.
    expect((await purgar({ p_rejected_retention: "3 days", p_pending_retention: "9 days" })).error).toBeNull();
    expect(await cuerpos(video)).toEqual(["p", "r"]);
    // El piso exacto se acepta (y ahí sí caen el rechazado de 2 días y el pendiente de 8).
    expect((await purgar({ p_rejected_retention: "1 day", p_pending_retention: "7 days" })).error).toBeNull();
    expect(await cuerpos(video)).toEqual([]);
  });

  it("solo service_role la ejecuta: ni anon, ni el Dueño", async () => {
    const local = await crearLocal();
    for (const [nombre, db] of [["anon", anon], ["Dueño", local.owner.db], ["Staff", local.staff.db]] as const) {
      expect((await db.rpc("purge_video_comments" as never)).error?.code, nombre).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });
});

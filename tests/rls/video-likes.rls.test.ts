import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMembership, anonClient, createOrg, createUser, deleteOrg, deleteUser, DIA_MS, serviceClient, setSubscription, sql, type Db, type PlanCode, type TestUser } from "./helpers";

/**
 * Likes anónimos del feed (nivel C, ficha likes-del-feed, ADR 0031) en la base: `set_video_like` es la única puerta de escritura,
 * un like por dispositivo y video, `like_count` siempre igual a las filas, disponibilidad en vivo (plan, mora, mesa, sucursal,
 * video), sesión cerrada, límite por cliente y ningún permiso directo sobre `video_likes`. Contra el Supabase local.
 */

const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const MIN = 60 * 1000;
const INSUFFICIENT_PRIVILEGE = "42501";
const UNAVAILABLE = { status: "unavailable" };
const NOT_FOUND = { status: "not_found" };

let service: Db;
let anon: Db;
const users: TestUser[] = [];
const orgs: string[] = [];
let contador = 0;

/** Los códigos de dispositivo y de conexión son HMAC armados por el servidor: en la base, 32 hex. */
const nuevaClave = () => randomBytes(16).toString("hex");

type Local = { id: string; owner: TestUser; branch: string; table: string; token: string; table2: string; token2: string };

async function crearLocal(plan: PlanCode = "premium", finEnMs = 30 * DIA_MS): Promise<Local> {
  contador += 1;
  const id = await createOrg(service, `tt-vlike-${sufijo}-${contador}`, plan);
  orgs.push(id);
  await setSubscription(service, id, { finEnMs });
  const owner = await createUser(service, `vlike-d${contador}`);
  users.push(owner);
  await addMembership(service, owner, id, "owner");
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
  return { id, owner, branch: branch.data.id, table: tables.data[0].id, token: tables.data[0].qr_token, table2: tables.data[1].id, token2: tables.data[1].qr_token };
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

type Pedido = { token: string; video: string; liked?: boolean; device?: string; rate?: string | null; visita?: string | null };
const dar = async ({ token, video, liked = true, device = nuevaClave(), rate = nuevaClave(), visita = null }: Pedido, db: Db = anon) => {
  const r = await db.rpc("set_video_like", {
    p_token: token,
    p_video: video,
    p_liked: liked,
    p_device: device,
    ...(rate ? { p_rate: rate } : {}),
    ...(visita ? { p_visit_started_at: visita } : {}),
  });
  expect(r.error).toBeNull();
  return r.data as Record<string, unknown>;
};

const conteo = async (video: string) => (await service.from("menu_videos").select("like_count").eq("id", video).single()).data?.like_count;
const filas = async (video: string) => (await service.from("video_likes").select("*").eq("video_id", video)).data ?? [];

beforeAll(() => {
  service = serviceClient();
  anon = anonClient();
});

afterAll(async () => {
  for (const id of orgs) await deleteOrg(service, id);
  for (const u of users) await deleteUser(service, u);
});

describe("dar y quitar un like", () => {
  it("suma uno, queda la fila sin mesa ni sucursal y la respuesta trae el conteo", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    const device = nuevaClave();
    const rate = nuevaClave();
    expect(await dar({ token: local.token, video, device, rate })).toEqual({ status: "ok", liked: true, count: 1 });
    expect(await conteo(video)).toBe(1);
    const [fila, ...resto] = await filas(video);
    expect(resto).toHaveLength(0);
    // Ningún dato de la mesa, la sucursal ni el comensal: solo video, organización, las dos claves y la fecha.
    expect(Object.keys(fila).sort()).toEqual(["created_at", "device_key", "organization_id", "rate_key", "video_id"]);
    expect(fila).toMatchObject({ video_id: video, organization_id: local.id, device_key: device, rate_key: rate });
  });

  it("el mismo dispositivo no pasa de uno por video, aunque repita o cambie de mesa; otro dispositivo suma", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    const device = nuevaClave();
    expect(await dar({ token: local.token, video, device })).toEqual({ status: "ok", liked: true, count: 1 });
    expect(await dar({ token: local.token, video, device })).toEqual({ status: "ok", liked: true, count: 1 });
    expect(await dar({ token: local.token2, video, device })).toEqual({ status: "ok", liked: true, count: 1 });
    expect(await dar({ token: local.token, video })).toEqual({ status: "ok", liked: true, count: 2 });
    expect(await conteo(video)).toBe(2);
    expect(await filas(video)).toHaveLength(2);
  });

  it("dos dispositivos con la MISMA conexión suman 2 (el Wi-Fi del local no los confunde)", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    const rate = nuevaClave();
    await dar({ token: local.token, video, rate });
    expect(await dar({ token: local.token2, video, rate })).toEqual({ status: "ok", liked: true, count: 2 });
  });

  it("quitar resta uno, es idempotente y no toca el de otro dispositivo; volver a dar suma de nuevo", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    const a = nuevaClave();
    const b = nuevaClave();
    await dar({ token: local.token, video, device: a });
    await dar({ token: local.token, video, device: b });
    expect(await dar({ token: local.token, video, device: a, liked: false })).toEqual({ status: "ok", liked: false, count: 1 });
    expect(await dar({ token: local.token, video, device: a, liked: false })).toEqual({ status: "ok", liked: false, count: 1 });
    expect((await filas(video)).map((f) => f.device_key)).toEqual([b]);
    expect(await dar({ token: local.token, video, device: a })).toEqual({ status: "ok", liked: true, count: 2 });
  });

  it("pedidos simultáneos del mismo dispositivo dejan una sola fila y un conteo exacto", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    const device = nuevaClave();
    const rate = nuevaClave();
    const respuestas = await Promise.all(Array.from({ length: 8 }, () => dar({ token: local.token, video, device, rate })));
    for (const r of respuestas) expect(r).toMatchObject({ status: "ok", liked: true });
    expect(await filas(video)).toHaveLength(1);
    expect(await conteo(video)).toBe(1);
  });

  it("like_count siempre coincide con las filas, también con altas simultáneas de dispositivos distintos y con bajas directas", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    await Promise.all(Array.from({ length: 12 }, () => dar({ token: local.token, video })));
    expect(await filas(video)).toHaveLength(12);
    expect(await conteo(video)).toBe(12);
    sql(`delete from public.video_likes where ctid in (select ctid from public.video_likes where video_id = '${video}' limit 5)`);
    expect(await conteo(video)).toBe(7);
  });

  it("borrar el video borra sus likes", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    await dar({ token: local.token, video });
    expect((await service.from("menu_videos").delete().eq("id", video)).error).toBeNull();
    expect(await filas(video)).toEqual([]);
  });
});

describe("validaciones de forma", () => {
  it("token, video, intención o dispositivo imposibles: «no existe», sin escribir", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    const llamar = async (args: Record<string, unknown>) => (await anon.rpc("set_video_like", args as never)).data;
    const base = { p_token: local.token, p_video: video, p_liked: true, p_device: nuevaClave() };
    expect(await llamar({ ...base, p_token: "no-es-un-token" })).toEqual(NOT_FOUND);
    expect(await llamar({ ...base, p_token: "A".repeat(32) })).toEqual(NOT_FOUND);
    expect(await llamar({ ...base, p_token: nuevaClave() })).toEqual(NOT_FOUND); // formato válido, mesa inexistente
    expect(await llamar({ ...base, p_device: "corto" })).toEqual(NOT_FOUND);
    expect(await llamar({ ...base, p_device: nuevaClave().toUpperCase() })).toEqual(NOT_FOUND);
    expect(await llamar({ ...base, p_liked: null })).toEqual(NOT_FOUND);
    expect(await llamar({ ...base, p_video: null })).toEqual(NOT_FOUND);
    expect(await filas(video)).toEqual([]);
  });

  it("una conexión con otro formato no se cuenta ni se guarda", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    const r = await anon.rpc("set_video_like", { p_token: local.token, p_video: video, p_liked: true, p_device: nuevaClave(), p_rate: "no-es-hex" });
    expect(r.data).toMatchObject({ status: "ok" });
    expect((await filas(video))[0].rate_key).toBeNull();
  });

  it("hay una sola set_video_like", () => {
    const funciones = sql("select pg_get_function_identity_arguments(oid) from pg_proc where proname = 'set_video_like' and pronamespace = 'public'::regnamespace");
    expect(funciones).toEqual([["p_token text, p_video uuid, p_liked boolean, p_device text, p_rate text, p_visit_started_at timestamp with time zone"]]);
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
      expect(await dar({ token: local.token, video }), video).toEqual(UNAVAILABLE);
    }
    for (const video of [borrador, borrandose, procesando, ajeno]) expect(await filas(video)).toEqual([]);
  });

  it("despublicar un video corta los likes en el acto; volver a publicarlo los devuelve (lo ya contado queda)", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    await dar({ token: local.token, video });
    expect((await local.owner.db.from("menu_videos").update({ status: "draft" }).eq("id", video)).error).toBeNull();
    expect(await dar({ token: local.token, video })).toEqual(UNAVAILABLE);
    expect(await conteo(video)).toBe(1);
    expect((await local.owner.db.from("menu_videos").update({ status: "published" }).eq("id", video)).error).toBeNull();
    expect(await dar({ token: local.token, video })).toMatchObject({ status: "ok", count: 2 });
  });

  it("Básico y Pro no dan likes aunque haya videos; volver a Premium los devuelve", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    for (const plan of ["pro", "basic"] as const) {
      await setSubscription(service, local.id, { plan });
      expect(await dar({ token: local.token, video }), plan).toEqual(UNAVAILABLE);
    }
    await setSubscription(service, local.id, { plan: "premium" });
    expect(await dar({ token: local.token, video })).toMatchObject({ status: "ok" });
  });

  it("al día y en gracia dan likes; en solo lectura y suspendida, no (dar ni quitar)", async () => {
    for (const [nombre, finEnMs, esperado] of [
      ["al día", 5 * DIA_MS, "ok"],
      ["en gracia", -2 * DIA_MS, "ok"],
      ["en solo lectura", -9 * DIA_MS, "unavailable"],
      ["suspendida por mora", -30 * DIA_MS, "unavailable"],
    ] as const) {
      const local = await crearLocal();
      const video = await sembrarVideo(local.id);
      const device = nuevaClave();
      await dar({ token: local.token, video, device }); // con la cuenta al día
      await setSubscription(service, local.id, { finEnMs });
      expect((await dar({ token: local.token, video })).status, nombre).toBe(esperado);
      expect((await dar({ token: local.token, video, device, liked: false })).status, `${nombre} (quitar)`).toBe(esperado);
    }
  });

  it("la suspensión manual y la baja de la organización cortan los likes", async () => {
    const manual = await crearLocal();
    const video = await sembrarVideo(manual.id);
    sql(`update public.subscriptions set suspended_at = now() where organization_id = '${manual.id}'`);
    expect(await dar({ token: manual.token, video })).toEqual(UNAVAILABLE);
    sql(`update public.subscriptions set suspended_at = null where organization_id = '${manual.id}'`);
    expect(await dar({ token: manual.token, video })).toMatchObject({ status: "ok" });

    const baja = await crearLocal();
    const videoBaja = await sembrarVideo(baja.id);
    sql(`update public.organizations set is_active = false where id = '${baja.id}'`);
    expect(await dar({ token: baja.token, video: videoBaja })).toEqual(NOT_FOUND);
  });

  it("una mesa o una sucursal desactivada no dan likes; una mesa silenciada sí", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    await service.from("tables").update({ muted_until: new Date(Date.now() + 30 * MIN).toISOString() }).eq("id", local.table);
    expect(await dar({ token: local.token, video })).toMatchObject({ status: "ok" });
    await service.from("tables").update({ muted_until: null, is_active: false }).eq("id", local.table);
    expect(await dar({ token: local.token, video })).toEqual(UNAVAILABLE);
    expect(await dar({ token: local.token2, video })).toMatchObject({ status: "ok" }); // la otra mesa sigue
    await service.from("branches").update({ is_active: false }).eq("id", local.branch);
    expect(await dar({ token: local.token2, video })).toEqual(UNAVAILABLE);
    await service.from("branches").update({ is_active: true }).eq("id", local.branch);
    expect(await dar({ token: local.token2, video })).toMatchObject({ status: "ok" });
  });

  it("regenerar el QR de la mesa deja sin efecto el token anterior", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    const nuevo = await service.from("tables").update({ qr_token: nuevaClave() }).eq("id", local.table).select("qr_token").single();
    expect(nuevo.error).toBeNull();
    expect(await dar({ token: local.token, video })).toEqual(NOT_FOUND);
  });

  it("resolve_table_qr informa likes_enabled con las mismas condiciones", async () => {
    const habilitado = async (token: string) => ((await anon.rpc("resolve_table_qr", { p_token: token })).data as { likes_enabled: boolean }).likes_enabled;
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

  it("un ticket anterior a la cuenta atendida hace más de 10 minutos ya no da likes; con menos, sí; uno posterior, sí", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    await atenderCuentaHace(local, 5);
    expect(await dar({ token: local.token, video, visita: ticketDeHace(30 * MIN) })).toMatchObject({ status: "ok" }); // gracia
    sql(`update public.waiter_calls set attended_at = now() - interval '11 minutes' where table_id = '${local.table}'`);
    expect(await dar({ token: local.token, video, visita: ticketDeHace(30 * MIN) })).toEqual({ status: "session_closed" });
    expect(await dar({ token: local.token, video, visita: ticketDeHace(2 * MIN) })).toMatchObject({ status: "ok" }); // reescaneó después
  });

  it("también cierra el quitar, y no depende de otra mesa", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    const device = nuevaClave();
    await dar({ token: local.token, video, device });
    await atenderCuentaHace(local, 11);
    expect(await dar({ token: local.token, video, device, liked: false, visita: ticketDeHace(30 * MIN) })).toEqual({ status: "session_closed" });
    expect(await dar({ token: local.token2, video, device, liked: false, visita: ticketDeHace(30 * MIN) })).toMatchObject({ status: "ok", liked: false });
  });

  it("sin ticket verosímil no hay nada que comparar", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    await atenderCuentaHace(local, 11);
    for (const visita of [null, new Date(Date.now() - 25 * 60 * MIN).toISOString(), new Date(Date.now() + 5 * MIN).toISOString()]) {
      expect(await dar({ token: local.token, video, visita })).toMatchObject({ status: "ok" });
    }
  });
});

describe("límite por cliente", () => {
  it("60 altas nuevas por conexión cada 10 minutos; la 61 se rechaza con el tiempo de espera y no se crea; otra conexión sigue", async () => {
    const local = await crearLocal();
    const rate = nuevaClave();
    const video = await sembrarVideo(local.id);
    for (let i = 0; i < 60; i += 10) {
      await Promise.all(Array.from({ length: 10 }, () => dar({ token: local.token, video, rate })));
    }
    expect(await filas(video)).toHaveLength(60);
    const r = await dar({ token: local.token, video, rate });
    expect(r.status).toBe("rate_limited");
    expect(r.retry_after_seconds).toBeGreaterThanOrEqual(1);
    expect(r.retry_after_seconds).toBeLessThanOrEqual(600);
    expect(await filas(video)).toHaveLength(60);
    expect(await dar({ token: local.token, video })).toMatchObject({ status: "ok", count: 61 });
  }, 60_000);

  it("con el cupo lleno, repetir o quitar un like ya puesto no depende del límite; pasados los 10 minutos vuelve a dejar", async () => {
    const local = await crearLocal();
    const rate = nuevaClave();
    const video = await sembrarVideo(local.id);
    const dispositivos = Array.from({ length: 60 }, () => nuevaClave());
    const insert = await service.from("video_likes").insert(dispositivos.map((d) => ({ video_id: video, organization_id: local.id, device_key: d, rate_key: rate })));
    expect(insert.error).toBeNull();
    expect(await dar({ token: local.token, video, rate })).toMatchObject({ status: "rate_limited" });
    expect(await dar({ token: local.token, video, rate, device: dispositivos[0] })).toMatchObject({ status: "ok", liked: true });
    expect(await dar({ token: local.token, video, rate, device: dispositivos[1], liked: false })).toMatchObject({ status: "ok", liked: false });
    sql(`update public.video_likes set created_at = now() - interval '11 minutes' where video_id = '${video}'`);
    expect(await dar({ token: local.token, video, rate })).toMatchObject({ status: "ok" });
  });

  it("el rate_key se borra pasada una hora (en el próximo alta); el device_key y el like quedan", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    const device = nuevaClave();
    await dar({ token: local.token, video, device, rate: nuevaClave() });
    sql(`update public.video_likes set created_at = now() - interval '61 minutes' where video_id = '${video}'`);
    await dar({ token: local.token2, video }); // otro like, de otra mesa: dispara la limpieza
    const vieja = (await service.from("video_likes").select("device_key, rate_key").eq("video_id", video).eq("device_key", device).single()).data;
    expect(vieja).toEqual({ device_key: device, rate_key: null });
    expect(await conteo(video)).toBe(2);
  });
});

describe("la API no tiene otro camino", () => {
  it("nadie lee ni escribe video_likes: ni anon, ni el Dueño de la organización", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    await dar({ token: local.token, video });
    for (const [nombre, db] of [["anon", anon], ["Dueño", local.owner.db]] as const) {
      expect((await db.from("video_likes").select("*")).error?.code, `${nombre} lee`).toBe(INSUFFICIENT_PRIVILEGE);
      expect((await db.from("video_likes").select("device_key")).error?.code, `${nombre} lee claves`).toBe(INSUFFICIENT_PRIVILEGE);
      const alta = await db.from("video_likes").insert({ video_id: video, organization_id: local.id, device_key: nuevaClave() });
      expect(alta.error?.code, `${nombre} inserta`).toBe(INSUFFICIENT_PRIVILEGE);
      expect((await db.from("video_likes").update({ rate_key: null }).eq("video_id", video)).error?.code, `${nombre} actualiza`).toBe(INSUFFICIENT_PRIVILEGE);
      expect((await db.from("video_likes").delete().eq("video_id", video)).error?.code, `${nombre} borra`).toBe(INSUFFICIENT_PRIVILEGE);
    }
    expect(await filas(video)).toHaveLength(1);
  });

  it("like_count: anon lo lee del video publicado pero no lo escribe; el Dueño tampoco", async () => {
    const local = await crearLocal();
    const video = await sembrarVideo(local.id);
    await dar({ token: local.token, video });
    const lectura = await anon.from("menu_videos").select("like_count").eq("id", video).single();
    expect(lectura.data).toEqual({ like_count: 1 });
    for (const [nombre, db] of [["anon", anon], ["Dueño", local.owner.db]] as const) {
      const r = await db.from("menu_videos").update({ like_count: 999 }).eq("id", video).select("id");
      expect(r.error?.code, nombre).toBe(INSUFFICIENT_PRIVILEGE);
    }
    expect(await conteo(video)).toBe(1);
    // Ni siquiera el servidor puede dejarlo en negativo.
    const negativo = await service.from("menu_videos").update({ like_count: -1 }).eq("id", video);
    expect(negativo.error).not.toBeNull();
  });

  it("el trigger no se puede llamar por la API", async () => {
    const r = await anon.rpc("sync_video_like_count" as never);
    expect(r.error).not.toBeNull();
  });
});

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asegurarDestinoLocal } from "./purge-price-history";
import {
  addMembership,
  anonClient,
  createCategory,
  createOrg,
  createUser,
  deleteOrg,
  deleteUser,
  DIA_MS,
  insertProducts,
  serviceClient,
  setSubscription,
  sql,
  type Db,
  type PlanCode,
  type TestUser,
} from "./helpers";

/**
 * Videos del feed (nivel C, ficha videos-del-panel-base, ADR 0031) contra el Supabase local: quién crea, publica y borra,
 * qué columnas escribe cada rol, el cupo del plan al publicar (con concurrencia), los estados y el aislamiento entre
 * organizaciones. Mux no interviene: lo que escribe el servidor (estado de procesamiento, identificadores, duración) se
 * siembra con `service_role`, que es exactamente quien lo hará en producción.
 */

const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const execFileAsync = promisify(execFile);
const contenedor = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_ucomenu";
const psql = (consulta: string) =>
  execFileAsync("docker", ["exec", contenedor, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-c", consulta], { encoding: "utf8" });
const INSUFFICIENT_PRIVILEGE = "42501";
const CHECK_VIOLATION = "23514";
const LIMIT_EXCEEDED = "53400";
const PROGRAM_LIMIT = "54000";

let service: Db;
let outsider: TestUser;
const users: TestUser[] = [];
const orgs: string[] = [];
let contador = 0;

type Local = { id: string; owner: TestUser; staff: TestUser };

/** Una organización propia con Dueño y Staff, al día (vence en 30 días). */
async function crearLocal(plan: PlanCode = "premium", finEnMs = 30 * DIA_MS): Promise<Local> {
  contador += 1;
  const id = await createOrg(service, `tt-video-${sufijo}-${contador}`, plan);
  orgs.push(id);
  await setSubscription(service, id, { finEnMs });
  const owner = await createUser(service, `video-d${contador}`);
  const staff = await createUser(service, `video-s${contador}`);
  users.push(owner, staff);
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  return { id, owner, staff };
}

type Siembra = { status?: "draft" | "published" | "deleting"; mux_status?: "awaiting_upload" | "processing" | "ready" | "errored"; title?: string };

/** Las filas que dejaría el servidor al terminar el procesamiento en Mux: listo, con asset, playback y duración. */
function filasDeServidor(orgId: string, cantidad: number, cambios: Siembra = {}) {
  return Array.from({ length: cantidad }, (_, i) => {
    const mux_status = cambios.mux_status ?? "ready";
    const listo = mux_status === "ready";
    const marca = `${sufijo}-${randomUUID().slice(0, 8)}-${i}`;
    return {
      organization_id: orgId,
      title: cambios.title ?? `tt-video-${i + 1}`,
      status: cambios.status ?? "draft",
      mux_status,
      mux_upload_id: `up-${marca}`,
      mux_asset_id: listo ? `as-${marca}` : null,
      mux_playback_id: listo ? `pb-${marca}` : null,
      duration_seconds: listo ? 12.5 : null,
    };
  });
}

async function sembrar(orgId: string, cantidad: number, cambios: Siembra = {}): Promise<string[]> {
  const { data, error } = await service.from("menu_videos").insert(filasDeServidor(orgId, cantidad, cambios)).select("id");
  if (error) throw new Error(`No se pudo sembrar: ${error.message}`);
  return data.map((v) => v.id);
}

const publicar = (user: TestUser, id: string) => user.db.from("menu_videos").update({ status: "published" }).eq("id", id).select("id");
const despublicar = (user: TestUser, id: string) => user.db.from("menu_videos").update({ status: "draft" }).eq("id", id).select("id");
const fila = async (id: string) => (await service.from("menu_videos").select("*").eq("id", id).single()).data!;
const publicados = async (orgId: string) =>
  (await service.from("menu_videos").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "published")).count;
const totalDe = async (orgId: string) =>
  (await service.from("menu_videos").select("id", { count: "exact", head: true }).eq("organization_id", orgId)).count;

async function entitlements(user: TestUser, orgId: string) {
  const { data, error } = await user.db.rpc("org_entitlements", { p_org: orgId });
  expect(error).toBeNull();
  return data as { usage: Record<string, number>; limits: Record<string, number | null> };
}

beforeAll(async () => {
  service = serviceClient();
  outsider = await createUser(service, "video-ajeno");
  users.push(outsider);
});

afterAll(async () => {
  for (const id of orgs) await deleteOrg(service, id);
  for (const u of users) await deleteUser(service, u);
});

describe("crear un video: quién puede", () => {
  it("el Dueño y el Staff de un Premium al día crean borradores; arrancan sin procesar y sin publicar", async () => {
    const local = await crearLocal("premium");
    for (const usuario of [local.owner, local.staff]) {
      const r = await usuario.db.from("menu_videos").insert({ organization_id: local.id, title: `de ${usuario.email}` }).select("id, status, mux_status, mux_playback_id");
      expect(r.error).toBeNull();
      expect(r.data).toEqual([expect.objectContaining({ status: "draft", mux_status: "awaiting_upload", mux_playback_id: null })]);
    }
    expect(await totalDe(local.id)).toBe(2);
  });

  it("en gracia también se crea; en solo lectura y suspendida no, y no deja fila", async () => {
    const gracia = await crearLocal("premium", -2 * DIA_MS);
    expect((await gracia.owner.db.from("menu_videos").insert({ organization_id: gracia.id, title: "x" })).error).toBeNull();
    for (const finEnMs of [-9 * DIA_MS, -30 * DIA_MS]) {
      const local = await crearLocal("premium", finEnMs);
      const r = await local.owner.db.from("menu_videos").insert({ organization_id: local.id, title: "x" });
      expect(r.error?.code, String(finEnMs)).toBe(INSUFFICIENT_PRIVILEGE);
      expect(await totalDe(local.id)).toBe(0);
    }
  });

  it("Básico y Pro no crean: el feed no está en su plan", async () => {
    for (const plan of ["basic", "pro"] as const) {
      const local = await crearLocal(plan);
      for (const usuario of [local.owner, local.staff]) {
        const r = await usuario.db.from("menu_videos").insert({ organization_id: local.id, title: "x" });
        expect(r.error?.code, plan).toBe(INSUFFICIENT_PRIVILEGE);
      }
      expect(await totalDe(local.id)).toBe(0);
    }
  });

  it("quien no es miembro, y anon, no crean ni leen", async () => {
    const local = await crearLocal("premium");
    const [id] = await sembrar(local.id, 1);
    expect((await outsider.db.from("menu_videos").insert({ organization_id: local.id, title: "x" })).error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect((await outsider.db.from("menu_videos").select("id").eq("organization_id", local.id)).data).toEqual([]);
    expect((await anonClient().from("menu_videos").insert({ organization_id: local.id, title: "x" })).error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    // Desde el feed público (ficha feed-de-videos) `anon` lee los videos PUBLICADOS y listos con columnas públicas; un borrador, no;
    // y nunca el estado (el detalle está en videos-publico.rls.test.ts).
    expect((await anonClient().from("menu_videos").select("id").eq("organization_id", local.id)).data).toEqual([]);
    expect((await anonClient().from("menu_videos").select("status")).error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await totalDe(local.id)).toBe(1);
    expect((await fila(id)).title).toBe("tt-video-1");
  });

  it("el título tiene de 1 a 80 caracteres sin contar espacios de los bordes", async () => {
    const local = await crearLocal("premium");
    for (const title of ["", "   ", "x".repeat(81)]) {
      const r = await local.owner.db.from("menu_videos").insert({ organization_id: local.id, title });
      expect(r.error?.code, JSON.stringify(title)).toBe(CHECK_VIOLATION);
    }
    expect((await local.owner.db.from("menu_videos").insert({ organization_id: local.id, title: "x".repeat(80) })).error).toBeNull();
  });
});

describe("columnas: lo de Mux lo escribe solo el servidor", () => {
  it("nadie con sesión inserta estado, campos de Mux ni duración", async () => {
    const local = await crearLocal("premium");
    const intentos: Array<Record<string, unknown>> = [
      { status: "published" },
      { mux_status: "ready" },
      { mux_playback_id: "pb-ajeno" },
      { mux_asset_id: "as-ajeno" },
      { mux_upload_id: "up-ajeno" },
      { duration_seconds: 10 },
      { id: randomUUID() },
    ];
    for (const extra of intentos) {
      const r = await local.owner.db.from("menu_videos").insert({ organization_id: local.id, title: "x", ...extra } as never);
      expect(r.error?.code, JSON.stringify(extra)).toBe(INSUFFICIENT_PRIVILEGE);
    }
    expect(await totalDe(local.id)).toBe(0);
  });

  it("nadie con sesión actualiza campos de Mux, duración ni la organización; sí título, plato, orden y estado", async () => {
    const local = await crearLocal("premium");
    const otro = await crearLocal("premium");
    const [id] = await sembrar(local.id, 1);
    for (const cambio of [{ mux_status: "errored" }, { mux_playback_id: "pb-otro" }, { mux_asset_id: "as-otro" }, { duration_seconds: 5 }, { organization_id: otro.id }]) {
      const r = await local.owner.db.from("menu_videos").update(cambio as never).eq("id", id).select("id");
      expect(r.error?.code, JSON.stringify(cambio)).toBe(INSUFFICIENT_PRIVILEGE);
    }
    const antes = await fila(id);
    expect(antes.mux_playback_id).toMatch(/^pb-/);
    expect(antes.organization_id).toBe(local.id);

    const bien = await local.staff.db.from("menu_videos").update({ title: "Nuevo nombre", sort_order: 7 }).eq("id", id).select("title, sort_order");
    expect(bien.data).toEqual([{ title: "Nuevo nombre", sort_order: 7 }]);
  });

  it("Dueño y Staff no leen los identificadores internos de Mux; el playback sí lo ven", async () => {
    const local = await crearLocal("premium");
    await sembrar(local.id, 1);
    for (const columna of ["mux_asset_id", "mux_upload_id", "*"]) {
      const r = await local.owner.db.from("menu_videos").select(columna).eq("organization_id", local.id);
      expect(r.error?.code, columna).toBe(INSUFFICIENT_PRIVILEGE);
    }
    const ok = await local.staff.db.from("menu_videos").select("id, title, status, mux_status, mux_playback_id, duration_seconds, product_id, sort_order").eq("organization_id", local.id);
    expect(ok.error).toBeNull();
    expect(ok.data?.[0]).toMatchObject({ mux_status: "ready", duration_seconds: 12.5 });
    expect(ok.data?.[0].mux_playback_id).toMatch(/^pb-/);
  });

  it("nadie borra por la API (Dueño, Staff, ajeno, anon); service_role sí", async () => {
    const local = await crearLocal("premium");
    const [id] = await sembrar(local.id, 1, { status: "deleting" });
    for (const db of [local.owner.db, local.staff.db, outsider.db, anonClient()]) {
      const r = await db.from("menu_videos").delete().eq("id", id).select("id");
      expect(r.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    }
    expect(await totalDe(local.id)).toBe(1);
    expect((await service.from("menu_videos").delete().eq("id", id)).error).toBeNull();
    expect(await totalDe(local.id)).toBe(0);
  });

  it("ni service_role mueve un video a otra organización", async () => {
    const local = await crearLocal("premium");
    const otro = await crearLocal("premium");
    const [id] = await sembrar(local.id, 1);
    const r = await service.from("menu_videos").update({ organization_id: otro.id }).eq("id", id);
    expect(r.error?.message).toContain("video_organization_immutable");
    expect((await fila(id)).organization_id).toBe(local.id);
  });
});

describe("las reglas de fondo valen también para el servidor (CHECK)", () => {
  it("«listo» exige asset, playback y duración; la duración llega a 30,5 s y no más", async () => {
    const local = await crearLocal("premium");
    const base = { organization_id: local.id, title: "x", mux_status: "ready" as const };
    const casos: Array<[string, Record<string, unknown>]> = [
      ["sin playback", { mux_asset_id: "a1", duration_seconds: 10 }],
      ["sin asset", { mux_playback_id: "p1", duration_seconds: 10 }],
      ["sin duración", { mux_asset_id: "a2", mux_playback_id: "p2" }],
      ["duración de más", { mux_asset_id: "a3", mux_playback_id: "p3", duration_seconds: 31 }],
      ["duración cero", { mux_asset_id: "a4", mux_playback_id: "p4", duration_seconds: 0 }],
    ];
    for (const [nombre, extra] of casos) {
      const r = await service.from("menu_videos").insert({ ...base, ...extra });
      expect(r.error?.code, nombre).toBe(CHECK_VIOLATION);
    }
    const justo = await service.from("menu_videos").insert({ ...base, mux_asset_id: `a-${sufijo}-ok`, mux_playback_id: `p-${sufijo}-ok`, duration_seconds: 30.5 });
    expect(justo.error).toBeNull();
  });

  it("publicado exige listo, también para el servidor", async () => {
    const local = await crearLocal("premium");
    const r = await service.from("menu_videos").insert({ organization_id: local.id, title: "x", status: "published", mux_status: "processing" });
    expect(r.error?.code).toBe(CHECK_VIOLATION);
    expect(await totalDe(local.id)).toBe(0);
  });

  it("un alta que nace publicada también respeta el cupo y el plan, aunque la haga el servidor", async () => {
    const premium = await crearLocal("premium");
    await sembrar(premium.id, 9, { status: "published" });
    expect((await service.from("menu_videos").insert(filasDeServidor(premium.id, 1, { status: "published" }))).error).toBeNull(); // el 10.º entra
    const once = await service.from("menu_videos").insert(filasDeServidor(premium.id, 1, { status: "published" }));
    expect(once.error?.code).toBe(LIMIT_EXCEEDED);
    expect(await publicados(premium.id)).toBe(10);

    const pro = await crearLocal("pro");
    const sinPlan = await service.from("menu_videos").insert(filasDeServidor(pro.id, 1, { status: "published" }));
    expect(sinPlan.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(sinPlan.error?.message).toContain("feature_unavailable:video_feed");
    expect(await totalDe(pro.id)).toBe(0);
  });

  it("un alta en bloque que se pasa del cupo se rechaza entera", async () => {
    const local = await crearLocal("premium");
    const r = await service.from("menu_videos").insert(filasDeServidor(local.id, 11, { status: "published" }));
    expect(r.error?.code).toBe(LIMIT_EXCEEDED);
    expect(await totalDe(local.id)).toBe(0);
  });

  it("los identificadores de Mux son únicos", async () => {
    const local = await crearLocal("premium");
    const [id] = await sembrar(local.id, 1);
    const { mux_playback_id } = await fila(id);
    const r = await service
      .from("menu_videos")
      .insert({ organization_id: local.id, title: "x", mux_status: "ready", mux_asset_id: `otro-${sufijo}`, mux_playback_id, duration_seconds: 5 });
    expect(r.error?.code).toBe("23505");
  });
});

describe("publicar: estado de procesamiento y cupo del plan", () => {
  it("un video sin procesar no se publica; uno listo, sí (Dueño y Staff)", async () => {
    const local = await crearLocal("premium");
    const crudo = await local.owner.db.from("menu_videos").insert({ organization_id: local.id, title: "x" }).select("id").single();
    expect((await publicar(local.owner, crudo.data!.id)).error?.code).toBe(CHECK_VIOLATION);
    const [a, b] = await sembrar(local.id, 2);
    expect((await publicar(local.owner, a)).data).toEqual([{ id: a }]);
    expect((await publicar(local.staff, b)).data).toEqual([{ id: b }]);
    expect(await publicados(local.id)).toBe(2);
  });

  it("con el cupo lleno el siguiente se rechaza (53400); despublicar uno libera el lugar", async () => {
    const local = await crearLocal("premium");
    const ids = await sembrar(local.id, 11);
    for (const id of ids.slice(0, 10)) expect((await publicar(local.owner, id)).error).toBeNull();
    const lleno = await publicar(local.owner, ids[10]);
    expect(lleno.error?.code).toBe(LIMIT_EXCEEDED);
    expect(lleno.error?.message).toContain("limit_exceeded:videos_published");
    expect((await fila(ids[10])).status).toBe("draft");

    expect((await despublicar(local.owner, ids[0])).error).toBeNull();
    expect((await publicar(local.owner, ids[10])).error).toBeNull();
    expect(await publicados(local.id)).toBe(10);
    const ent = await entitlements(local.owner, local.id);
    expect(ent.usage.videos_published).toBe(10);
    expect(ent.limits.videos_published).toBe(10);
  });

  it("editar un video ya publicado (título, orden) no consume cupo ni choca con el tope", async () => {
    const local = await crearLocal("premium");
    const ids = await sembrar(local.id, 10);
    for (const id of ids) expect((await publicar(local.owner, id)).error).toBeNull();
    const r = await local.owner.db.from("menu_videos").update({ title: "otro", sort_order: 3 }).eq("id", ids[0]).select("id");
    expect(r.error).toBeNull();
    // Volver a mandar «published» sobre uno publicado tampoco es una publicación nueva.
    expect((await publicar(local.owner, ids[1])).error).toBeNull();
  });

  it("publicaciones simultáneas sobre el último lugar: queda exactamente el cupo", async () => {
    const local = await crearLocal("premium");
    const ya = await sembrar(local.id, 9, { status: "published" });
    const candidatos = await sembrar(local.id, 5);
    expect(ya).toHaveLength(9);
    const resultados = await Promise.all(candidatos.map((id, i) => publicar(i % 2 ? local.staff : local.owner, id)));
    expect(resultados.filter((r) => r.error === null)).toHaveLength(1);
    for (const r of resultados.filter((r) => r.error !== null)) expect(r.error?.code).toBe(LIMIT_EXCEEDED);
    expect(await publicados(local.id)).toBe(10);
  });

  it("dos publicaciones en sesiones separadas sobre el último lugar: la segunda espera a la primera y recibe el tope", async () => {
    asegurarDestinoLocal(contenedor);
    const local = await crearLocal("premium");
    await sembrar(local.id, 9, { status: "published" });
    const [a, b] = await sembrar(local.id, 2);

    // Sesión A: publica, tarda y recién después confirma. Sin el candado, B vería 9 publicados y publicaría también (11).
    const marca = `publica-${sufijo}`;
    const primera = psql(
      `begin; select '${marca}'; update public.menu_videos set status = 'published' where id = '${a}'; select pg_sleep(3); commit;`,
    );
    let durmiendo = false;
    for (let intento = 0; intento < 50 && !durmiendo; intento++) {
      durmiendo = sql(`select count(*) from pg_stat_activity where pid <> pg_backend_pid() and wait_event = 'PgSleep' and query like '%${marca}%'`)[0][0] === "1";
      if (!durmiendo) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!durmiendo) throw new Error("la sesión que publica no llegó a dormir: la prueba no sería válida");

    const segunda = await psql(`update public.menu_videos set status = 'published' where id = '${b}'`).then(
      () => null,
      (e: { stderr?: string }) => String(e.stderr ?? e),
    );
    await primera;
    expect(segunda).toMatch(/limit_exceeded:videos_published/);
    expect(await publicados(local.id)).toBe(10);
    expect((await fila(b)).status).toBe("draft");
  }, 30_000);

  it("el cupo sale de la fila del plan: cambiarlo cambia el tope y null es sin límite", async () => {
    const local = await crearLocal("premium");
    const ids = await sembrar(local.id, 12);
    try {
      sql(`update public.plans set max_videos_published = 2 where code = 'premium'`);
      expect((await publicar(local.owner, ids[0])).error).toBeNull();
      expect((await publicar(local.owner, ids[1])).error).toBeNull();
      expect((await publicar(local.owner, ids[2])).error?.code).toBe(LIMIT_EXCEEDED);
      sql(`update public.plans set max_videos_published = null where code = 'premium'`);
      for (const id of ids.slice(2)) expect((await publicar(local.owner, id)).error).toBeNull();
      expect(await publicados(local.id)).toBe(12);
      expect((await entitlements(local.owner, local.id)).limits.videos_published).toBeNull();
    } finally {
      sql(`update public.plans set max_videos_published = 10 where code = 'premium'`);
    }
  });

  it("bajar de Premium no borra nada: los publicados quedan, no se publica otro y sí se despublica", async () => {
    const local = await crearLocal("premium");
    const [uno, dos, tres] = await sembrar(local.id, 3);
    for (const id of [uno, dos]) expect((await publicar(local.owner, id)).error).toBeNull();
    await setSubscription(service, local.id, { plan: "pro" });

    expect(await publicados(local.id)).toBe(2);
    const bloqueado = await publicar(local.owner, tres);
    expect(bloqueado.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(bloqueado.error?.message).toContain("feature_unavailable:video_feed");
    expect((await despublicar(local.owner, uno)).error).toBeNull();
    expect((await local.owner.db.from("menu_videos").update({ title: "renombrado" }).eq("id", dos).select("id")).error).toBeNull();
    const ent = await entitlements(local.owner, local.id);
    expect(ent.usage.videos_published).toBe(1);
    expect(ent.limits.videos_published).toBe(0);
  });

  it("en solo lectura se ve todo pero no se escribe; el cupo no se esquiva", async () => {
    const local = await crearLocal("premium");
    const [id, otro] = await sembrar(local.id, 2);
    expect((await publicar(local.owner, id)).error).toBeNull();
    await setSubscription(service, local.id, { finEnMs: -9 * DIA_MS });
    expect((await local.staff.db.from("menu_videos").select("id").eq("organization_id", local.id)).data).toHaveLength(2);
    for (const usuario of [local.owner, local.staff]) {
      expect((await despublicar(usuario, id)).data).toEqual([]);
      expect((await publicar(usuario, otro)).data).toEqual([]);
      expect((await usuario.db.from("menu_videos").update({ title: "x" }).eq("id", id).select("id")).data).toEqual([]);
    }
    expect((await fila(id)).status).toBe("published");
    expect((await fila(otro)).status).toBe("draft");
  });
});

describe("borrado en dos pasos: «deleting» es terminal", () => {
  it("pasar a «deleting» libera el cupo y deja el video fuera de los publicados", async () => {
    const local = await crearLocal("premium");
    const ids = await sembrar(local.id, 11);
    for (const id of ids.slice(0, 10)) expect((await publicar(local.owner, id)).error).toBeNull();
    const borrando = await local.owner.db.from("menu_videos").update({ status: "deleting" }).eq("id", ids[0]).select("id");
    expect(borrando.error).toBeNull();
    expect(await publicados(local.id)).toBe(9);
    expect((await entitlements(local.owner, local.id)).usage.videos_published).toBe(9);
    expect((await publicar(local.owner, ids[10])).error).toBeNull();
  });

  it("no vuelve a borrador ni se publica, ni siquiera con service_role", async () => {
    const local = await crearLocal("premium");
    const [id] = await sembrar(local.id, 1);
    expect((await local.owner.db.from("menu_videos").update({ status: "deleting" }).eq("id", id)).error).toBeNull();
    for (const db of [local.owner.db, service]) {
      for (const status of ["draft", "published"] as const) {
        const r = await db.from("menu_videos").update({ status }).eq("id", id);
        expect(r.error?.message, status).toContain("video_deleting_is_final");
      }
    }
    expect((await fila(id)).status).toBe("deleting");
    // Renombrar uno que se está borrando no lo resucita: el estado no cambia.
    expect((await local.owner.db.from("menu_videos").update({ title: "todavía acá" }).eq("id", id)).error).toBeNull();
    expect((await fila(id)).status).toBe("deleting");
  });
});

describe("tope técnico y aislamiento entre organizaciones", () => {
  it("50 videos por organización (con borradores y los que se borran); el 51.º da 54000 y un ajeno no se entera", async () => {
    const local = await crearLocal("premium");
    sql(`insert into public.menu_videos (organization_id, title) select '${local.id}', 'tt-' || g from generate_series(1, 50) g`);
    expect(await totalDe(local.id)).toBe(50);
    const r = await local.owner.db.from("menu_videos").insert({ organization_id: local.id, title: "uno más" });
    expect(r.error?.code).toBe(PROGRAM_LIMIT);
    // Quien no es miembro recibe el rechazo de RLS, no el tope (no se filtra cuánto tiene otra organización).
    const ajeno = await outsider.db.from("menu_videos").insert({ organization_id: local.id, title: "uno más" });
    expect(ajeno.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await totalDe(local.id)).toBe(50);
  });

  it("nadie ve, publica ni edita los videos de otra organización, y no se entera del cupo ni del plan", async () => {
    const a = await crearLocal("premium");
    const b = await crearLocal("premium");
    const [video] = await sembrar(a.id, 1);
    expect((await b.owner.db.from("menu_videos").select("id").eq("id", video)).data).toEqual([]);
    expect((await publicar(b.owner, video)).data).toEqual([]);
    expect((await publicar(b.owner, video)).error).toBeNull(); // sin filas: ni error ni detalle del cupo de A
    expect((await b.owner.db.from("menu_videos").update({ title: "robado" }).eq("id", video).select("id")).data).toEqual([]);
    expect((await fila(video)).status).toBe("draft");
    expect((await fila(video)).title).toBe("tt-video-1");
  });

  it("el plato enlazado tiene que ser de la misma organización; borrarlo deja el video sin enlace", async () => {
    const a = await crearLocal("premium");
    const b = await crearLocal("premium");
    const categoriaA = await createCategory(service, a.id);
    const categoriaB = await createCategory(service, b.id);
    await insertProducts(service, a.id, categoriaA, 1);
    await insertProducts(service, b.id, categoriaB, 1);
    const platoA = (await service.from("products").select("id").eq("organization_id", a.id).single()).data!.id;
    const platoB = (await service.from("products").select("id").eq("organization_id", b.id).single()).data!.id;

    const ajeno = await a.owner.db.from("menu_videos").insert({ organization_id: a.id, title: "x", product_id: platoB });
    expect(ajeno.error?.code).toBe("23503");

    const propio = await a.owner.db.from("menu_videos").insert({ organization_id: a.id, title: "con plato", product_id: platoA }).select("id").single();
    expect(propio.error).toBeNull();
    const mover = await a.owner.db.from("menu_videos").update({ product_id: platoB }).eq("id", propio.data!.id);
    expect(mover.error?.code).toBe("23503");

    expect((await service.from("products").delete().eq("id", platoA)).error).toBeNull();
    const despues = await fila(propio.data!.id);
    expect(despues.product_id).toBeNull();
    expect(despues.organization_id).toBe(a.id);
    expect(despues.title).toBe("con plato");
  });

  it("borrar la organización se lleva sus filas (los assets de Mux se limpian antes: parte B)", async () => {
    const local = await crearLocal("premium");
    await sembrar(local.id, 2);
    await deleteOrg(service, local.id);
    expect(await totalDe(local.id)).toBe(0);
  });
});

describe("entitlements", () => {
  it("informan los videos publicados y el cupo; el Staff recibe lo mismo", async () => {
    const local = await crearLocal("premium");
    const ids = await sembrar(local.id, 3);
    await publicar(local.owner, ids[0]);
    await publicar(local.owner, ids[1]);
    for (const usuario of [local.owner, local.staff]) {
      const ent = await entitlements(usuario, local.id);
      expect(ent.usage.videos_published).toBe(2);
      expect(ent.limits.videos_published).toBe(10);
    }
    const basico = await crearLocal("basic");
    const entBasico = await entitlements(basico.owner, basico.id);
    expect(entBasico.usage.videos_published).toBe(0);
    expect(entBasico.limits.videos_published).toBe(0);
  });
});

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { finalizeVideoDeletion } from "@/lib/videos/borrado";
import { handleMuxEvent, type MuxEvent } from "@/lib/videos/eventos";
import { startVideoUpload } from "@/lib/videos/subida";
import { requestVideoDeletion } from "@/lib/videos/videos";
import { fakeMux } from "./mux-fake";
import { addMembership, createCategory, createOrg, createUser, deleteOrg, deleteUser, DIA_MS, insertProducts, serviceClient, setSubscription, sql, type Db, type PlanCode, type TestUser } from "./helpers";

/**
 * Parte B de los videos (ficha videos-mux-parte-b, nivel C) contra el Supabase local: lo que hace cada evento del webhook de Mux
 * sobre la base (con la clave de servicio, igual que la ruta), el borrado de huérfanos, el comienzo de una subida y la
 * cancelación al borrar. Mux es un doble que anota las llamadas; la API real se probó aparte.
 */

const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const CHECK_VIOLATION = "23514";
const INSUFFICIENT_PRIVILEGE = "42501";

let service: Db;
const users: TestUser[] = [];
const orgs: string[] = [];
let contador = 0;

type Local = { id: string; owner: TestUser; staff: TestUser };

async function crearLocal(plan: PlanCode = "premium", finEnMs = 30 * DIA_MS): Promise<Local> {
  contador += 1;
  const id = await createOrg(service, `tt-vmux-${sufijo}-${contador}`, plan);
  orgs.push(id);
  await setSubscription(service, id, { finEnMs });
  const owner = await createUser(service, `vmux-d${contador}`);
  const staff = await createUser(service, `vmux-s${contador}`);
  users.push(owner, staff);
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  return { id, owner, staff };
}

/** Un video recién creado por la acción de subida: borrador sin procesar, con su subida abierta en Mux. */
async function nuevoVideo(orgId: string, cambios: { status?: "draft" | "deleting" } = {}): Promise<{ id: string; uploadId: string }> {
  const uploadId = `up-${sufijo}-${randomUUID().slice(0, 8)}`;
  const { data, error } = await service
    .from("menu_videos")
    .insert({ organization_id: orgId, title: "tt-video", status: cambios.status ?? "draft", mux_upload_id: uploadId })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id, uploadId };
}

const fila = async (id: string) => (await service.from("menu_videos").select("*").eq("id", id).maybeSingle()).data;
const totalDe = async (orgId: string) => (await service.from("menu_videos").select("id", { count: "exact", head: true }).eq("organization_id", orgId)).count;

const creado = (uploadId: string, assetId: string, videoId: string | null): MuxEvent => ({
  type: "video.upload.asset_created",
  data: { id: uploadId, asset_id: assetId, new_asset_settings: videoId ? { passthrough: videoId } : {} },
});
const listo = (assetId: string, uploadId: string | null, videoId: string | null, extra: Record<string, unknown> = {}): MuxEvent => ({
  type: "video.asset.ready",
  data: {
    id: assetId,
    upload_id: uploadId ?? undefined,
    passthrough: videoId ?? undefined,
    status: "ready",
    duration: 12.34,
    aspect_ratio: "9:16",
    playback_ids: [{ id: `pb-${assetId}`, policy: "public" }],
    ...extra,
  },
});
const conError = (assetId: string, uploadId: string, videoId: string): MuxEvent => ({
  type: "video.asset.errored",
  data: { id: assetId, upload_id: uploadId, passthrough: videoId, status: "errored" },
});

/**
 * Envuelve un cliente para provocar una carrera: justo ANTES de que corra la primera escritura (`update`) sobre `menu_videos`,
 * ejecuta `antes()` (por ejemplo, otra sesión que borra el video). Así se prueba, de forma determinista, lo que pasa cuando el
 * video cambia entre que el manejador lo lee y que escribe.
 */
function conCarrera(db: Db, antes: () => PromiseLike<unknown>): Db {
  let hecho = false;
  const interceptar = (builder: object): object =>
    new Proxy(builder, {
      get(objetivo, propiedad) {
        if (propiedad === "then") {
          // `antes()` corre una sola vez y después se ejecuta la consulta real UNA vez (devolver el constructor desde una
          // función `async` lo ejecutaría dos veces).
          return (alCumplir: (v: unknown) => unknown, alFallar: (e: unknown) => unknown) =>
            (async () => {
              if (!hecho) {
                hecho = true;
                await antes();
              }
            })().then(() => (objetivo as PromiseLike<unknown>).then(alCumplir, alFallar), alFallar);
        }
        const valor = Reflect.get(objetivo, propiedad) as unknown;
        if (typeof valor !== "function") return valor;
        return (...args: unknown[]) => {
          const resultado = (valor as (...a: unknown[]) => unknown).apply(objetivo, args);
          return typeof resultado === "object" && resultado !== null && "then" in resultado ? interceptar(resultado) : resultado;
        };
      },
    });
  return new Proxy(db, {
    get(objetivo, propiedad) {
      if (propiedad !== "from") return Reflect.get(objetivo, propiedad) as unknown;
      return (tabla: string) => {
        const real = objetivo.from(tabla as never) as unknown as Record<string, (...a: unknown[]) => unknown>;
        if (tabla !== "menu_videos") return real;
        return new Proxy(real, {
          get(t, p) {
            const valor = t[p as string];
            if (p !== "update" || typeof valor !== "function") return typeof valor === "function" ? valor.bind(t) : valor;
            return (...args: unknown[]) => interceptar(valor.apply(t, args) as object);
          },
        });
      };
    },
  }) as Db;
}

beforeAll(() => {
  service = serviceClient();
});

afterAll(async () => {
  for (const id of orgs) await deleteOrg(service, id);
  for (const u of users) await deleteUser(service, u);
});

describe("el recorrido de un video: eventos de Mux sobre la base", () => {
  it("subida creada y luego listo: queda procesando y después listo, con asset, playback y duración", async () => {
    const local = await crearLocal();
    const v = await nuevoVideo(local.id);
    const { mux, deletedAssets } = fakeMux();

    expect(await handleMuxEvent(service, mux, creado(v.uploadId, "as-1", v.id))).toBe("applied");
    expect(await fila(v.id)).toMatchObject({ mux_status: "processing", mux_asset_id: "as-1", mux_playback_id: null });

    expect(await handleMuxEvent(service, mux, listo("as-1", v.uploadId, v.id))).toBe("applied");
    expect(await fila(v.id)).toMatchObject({
      mux_status: "ready",
      mux_asset_id: "as-1",
      mux_playback_id: "pb-as-1",
      duration_seconds: 12.34,
      mux_error: null,
      status: "draft",
      organization_id: local.id,
      title: "tt-video",
    });
    expect(deletedAssets).toEqual([]);
  });

  it("el orden no importa: «listo» antes que «subida creada», y esta tarde no lo retrocede", async () => {
    const local = await crearLocal();
    const v = await nuevoVideo(local.id);
    const { mux } = fakeMux();
    expect(await handleMuxEvent(service, mux, listo("as-2", v.uploadId, v.id))).toBe("applied");
    expect(await handleMuxEvent(service, mux, creado(v.uploadId, "as-2", v.id))).toBe("ignored");
    expect(await fila(v.id)).toMatchObject({ mux_status: "ready", mux_playback_id: "pb-as-2" });
  });

  it("los avisos repetidos dejan el mismo resultado", async () => {
    const local = await crearLocal();
    const v = await nuevoVideo(local.id);
    const { mux, deletedAssets } = fakeMux();
    await handleMuxEvent(service, mux, creado(v.uploadId, "as-3", v.id));
    await handleMuxEvent(service, mux, creado(v.uploadId, "as-3", v.id));
    await handleMuxEvent(service, mux, listo("as-3", v.uploadId, v.id));
    const despues = await fila(v.id);
    expect(await handleMuxEvent(service, mux, listo("as-3", v.uploadId, v.id))).toBe("ignored");
    expect(await handleMuxEvent(service, mux, creado(v.uploadId, "as-3", v.id))).toBe("ignored");
    expect(await fila(v.id)).toEqual(despues);
    expect(deletedAssets).toEqual([]);
  });

  it("un video ya publicado no cambia de estado de publicación ni de título por un aviso tardío", async () => {
    const local = await crearLocal();
    const v = await nuevoVideo(local.id);
    const { mux } = fakeMux();
    await handleMuxEvent(service, mux, listo("as-4", v.uploadId, v.id));
    await service.from("menu_videos").update({ status: "published", title: "Mi título" }).eq("id", v.id);
    await handleMuxEvent(service, mux, listo("as-4", v.uploadId, v.id));
    await handleMuxEvent(service, mux, conError("as-4", v.uploadId, v.id));
    expect(await fila(v.id)).toMatchObject({ status: "published", title: "Mi título", mux_status: "ready", mux_error: null });
  });
});

describe("lo que no cumple la regla no llega a «listo»", () => {
  it("más de 30,5 s: queda con error «too_long» y el asset se borra en Mux", async () => {
    const local = await crearLocal();
    const v = await nuevoVideo(local.id);
    const { mux, deletedAssets } = fakeMux();
    expect(await handleMuxEvent(service, mux, listo("as-largo", v.uploadId, v.id, { duration: 31 }))).toBe("applied");
    expect(await fila(v.id)).toMatchObject({ mux_status: "errored", mux_error: "too_long", mux_playback_id: null, duration_seconds: null, mux_asset_id: "as-largo" });
    expect(deletedAssets).toEqual(["as-largo"]);
  });

  it("30,5 s justos sí; 30,51 s no", async () => {
    const local = await crearLocal();
    const justo = await nuevoVideo(local.id);
    const pasado = await nuevoVideo(local.id);
    const { mux, deletedAssets } = fakeMux();
    await handleMuxEvent(service, mux, listo("as-justo", justo.uploadId, justo.id, { duration: 30.5 }));
    await handleMuxEvent(service, mux, listo("as-pasado", pasado.uploadId, pasado.id, { duration: 30.51 }));
    expect(await fila(justo.id)).toMatchObject({ mux_status: "ready", duration_seconds: 30.5 });
    expect(await fila(pasado.id)).toMatchObject({ mux_status: "errored", mux_error: "too_long" });
    expect(deletedAssets).toEqual(["as-pasado"]);
  });

  it("sin duración o con duración inválida: «processing_failed»; sin playback público: «no_playback»", async () => {
    const local = await crearLocal();
    const { mux, deletedAssets } = fakeMux();
    const casos: Array<[string, Record<string, unknown>, string]> = [
      ["sin duración", { duration: undefined }, "processing_failed"],
      ["duración cero", { duration: 0 }, "processing_failed"],
      ["duración negativa", { duration: -3 }, "processing_failed"],
      ["duración de texto", { duration: "12" }, "processing_failed"],
      ["solo playback firmado", { playback_ids: [{ id: "pb-firmado", policy: "signed" }] }, "no_playback"],
      ["sin playbacks", { playback_ids: [] }, "no_playback"],
    ];
    for (const [nombre, extra, error] of casos) {
      const v = await nuevoVideo(local.id);
      const asset = `as-${nombre.replaceAll(" ", "-")}`;
      await handleMuxEvent(service, mux, listo(asset, v.uploadId, v.id, extra));
      expect(await fila(v.id), nombre).toMatchObject({ mux_status: "errored", mux_error: error, mux_playback_id: null });
      expect(deletedAssets, nombre).toContain(asset);
    }
  });

  it("un error de procesamiento y un error de subida dejan su motivo; el de subida solo si todavía esperaba el archivo", async () => {
    const local = await crearLocal();
    const { mux, deletedAssets } = fakeMux();
    const a = await nuevoVideo(local.id);
    expect(await handleMuxEvent(service, mux, conError("as-e", a.uploadId, a.id))).toBe("applied");
    expect(await fila(a.id)).toMatchObject({ mux_status: "errored", mux_error: "processing_failed" });

    const b = await nuevoVideo(local.id);
    expect(await handleMuxEvent(service, mux, { type: "video.upload.errored", data: { id: b.uploadId } })).toBe("applied");
    expect(await fila(b.id)).toMatchObject({ mux_status: "errored", mux_error: "upload_failed" });

    const c = await nuevoVideo(local.id);
    await handleMuxEvent(service, mux, creado(c.uploadId, "as-c", c.id));
    expect(await handleMuxEvent(service, mux, { type: "video.upload.errored", data: { id: c.uploadId } })).toBe("ignored");
    expect((await fila(c.id))?.mux_status).toBe("processing");
    expect(deletedAssets).toEqual([]);
  });

  it("un error no pisa un video ya listo", async () => {
    const local = await crearLocal();
    const v = await nuevoVideo(local.id);
    const { mux } = fakeMux();
    await handleMuxEvent(service, mux, listo("as-ok", v.uploadId, v.id));
    expect(await handleMuxEvent(service, mux, conError("as-ok", v.uploadId, v.id))).toBe("ignored");
    expect((await fila(v.id))?.mux_status).toBe("ready");
  });

  it("la base no admite un motivo de error sin estado de error, ni uno inventado", async () => {
    const local = await crearLocal();
    const v = await nuevoVideo(local.id);
    expect((await service.from("menu_videos").update({ mux_error: "too_long" }).eq("id", v.id)).error?.code).toBe(CHECK_VIOLATION);
    expect((await service.from("menu_videos").update({ mux_status: "errored", mux_error: "inventado" }).eq("id", v.id)).error?.code).toBe(CHECK_VIOLATION);
    expect((await service.from("menu_videos").update({ mux_status: "errored", mux_error: "too_long" }).eq("id", v.id)).error).toBeNull();
  });
});

describe("quién puede escribir el motivo del error", () => {
  it("Dueño y Staff lo leen; nadie con sesión lo escribe", async () => {
    const local = await crearLocal();
    const v = await nuevoVideo(local.id);
    await service.from("menu_videos").update({ mux_status: "errored", mux_error: "too_long" }).eq("id", v.id);
    for (const usuario of [local.owner, local.staff]) {
      const leido = await usuario.db.from("menu_videos").select("id, mux_error").eq("id", v.id).single();
      expect(leido.data).toEqual({ id: v.id, mux_error: "too_long" });
      const r = await usuario.db.from("menu_videos").update({ mux_error: null }).eq("id", v.id).select("id");
      expect(r.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    }
    expect((await fila(v.id))?.mux_error).toBe("too_long");
  });
});

describe("huérfanos y avisos que no son nuestros", () => {
  it("un video borrado mientras subía: el asset que llega se borra en Mux, con cada tipo de aviso", async () => {
    const { mux, deletedAssets } = fakeMux();
    const fantasma = randomUUID();
    expect(await handleMuxEvent(service, mux, creado("up-x", "as-o1", fantasma))).toBe("orphan_removed");
    expect(await handleMuxEvent(service, mux, listo("as-o2", "up-x", fantasma))).toBe("orphan_removed");
    expect(await handleMuxEvent(service, mux, conError("as-o3", "up-x", fantasma))).toBe("orphan_removed");
    expect(deletedAssets).toEqual(["as-o1", "as-o2", "as-o3"]);
  });

  it("un asset sin passthrough nuestro (subido a mano) no se toca, y ningún aviso desconocido hace nada", async () => {
    const { mux, deletedAssets, cancelledUploads } = fakeMux();
    for (const passthrough of [null, "no-es-un-uuid", "", "1234"]) {
      expect(await handleMuxEvent(service, mux, listo("as-ajeno", null, passthrough))).toBe("ignored");
      expect(await handleMuxEvent(service, mux, creado("up-ajena", "as-ajeno", passthrough))).toBe("ignored");
    }
    for (const type of ["video.asset.deleted", "video.upload.cancelled", "video.asset.updated", "video.live_stream.active", "otra.cosa"]) {
      expect(await handleMuxEvent(service, mux, { type, data: { id: "x", passthrough: randomUUID() } })).toBe("ignored");
    }
    for (const data of [{}, { id: 3 }, { id: "x", passthrough: 5 }, { asset_id: "a" }]) {
      expect(await handleMuxEvent(service, mux, { type: "video.upload.asset_created", data })).toBe("ignored");
      expect(await handleMuxEvent(service, mux, { type: "video.asset.ready", data })).toBe("ignored");
    }
    expect(deletedAssets).toEqual([]);
    expect(cancelledUploads).toEqual([]);
  });

  it("un aviso con el passthrough de un video pero la subida de otro no cambia nada ni borra nada", async () => {
    const local = await crearLocal();
    const v = await nuevoVideo(local.id);
    const { mux, deletedAssets } = fakeMux();
    const antes = await fila(v.id);
    expect(await handleMuxEvent(service, mux, listo("as-falso", "up-de-otro", v.id))).toBe("ignored");
    expect(await handleMuxEvent(service, mux, listo("as-falso", null, v.id))).toBe("ignored");
    expect(await handleMuxEvent(service, mux, creado("up-de-otro", "as-falso", v.id))).toBe("ignored");
    expect(await handleMuxEvent(service, mux, conError("as-falso", "up-de-otro", v.id))).toBe("ignored");
    expect(await fila(v.id)).toEqual(antes);
    expect(deletedAssets).toEqual([]);
  });

  it("un aviso con la subida de otro no marca ni borra nada aunque diga que el video es demasiado largo o falló", async () => {
    const local = await crearLocal();
    const v = await nuevoVideo(local.id);
    const { mux, deletedAssets } = fakeMux();
    const antes = await fila(v.id);
    expect(await handleMuxEvent(service, mux, listo("as-falso-largo", "up-de-otro", v.id, { duration: 99 }))).toBe("ignored");
    expect(await handleMuxEvent(service, mux, listo("as-falso-sin-playback", "up-de-otro", v.id, { playback_ids: [] }))).toBe("ignored");
    expect(await handleMuxEvent(service, mux, conError("as-falso-error", "up-de-otro", v.id))).toBe("ignored");
    expect(await fila(v.id)).toEqual(antes);
    expect(deletedAssets).toEqual([]);
  });

  it("un aviso nunca toca el video de otra organización", async () => {
    const a = await crearLocal();
    const b = await crearLocal();
    const deA = await nuevoVideo(a.id);
    const deB = await nuevoVideo(b.id);
    const { mux } = fakeMux();
    await handleMuxEvent(service, mux, listo("as-a", deA.uploadId, deA.id));
    expect(await fila(deB.id)).toMatchObject({ mux_status: "awaiting_upload", mux_asset_id: null, organization_id: b.id });
    expect(await fila(deA.id)).toMatchObject({ mux_status: "ready", organization_id: a.id });
  });

  it("sin Mux configurado, un huérfano falla (el aviso se reintenta) y no se pierde", async () => {
    await expect(handleMuxEvent(service, null, listo("as-sin-mux", "up-x", randomUUID()))).rejects.toThrow(/Mux no está configurado/);
  });

  it("si Mux falla al borrar un huérfano, falla (reintento); al repetir, se borra", async () => {
    const fake = fakeMux();
    fake.fail("delete");
    const fantasma = randomUUID();
    await expect(handleMuxEvent(service, fake.mux, listo("as-reintento", "up-x", fantasma))).rejects.toThrow();
    expect(await handleMuxEvent(service, fake.mux, listo("as-reintento", "up-x", fantasma))).toBe("orphan_removed");
    expect(fake.deletedAssets).toEqual(["as-reintento"]);
  });
});

describe("un video que se está borrando", () => {
  it("el asset que llega se borra en Mux y la fila también", async () => {
    const local = await crearLocal();
    const v = await nuevoVideo(local.id, { status: "deleting" });
    const { mux, deletedAssets } = fakeMux();
    expect(await handleMuxEvent(service, mux, listo("as-del", v.uploadId, v.id))).toBe("removed_deleting");
    expect(deletedAssets).toEqual(["as-del"]);
    expect(await fila(v.id)).toBeNull();
  });

  it("aunque el asset sea demasiado largo o no tenga playback, el video que se borraba se termina de borrar", async () => {
    const local = await crearLocal();
    const a = await nuevoVideo(local.id, { status: "deleting" });
    const b = await nuevoVideo(local.id, { status: "deleting" });
    const { mux, deletedAssets } = fakeMux();
    expect(await handleMuxEvent(service, mux, listo("as-del-largo", a.uploadId, a.id, { duration: 99 }))).toBe("removed_deleting");
    expect(await handleMuxEvent(service, mux, listo("as-del-sin-pb", b.uploadId, b.id, { playback_ids: [] }))).toBe("removed_deleting");
    expect(deletedAssets).toEqual(["as-del-largo", "as-del-sin-pb"]);
    expect(await totalDe(local.id)).toBe(0);
  });

  it("con «subida creada» pasa lo mismo, y con un error también", async () => {
    const local = await crearLocal();
    const a = await nuevoVideo(local.id, { status: "deleting" });
    const b = await nuevoVideo(local.id, { status: "deleting" });
    const { mux, deletedAssets } = fakeMux();
    expect(await handleMuxEvent(service, mux, creado(a.uploadId, "as-da", a.id))).toBe("removed_deleting");
    expect(await handleMuxEvent(service, mux, conError("as-db", b.uploadId, b.id))).toBe("removed_deleting");
    expect(deletedAssets).toEqual(["as-da", "as-db"]);
    expect(await totalDe(local.id)).toBe(0);
  });

  it("si Mux falla queda en «deleting» con el asset anotado, y el reintento del aviso termina el trabajo", async () => {
    const local = await crearLocal();
    const v = await nuevoVideo(local.id, { status: "deleting" });
    const fake = fakeMux();
    fake.fail("delete");
    await expect(handleMuxEvent(service, fake.mux, listo("as-ret", v.uploadId, v.id))).rejects.toThrow();
    expect(await fila(v.id)).toMatchObject({ status: "deleting", mux_asset_id: "as-ret" });
    expect(await handleMuxEvent(service, fake.mux, listo("as-ret", v.uploadId, v.id))).toBe("removed_deleting");
    expect(await fila(v.id)).toBeNull();
  });
});

describe("carreras: el video se borra entre la lectura y la escritura", () => {
  const borrarFila = (id: string) => () => service.from("menu_videos").delete().eq("id", id);
  const pasarADeleting = (id: string) => () => service.from("menu_videos").update({ status: "deleting" }).eq("id", id);

  it("con «subida creada», «listo» o «error»: si la fila desaparece a mitad, el asset sobrante se borra en Mux", async () => {
    const casos: Array<[string, (v: { id: string; uploadId: string }) => MuxEvent, string]> = [
      ["subida creada", (v) => creado(v.uploadId, "as-c-borrado", v.id), "as-c-borrado"],
      ["listo", (v) => listo("as-l-borrado", v.uploadId, v.id), "as-l-borrado"],
      ["listo demasiado largo", (v) => listo("as-ll-borrado", v.uploadId, v.id, { duration: 99 }), "as-ll-borrado"],
      ["error", (v) => conError("as-e-borrado", v.uploadId, v.id), "as-e-borrado"],
    ];
    for (const [nombre, evento, asset] of casos) {
      const local = await crearLocal();
      const v = await nuevoVideo(local.id);
      const { mux, deletedAssets } = fakeMux();
      const resultado = await handleMuxEvent(conCarrera(service, borrarFila(v.id)), mux, evento(v));
      expect(resultado, nombre).toBe("orphan_removed");
      expect(deletedAssets, nombre).toContain(asset);
      expect(await fila(v.id), nombre).toBeNull();
    }
  });

  it("si en lugar de borrarse pasa a «deleting» entre la lectura y la escritura, el borrado se termina", async () => {
    const casos: Array<[string, (v: { id: string; uploadId: string }) => MuxEvent, string]> = [
      ["subida creada", (v) => creado(v.uploadId, "as-c-del", v.id), "as-c-del"],
      ["listo", (v) => listo("as-l-del", v.uploadId, v.id), "as-l-del"],
      ["error", (v) => conError("as-e-del", v.uploadId, v.id), "as-e-del"],
    ];
    for (const [nombre, evento, asset] of casos) {
      const local = await crearLocal();
      const v = await nuevoVideo(local.id);
      const { mux, deletedAssets } = fakeMux();
      expect(await handleMuxEvent(conCarrera(service, pasarADeleting(v.id)), mux, evento(v)), nombre).toBe("removed_deleting");
      expect(deletedAssets, nombre).toEqual([asset]);
      expect(await fila(v.id), nombre).toBeNull();
    }
  });

  it("sin la carrera, el mismo evento se aplica normalmente (el envoltorio no cambia nada)", async () => {
    const local = await crearLocal();
    const v = await nuevoVideo(local.id);
    const { mux, deletedAssets } = fakeMux();
    expect(await handleMuxEvent(conCarrera(service, async () => undefined), mux, listo("as-sin-carrera", v.uploadId, v.id))).toBe("applied");
    expect(await fila(v.id)).toMatchObject({ mux_status: "ready", mux_asset_id: "as-sin-carrera" });
    expect(deletedAssets).toEqual([]);
  });

  it("si Mux falla al limpiar el sobrante tras la carrera, falla (reintento) y al repetir se borra", async () => {
    const local = await crearLocal();
    const v = await nuevoVideo(local.id);
    const fake = fakeMux();
    fake.fail("delete");
    await expect(handleMuxEvent(conCarrera(service, borrarFila(v.id)), fake.mux, listo("as-reintento-carrera", v.uploadId, v.id))).rejects.toThrow();
    // El reintento de Mux encuentra la fila ya borrada: huérfano.
    expect(await handleMuxEvent(service, fake.mux, listo("as-reintento-carrera", v.uploadId, v.id))).toBe("orphan_removed");
    expect(fake.deletedAssets).toEqual(["as-reintento-carrera"]);
  });
});

describe("empezar una subida", () => {
  const CORS = "https://ucomenu-staging.fly.dev";

  it("crea el borrador, pide la subida con el id del video y guarda el id de la subida", async () => {
    const local = await crearLocal();
    for (const usuario of [local.owner, local.staff]) {
      const fake = fakeMux();
      const r = await startVideoUpload(usuario.db, service, fake.mux, local.id, { title: "  Terraza  ", productId: null, corsOrigin: CORS });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(fake.createdUploads).toEqual([{ corsOrigin: CORS, passthrough: r.data.videoId, uploadId: expect.any(String) }]);
      expect(r.data.uploadUrl).toBe(`https://upload.example.test/${fake.createdUploads[0].uploadId}`);
      expect(await fila(r.data.videoId)).toMatchObject({
        title: "Terraza",
        status: "draft",
        mux_status: "awaiting_upload",
        mux_upload_id: fake.createdUploads[0].uploadId,
        organization_id: local.id,
      });
    }
  });

  it("sin Mux configurado no crea nada", async () => {
    const local = await crearLocal();
    expect(await startVideoUpload(local.owner.db, service, null, local.id, { title: "x", productId: null, corsOrigin: CORS })).toEqual({ ok: false, error: "mux_not_configured" });
    expect(await totalDe(local.id)).toBe(0);
  });

  it("si Mux no responde se borra el borrador y se avisa", async () => {
    const local = await crearLocal();
    const fake = fakeMux();
    fake.fail("create");
    expect(await startVideoUpload(local.owner.db, service, fake.mux, local.id, { title: "x", productId: null, corsOrigin: CORS })).toEqual({ ok: false, error: "mux_unavailable" });
    expect(await totalDe(local.id)).toBe(0);
  });

  it("lo que la base o el módulo rechazan no llega a Mux: plan sin feed, solo lectura, nombre inválido, plato ajeno, origen vacío", async () => {
    const pro = await crearLocal("pro");
    const lectura = await crearLocal("premium", -9 * DIA_MS);
    const a = await crearLocal();
    const b = await crearLocal();
    const categoria = await createCategory(service, b.id);
    await insertProducts(service, b.id, categoria, 1);
    const platoAjeno = (await service.from("products").select("id").eq("organization_id", b.id).single()).data!.id;
    const fake = fakeMux();
    const entrada = { title: "ok", productId: null, corsOrigin: CORS };

    expect(await startVideoUpload(pro.owner.db, service, fake.mux, pro.id, entrada)).toEqual({ ok: false, error: "feature" });
    expect(await startVideoUpload(lectura.owner.db, service, fake.mux, lectura.id, entrada)).toEqual({ ok: false, error: "blocked_read_only" });
    expect(await startVideoUpload(a.owner.db, service, fake.mux, a.id, { ...entrada, title: "   " })).toEqual({ ok: false, error: "title_blank" });
    expect(await startVideoUpload(a.owner.db, service, fake.mux, a.id, { ...entrada, title: "x".repeat(81) })).toEqual({ ok: false, error: "title_too_long" });
    expect(await startVideoUpload(a.owner.db, service, fake.mux, a.id, { ...entrada, productId: platoAjeno })).toEqual({ ok: false, error: "product_invalid" });
    expect(await startVideoUpload(a.owner.db, service, fake.mux, a.id, { ...entrada, corsOrigin: null })).toEqual({ ok: false, error: "unexpected" });
    expect(fake.createdUploads).toEqual([]);
    for (const l of [pro, lectura, a]) expect(await totalDe(l.id)).toBe(0);
  });

  it("con el tope de 50 videos no se pide nada a Mux", async () => {
    const local = await crearLocal();
    sql(`insert into public.menu_videos (organization_id, title) select '${local.id}', 'tt-' || g from generate_series(1, 50) g`);
    const fake = fakeMux();
    expect(await startVideoUpload(local.owner.db, service, fake.mux, local.id, { title: "uno más", productId: null, corsOrigin: CORS })).toEqual({ ok: false, error: "cap" });
    expect(fake.createdUploads).toEqual([]);
  });

  it("quien no es del local no puede empezar una subida en él", async () => {
    const a = await crearLocal();
    const b = await crearLocal();
    const fake = fakeMux();
    const r = await startVideoUpload(b.owner.db, service, fake.mux, a.id, { title: "x", productId: null, corsOrigin: CORS });
    expect(r.ok).toBe(false);
    expect(fake.createdUploads).toEqual([]);
    expect(await totalDe(a.id)).toBe(0);
  });
});

describe("borrar un video que todavía está subiendo", () => {
  it("cancela la subida en Mux y borra el borrador", async () => {
    const local = await crearLocal();
    const v = await nuevoVideo(local.id);
    const { mux, cancelledUploads, deletedAssets } = fakeMux();
    await requestVideoDeletion(local.owner.db, local.id, v.id);
    expect(await finalizeVideoDeletion(service, mux, local.id, v.id)).toBe("deleted");
    expect(cancelledUploads).toEqual([v.uploadId]);
    expect(deletedAssets).toEqual([]);
    expect(await fila(v.id)).toBeNull();
  });

  it("si cancelar falla se borra igual (un asset tardío se limpia como huérfano); con asset se borra el asset y no se cancela", async () => {
    const local = await crearLocal();
    const sinAsset = await nuevoVideo(local.id);
    const conAsset = await nuevoVideo(local.id);
    await service.from("menu_videos").update({ mux_asset_id: "as-con" }).eq("id", conAsset.id);
    const fake = fakeMux();
    fake.fail("cancel");
    await requestVideoDeletion(local.owner.db, local.id, sinAsset.id);
    await requestVideoDeletion(local.owner.db, local.id, conAsset.id);
    expect(await finalizeVideoDeletion(service, fake.mux, local.id, sinAsset.id)).toBe("deleted");
    expect(await finalizeVideoDeletion(service, fake.mux, local.id, conAsset.id)).toBe("deleted");
    expect(fake.cancelledUploads).toEqual([]);
    expect(fake.deletedAssets).toEqual(["as-con"]);
    expect(await totalDe(local.id)).toBe(0);

    // El aviso tardío del asset de la subida que no se pudo cancelar encuentra la fila borrada: huérfano.
    expect(await handleMuxEvent(service, fake.mux, listo("as-tardio", sinAsset.uploadId, sinAsset.id))).toBe("orphan_removed");
    expect(fake.deletedAssets).toEqual(["as-con", "as-tardio"]);
  });
});

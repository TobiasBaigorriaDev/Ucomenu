import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { finalizeVideoDeletion } from "@/lib/videos/borrado";
import { loadProductOptions, loadVideos, requestVideoDeletion, setVideoPublished, updateVideo } from "@/lib/videos/videos";
import { fakeMux } from "./mux-fake";
import { addMembership, createCategory, createOrg, createUser, deleteOrg, deleteUser, DIA_MS, insertProducts, serviceClient, setSubscription, type Db, type PlanCode, type TestUser } from "./helpers";

/**
 * Módulo de videos del panel (ficha videos-del-panel-base) contra el Supabase local, con los mismos clientes que usa el
 * servidor: el de la persona (RLS) para editar y publicar, y el de servicio para el segundo paso del borrado. Mux es un
 * doble: la parte B conecta el real. Las reglas de fondo (cupo, columnas, aislamiento) se prueban en `videos.rls.test.ts`.
 */

const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

let service: Db;
const users: TestUser[] = [];
const orgs: string[] = [];
let contador = 0;

type Local = { id: string; owner: TestUser; staff: TestUser };

async function crearLocal(plan: PlanCode = "premium", finEnMs = 30 * DIA_MS): Promise<Local> {
  contador += 1;
  const id = await createOrg(service, `tt-videomod-${sufijo}-${contador}`, plan);
  orgs.push(id);
  await setSubscription(service, id, { finEnMs });
  const owner = await createUser(service, `vmod-d${contador}`);
  const staff = await createUser(service, `vmod-s${contador}`);
  users.push(owner, staff);
  await addMembership(service, owner, id, "owner");
  await addMembership(service, staff, id, "staff");
  return { id, owner, staff };
}

async function sembrar(orgId: string, cambios: { status?: "draft" | "published" | "deleting"; conAsset?: boolean; title?: string } = {}): Promise<string> {
  const marca = `${sufijo}-${randomUUID().slice(0, 8)}`;
  const conAsset = cambios.conAsset ?? true;
  const { data, error } = await service
    .from("menu_videos")
    .insert({
      organization_id: orgId,
      title: cambios.title ?? "tt-video",
      status: cambios.status ?? "draft",
      mux_status: conAsset ? "ready" : "awaiting_upload",
      mux_upload_id: `up-${marca}`,
      mux_asset_id: conAsset ? `as-${marca}` : null,
      mux_playback_id: conAsset ? `pb-${marca}` : null,
      duration_seconds: conAsset ? 12 : null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

const fila = async (id: string) => (await service.from("menu_videos").select("*").eq("id", id).maybeSingle()).data;

/** Un Mux de mentira que anota los borrados y puede fallar (`falla` hace fallar todos los borrados). */
function muxDeMentira(falla = false) {
  const fake = fakeMux();
  if (falla) fake.fail("delete", true);
  return { mux: fake.mux, borrados: fake.deletedAssets };
}

beforeAll(() => {
  service = serviceClient();
});

afterAll(async () => {
  for (const id of orgs) await deleteOrg(service, id);
  for (const u of users) await deleteUser(service, u);
});

describe("lectura", () => {
  it("loadVideos trae solo las columnas permitidas, en orden, y nada de otra organización", async () => {
    const a = await crearLocal();
    const b = await crearLocal();
    const primero = await sembrar(a.id, { title: "primero" });
    const segundo = await sembrar(a.id, { title: "segundo" });
    await sembrar(b.id, { title: "ajeno" });
    await service.from("menu_videos").update({ sort_order: 5 }).eq("id", primero);

    const videos = await loadVideos(a.owner.db, a.id);
    expect(videos.map((v) => v.id)).toEqual([segundo, primero]);
    expect(Object.keys(videos[0]).sort()).toEqual(
      ["created_at", "duration_seconds", "id", "mux_error", "mux_playback_id", "mux_status", "product_id", "sort_order", "status", "title"].sort(),
    );
    expect(await loadVideos(b.staff.db, a.id)).toEqual([]);
  });

  it("loadProductOptions lista los platos del local por nombre", async () => {
    const a = await crearLocal();
    const categoria = await createCategory(service, a.id);
    await insertProducts(service, a.id, categoria, 3, true, "plato");
    const platos = await loadProductOptions(a.staff.db, a.id);
    expect(platos.map((p) => p.name)).toEqual(["plato-1", "plato-2", "plato-3"]);
  });
});

describe("renombrar y enlazar un plato", () => {
  it("guarda el nombre recortado y el plato; sin plato lo desenlaza", async () => {
    const a = await crearLocal();
    const categoria = await createCategory(service, a.id);
    await insertProducts(service, a.id, categoria, 1);
    const plato = (await service.from("products").select("id").eq("organization_id", a.id).single()).data!.id;
    const id = await sembrar(a.id);

    expect(await updateVideo(a.owner.db, a.id, id, { title: "  Nuevo  ", productId: plato })).toEqual({ ok: true, data: undefined });
    expect(await fila(id)).toMatchObject({ title: "Nuevo", product_id: plato });
    expect((await updateVideo(a.staff.db, a.id, id, { title: "Nuevo", productId: null })).ok).toBe(true);
    expect((await fila(id))?.product_id).toBeNull();
  });

  it("rechaza el nombre inválido sin tocar la base, el plato de otro local y un video que no existe", async () => {
    const a = await crearLocal();
    const b = await crearLocal();
    const categoriaB = await createCategory(service, b.id);
    await insertProducts(service, b.id, categoriaB, 1);
    const platoB = (await service.from("products").select("id").eq("organization_id", b.id).single()).data!.id;
    const id = await sembrar(a.id, { title: "intacto" });

    expect(await updateVideo(a.owner.db, a.id, id, { title: "   ", productId: null })).toEqual({ ok: false, error: "title_blank" });
    expect(await updateVideo(a.owner.db, a.id, id, { title: "x".repeat(81), productId: null })).toEqual({ ok: false, error: "title_too_long" });
    expect(await updateVideo(a.owner.db, a.id, id, { title: "ok", productId: platoB })).toEqual({ ok: false, error: "product_invalid" });
    expect(await updateVideo(a.owner.db, a.id, randomUUID(), { title: "ok", productId: null })).toEqual({ ok: false, error: "not_found" });
    // El video de otro local no se toca aunque se conozca su id: para este módulo «no existe».
    expect(await updateVideo(b.owner.db, b.id, id, { title: "robado", productId: null })).toEqual({ ok: false, error: "not_found" });
    expect((await fila(id))?.title).toBe("intacto");
  });

  it("en solo lectura o suspendida no guarda y lo dice", async () => {
    for (const [finEnMs, error] of [[-9 * DIA_MS, "blocked_read_only"], [-30 * DIA_MS, "blocked_suspended"]] as const) {
      const a = await crearLocal("premium", finEnMs);
      const id = await sembrar(a.id, { title: "intacto" });
      expect(await updateVideo(a.owner.db, a.id, id, { title: "cambio", productId: null })).toEqual({ ok: false, error });
      expect(await setVideoPublished(a.owner.db, a.id, id, true)).toEqual({ ok: false, error });
      expect(await requestVideoDeletion(a.owner.db, a.id, id)).toEqual({ ok: false, error });
      expect(await fila(id)).toMatchObject({ title: "intacto", status: "draft" });
    }
  });
});

describe("publicar y despublicar", () => {
  it("publica uno listo y lo despublica; uno sin procesar no se publica", async () => {
    const a = await crearLocal();
    const listo = await sembrar(a.id);
    const crudo = await sembrar(a.id, { conAsset: false });
    expect((await setVideoPublished(a.owner.db, a.id, listo, true)).ok).toBe(true);
    expect((await fila(listo))?.status).toBe("published");
    expect(await setVideoPublished(a.owner.db, a.id, crudo, true)).toEqual({ ok: false, error: "not_ready" });
    expect((await setVideoPublished(a.staff.db, a.id, listo, false)).ok).toBe(true);
    expect((await fila(listo))?.status).toBe("draft");
  });

  it("con el cupo lleno da «limit»; sin el feed en el plan da «feature»; ninguno cambia nada", async () => {
    const a = await crearLocal();
    const ids = [];
    for (let i = 0; i < 11; i++) ids.push(await sembrar(a.id));
    for (const id of ids.slice(0, 10)) expect((await setVideoPublished(a.owner.db, a.id, id, true)).ok).toBe(true);
    expect(await setVideoPublished(a.owner.db, a.id, ids[10], true)).toEqual({ ok: false, error: "limit" });

    await setSubscription(service, a.id, { plan: "basic" });
    await setVideoPublished(a.owner.db, a.id, ids[0], false);
    expect(await setVideoPublished(a.owner.db, a.id, ids[0], true)).toEqual({ ok: false, error: "feature" });
    expect((await fila(ids[10]))?.status).toBe("draft");
  });
});

describe("borrado en dos pasos", () => {
  it("el primer paso deja el video en «deleting» (repetirlo es seguro) y ya no se puede publicar ni renombrar", async () => {
    const a = await crearLocal();
    const id = await sembrar(a.id);
    expect((await setVideoPublished(a.owner.db, a.id, id, true)).ok).toBe(true);
    expect((await requestVideoDeletion(a.owner.db, a.id, id)).ok).toBe(true);
    expect((await requestVideoDeletion(a.owner.db, a.id, id)).ok).toBe(true);
    expect((await fila(id))?.status).toBe("deleting");
    expect(await setVideoPublished(a.owner.db, a.id, id, true)).toEqual({ ok: false, error: "deleting_final" });
    expect(await setVideoPublished(a.owner.db, a.id, id, false)).toEqual({ ok: false, error: "deleting_final" });
    expect(await requestVideoDeletion(a.owner.db, a.id, randomUUID())).toEqual({ ok: false, error: "not_found" });
  });

  it("segundo paso: borra el asset en Mux y después la fila", async () => {
    const a = await crearLocal();
    const id = await sembrar(a.id);
    const asset = (await service.from("menu_videos").select("mux_asset_id").eq("id", id).single()).data!.mux_asset_id!;
    await requestVideoDeletion(a.owner.db, a.id, id);
    const { mux, borrados } = muxDeMentira();
    expect(await finalizeVideoDeletion(service, mux, a.id, id)).toBe("deleted");
    expect(borrados).toEqual([asset]);
    expect(await fila(id)).toBeNull();
  });

  it("si Mux falla la fila queda en «deleting» y el reintento la termina; sin Mux configurado también espera", async () => {
    const a = await crearLocal();
    const id = await sembrar(a.id);
    await requestVideoDeletion(a.owner.db, a.id, id);

    expect(await finalizeVideoDeletion(service, muxDeMentira(true).mux, a.id, id)).toBe("pending_mux");
    expect(await finalizeVideoDeletion(service, null, a.id, id)).toBe("pending_mux");
    expect((await fila(id))?.status).toBe("deleting");

    const bueno = muxDeMentira();
    expect(await finalizeVideoDeletion(service, bueno.mux, a.id, id)).toBe("deleted");
    expect(bueno.borrados).toHaveLength(1);
    expect(await fila(id)).toBeNull();
  });

  it("un video que nunca llegó a Mux (sin asset) se borra sin llamar a Mux, aunque no esté configurado", async () => {
    const a = await crearLocal();
    const id = await sembrar(a.id, { conAsset: false });
    await requestVideoDeletion(a.owner.db, a.id, id);
    expect(await finalizeVideoDeletion(service, null, a.id, id)).toBe("deleted");
    expect(await fila(id)).toBeNull();
  });

  it("no toca lo que no está en «deleting», ni lo de otra organización, ni lo que no existe", async () => {
    const a = await crearLocal();
    const b = await crearLocal();
    const borrador = await sembrar(a.id);
    const publicado = await sembrar(a.id, { status: "published" });
    const deAjeno = await sembrar(b.id, { status: "deleting" });
    const { mux, borrados } = muxDeMentira();

    expect(await finalizeVideoDeletion(service, mux, a.id, borrador)).toBe("not_deleting");
    expect(await finalizeVideoDeletion(service, mux, a.id, publicado)).toBe("not_deleting");
    expect(await finalizeVideoDeletion(service, mux, a.id, deAjeno)).toBe("not_found"); // el id es de b, no de a
    expect(await finalizeVideoDeletion(service, mux, a.id, randomUUID())).toBe("not_found");
    expect(borrados).toEqual([]);
    for (const id of [borrador, publicado, deAjeno]) expect(await fila(id)).not.toBeNull();
  });

  it("la persona no puede completar el segundo paso por su cuenta (no tiene DELETE)", async () => {
    const a = await crearLocal();
    const id = await sembrar(a.id);
    await requestVideoDeletion(a.owner.db, a.id, id);
    const r = await finalizeVideoDeletion(a.owner.db, null, a.id, id);
    expect(r).toBe("unexpected"); // con el cliente de la persona ni siquiera lee mux_asset_id
    expect((await fila(id))?.status).toBe("deleting");
  });
});

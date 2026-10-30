import { randomUUID } from "node:crypto";
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
 * Lectura PÚBLICA de los videos del feed (nivel C, ficha feed-de-videos, ADR 0031) contra el Supabase local. El foco: qué ve
 * un anónimo (solo lo publicado y listo, de organizaciones con el feed vigente), qué columnas, cómo lo ocultan el plan, la mora,
 * la suspensión y la baja en el acto, y que nada cruza entre organizaciones ni se puede escribir.
 */

const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const INSUFFICIENT_PRIVILEGE = "42501";
const PUBLICAS = "id, organization_id, product_id, title, mux_playback_id, duration_seconds, sort_order, created_at";

let service: Db;
let anon: Db;
const users: TestUser[] = [];
const orgs: string[] = [];
let contador = 0;

type Local = { id: string; owner: TestUser };

async function crearLocal(plan: PlanCode = "premium", finEnMs = 30 * DIA_MS): Promise<Local> {
  contador += 1;
  const id = await createOrg(service, `tt-vpub-${sufijo}-${contador}`, plan);
  orgs.push(id);
  await setSubscription(service, id, { finEnMs });
  const owner = await createUser(service, `vpub-d${contador}`);
  users.push(owner);
  await addMembership(service, owner, id, "owner");
  return { id, owner };
}

type Siembra = { title?: string; status?: "draft" | "published" | "deleting"; mux_status?: "awaiting_upload" | "processing" | "ready" | "errored"; sort_order?: number };

async function sembrar(orgId: string, cambios: Siembra = {}): Promise<{ id: string; playback: string | null }> {
  const mux_status = cambios.mux_status ?? "ready";
  const listo = mux_status === "ready";
  const marca = `${sufijo}-${randomUUID().slice(0, 8)}`;
  const { data, error } = await service
    .from("menu_videos")
    .insert({
      organization_id: orgId,
      title: cambios.title ?? "tt-video",
      status: cambios.status ?? "published",
      mux_status,
      mux_upload_id: `up-${marca}`,
      mux_asset_id: listo ? `as-${marca}` : null,
      mux_playback_id: listo ? `pb-${marca}` : null,
      duration_seconds: listo ? 12.5 : null,
      sort_order: cambios.sort_order ?? 0,
    })
    .select("id, mux_playback_id")
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id, playback: data.mux_playback_id };
}

const publicos = async (orgId: string) =>
  (await anon.from("menu_videos").select(PUBLICAS).eq("organization_id", orgId).order("sort_order").order("created_at")).data ?? [];

beforeAll(() => {
  service = serviceClient();
  anon = anonClient();
});

afterAll(async () => {
  for (const id of orgs) await deleteOrg(service, id);
  for (const u of users) await deleteUser(service, u);
});

describe("qué ve un anónimo", () => {
  it("lo publicado y listo de una organización Premium, con las columnas públicas y en orden", async () => {
    const local = await crearLocal();
    const segundo = await sembrar(local.id, { title: "segundo", sort_order: 2 });
    const primero = await sembrar(local.id, { title: "primero", sort_order: 1 });
    const r = await anon.from("menu_videos").select(PUBLICAS).eq("organization_id", local.id).order("sort_order").order("created_at");
    expect(r.error).toBeNull();
    expect(r.data?.map((v) => v.title)).toEqual(["primero", "segundo"]);
    expect(r.data?.[0]).toMatchObject({ id: primero.id, organization_id: local.id, mux_playback_id: primero.playback, duration_seconds: 12.5, product_id: null });
    expect(r.data?.[1].id).toBe(segundo.id);
  });

  it("nunca borradores, videos que se borran, sin procesar ni con error", async () => {
    const local = await crearLocal();
    await sembrar(local.id, { title: "borrador", status: "draft" });
    await sembrar(local.id, { title: "borrándose", status: "deleting" });
    await sembrar(local.id, { title: "subiendo", status: "draft", mux_status: "awaiting_upload" });
    await sembrar(local.id, { title: "procesando", status: "draft", mux_status: "processing" });
    await sembrar(local.id, { title: "con error", status: "draft", mux_status: "errored" });
    const visible = await sembrar(local.id, { title: "visible" });
    expect((await publicos(local.id)).map((v) => v.title)).toEqual(["visible"]);
    expect((await anon.from("menu_videos").select("id", { count: "exact", head: true })).count).toBeGreaterThanOrEqual(1);
    expect(visible.playback).toBeTruthy();
  });

  it("anon no lee el estado, el estado de Mux, el error ni los identificadores internos (ni con `select *`)", async () => {
    const local = await crearLocal();
    await sembrar(local.id);
    for (const columna of ["status", "mux_status", "mux_error", "mux_asset_id", "mux_upload_id", "*"]) {
      const r = await anon.from("menu_videos").select(columna).eq("organization_id", local.id);
      expect(r.error?.code, columna).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });

  it("nada cruza entre organizaciones: pedir la de otra no trae lo de esta", async () => {
    const a = await crearLocal();
    const b = await crearLocal();
    await sembrar(a.id, { title: "de A" });
    await sembrar(b.id, { title: "de B" });
    expect((await publicos(a.id)).map((v) => v.title)).toEqual(["de A"]);
    expect((await publicos(b.id)).map((v) => v.title)).toEqual(["de B"]);
    const mezcla = await anon.from("menu_videos").select("title").in("organization_id", [a.id, b.id]).order("title");
    expect(mezcla.data?.map((v) => v.title)).toEqual(["de A", "de B"]);
    expect((await anon.from("menu_videos").select("title").eq("organization_id", randomUUID())).data).toEqual([]);
  });
});

describe("plan, mora, suspensión y baja: se ocultan en el acto", () => {
  it("Básico no muestra nada aunque tenga videos publicados; Pro y Premium sí", async () => {
    const local = await crearLocal("premium");
    await sembrar(local.id, { title: "de cuando era Premium" });
    expect(await publicos(local.id)).toHaveLength(1);
    for (const plan of ["basic"] as const) {
      await setSubscription(service, local.id, { plan });
      expect(await publicos(local.id), plan).toEqual([]);
    }
    await setSubscription(service, local.id, { plan: "pro" }); // desde el ADR 0049 el feed también está en Pro
    expect(await publicos(local.id)).toHaveLength(1);
    await setSubscription(service, local.id, { plan: "premium" });
    expect(await publicos(local.id)).toHaveLength(1);
  });

  it("en gracia y en solo lectura se siguen viendo; suspendida por mora, no", async () => {
    for (const [nombre, finEnMs, esperado] of [
      ["al día", 5 * DIA_MS, 1],
      ["en gracia", -2 * DIA_MS, 1],
      ["en solo lectura", -9 * DIA_MS, 1],
      ["suspendida por mora", -30 * DIA_MS, 0],
    ] as const) {
      // Se siembra con la cuenta al día (el trigger de cupo no deja publicar en una suspendida) y después cambia el estado.
      const local = await crearLocal("premium");
      await sembrar(local.id);
      await setSubscription(service, local.id, { finEnMs });
      expect((await publicos(local.id)).length, nombre).toBe(esperado);
    }
  });

  it("la suspensión manual y la baja de la organización los ocultan, y reactivar los devuelve", async () => {
    const manual = await crearLocal();
    await sembrar(manual.id);
    sql(`update public.subscriptions set suspended_at = now() where organization_id = '${manual.id}'`);
    expect(await publicos(manual.id)).toEqual([]);
    sql(`update public.subscriptions set suspended_at = null where organization_id = '${manual.id}'`);
    expect(await publicos(manual.id)).toHaveLength(1);

    const baja = await crearLocal();
    await sembrar(baja.id);
    sql(`update public.organizations set is_active = false where id = '${baja.id}'`);
    expect(await publicos(baja.id)).toEqual([]);
    sql(`update public.organizations set is_active = true where id = '${baja.id}'`);
    expect(await publicos(baja.id)).toHaveLength(1);
  });

  it("despublicar o borrar lo oculta de inmediato", async () => {
    const local = await crearLocal();
    const v = await sembrar(local.id);
    expect(await publicos(local.id)).toHaveLength(1);
    expect((await local.owner.db.from("menu_videos").update({ status: "draft" }).eq("id", v.id)).error).toBeNull();
    expect(await publicos(local.id)).toEqual([]);
    expect((await local.owner.db.from("menu_videos").update({ status: "published" }).eq("id", v.id)).error).toBeNull();
    expect(await publicos(local.id)).toHaveLength(1);
    expect((await local.owner.db.from("menu_videos").update({ status: "deleting" }).eq("id", v.id)).error).toBeNull();
    expect(await publicos(local.id)).toEqual([]);
  });
});

describe("la lectura pública no abre ninguna escritura ni otra tabla", () => {
  it("anon no inserta, actualiza ni borra", async () => {
    const local = await crearLocal();
    const v = await sembrar(local.id, { title: "intocable" });
    const insertar = await anon.from("menu_videos").insert({ organization_id: local.id, title: "x" });
    expect(insertar.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    const actualizar = await anon.from("menu_videos").update({ title: "robado" }).eq("id", v.id).select("id");
    expect(actualizar.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    const borrar = await anon.from("menu_videos").delete().eq("id", v.id).select("id");
    expect(borrar.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    const fila = (await service.from("menu_videos").select("title, status").eq("id", v.id).single()).data;
    expect(fila).toEqual({ title: "intocable", status: "published" });
  });

  it("un usuario con sesión de otra organización ve lo publicado de esta pero no sus borradores; el de la propia, todo", async () => {
    const a = await crearLocal();
    const b = await crearLocal();
    await sembrar(a.id, { title: "publicado" });
    await sembrar(a.id, { title: "borrador", status: "draft" });
    const ajeno = (await b.owner.db.from("menu_videos").select("title").eq("organization_id", a.id).order("title")).data;
    expect(ajeno?.map((v) => v.title)).toEqual(["publicado"]);
    const propio = (await a.owner.db.from("menu_videos").select("title").eq("organization_id", a.id).order("title")).data;
    expect(propio?.map((v) => v.title)).toEqual(["borrador", "publicado"]);
  });

  it("el envoltorio no se puede llamar por la API (private no está expuesto)", async () => {
    const r = await anon.rpc("video_feed_visible" as never, { org_id: randomUUID() } as never);
    expect(r.error).not.toBeNull();
  });
});

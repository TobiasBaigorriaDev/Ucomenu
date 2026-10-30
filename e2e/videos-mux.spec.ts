import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { signMuxPayload } from "../src/lib/videos/firma";
import { E2E_MUX, FAIL_PUT_BYTES, stubCalls } from "./mux-stub";
import { createTenant, expectNoHorizontalOverflow, login, service, type Estado } from "./support";

/**
 * Videos con Mux (nivel C, ficha videos-mux-parte-b), contra el servidor de pruebas, a 390 px. Mux es un servidor de mentira
 * local (`e2e/mux-stub.ts`): el navegador sube el archivo a él y los avisos del webhook se mandan firmados desde la prueba,
 * como los mandaría Mux. La API real de Mux se probó aparte (ver la ficha).
 */

const lista = (slug: string) => `/panel/${slug}/videos`;
const tarjeta = (page: Page, id: string) => page.locator(`[data-video="${id}"]`);
const formulario = (page: Page) => page.getByTestId("subir-video");
const MB = 1024 * 1024;

async function conPlan(orgId: string, plan: "basic" | "pro" | "premium") {
  const r = await service().from("subscriptions").update({ plan_code: plan }).eq("organization_id", orgId);
  if (r.error) throw new Error(r.error.message);
}

async function conLocal(
  etiqueta: string,
  plan: "basic" | "pro" | "premium",
  estado: Estado,
  prueba: (t: Awaited<ReturnType<typeof createTenant>>) => Promise<void>,
) {
  const t = await createTenant(etiqueta, estado);
  try {
    await conPlan(t.orgId, plan);
    await prueba(t);
  } finally {
    await t.cleanup();
  }
}

/** Un video con la subida ya pedida a Mux, como lo deja la acción de subida. */
async function sembrarSubida(orgId: string, title = "Subida pendiente"): Promise<{ id: string; uploadId: string }> {
  const uploadId = `up-e2e-${randomUUID().slice(0, 10)}`;
  const r = await service().from("menu_videos").insert({ organization_id: orgId, title, mux_upload_id: uploadId }).select("id").single();
  if (r.error) throw new Error(r.error.message);
  return { id: r.data.id, uploadId };
}

/** Manda un aviso firmado, como lo haría Mux. */
async function aviso(request: APIRequestContext, type: string, data: Record<string, unknown>, opciones: { firma?: string | null; cuerpo?: string; secreto?: string; t?: number } = {}) {
  const cuerpo = opciones.cuerpo ?? JSON.stringify({ type, id: randomUUID(), data });
  const t = opciones.t ?? Math.floor(Date.now() / 1000);
  const firma = opciones.firma === undefined ? signMuxPayload(cuerpo, opciones.secreto ?? E2E_MUX.webhookSecret, t) : opciones.firma;
  return request.post("/api/mux/webhook", {
    // Bytes tal cual: con un texto, Playwright puede volver a serializarlo y la firma ya no coincidiría con lo que llega.
    data: Buffer.from(cuerpo, "utf8"),
    headers: { "Content-Type": "application/json", ...(firma === null ? {} : { "Mux-Signature": firma }) },
  });
}

const creada = (video: { id: string; uploadId: string }, assetId: string) => ({ id: video.uploadId, asset_id: assetId, new_asset_settings: { passthrough: video.id } });
const lista_ = (video: { id: string; uploadId: string }, assetId: string, extra: Record<string, unknown> = {}) => ({
  id: assetId,
  upload_id: video.uploadId,
  passthrough: video.id,
  status: "ready",
  duration: 12.5,
  playback_ids: [{ id: `pb-${assetId}`, policy: "public" }],
  ...extra,
});

async function subir(page: Page, titulo: string, archivo: { name: string; mimeType: string; buffer: Buffer }) {
  const form = formulario(page);
  await form.getByLabel("Nombre del video").fill(titulo);
  await form.getByLabel("Archivo de video").setInputFiles(archivo);
  await form.getByRole("button", { name: "Subir video" }).click();
}

const clip = (bytes = 2048) => ({ name: "terraza.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(bytes, 7) });
const videoPorTitulo = async (orgId: string, title: string) =>
  (await service().from("menu_videos").select("id, status, mux_status, mux_upload_id, mux_asset_id").eq("organization_id", orgId).eq("title", title)).data ?? [];

test.describe("subir un video", () => {
  test("el archivo viaja a Mux, los avisos lo dejan listo y se puede publicar y borrar", async ({ page, request }) => {
    await conLocal("vmux-flujo", "premium", "active", async (t) => {
      await login(page, t.owner.email, t.owner.password, lista(t.slug));
      await subir(page, "Terraza al atardecer", clip(2048));
      await expect(page.getByTestId("subida-ok")).toBeVisible({ timeout: 25_000 });

      const [fila] = await videoPorTitulo(t.orgId, "Terraza al atardecer");
      expect(fila).toMatchObject({ status: "draft", mux_status: "awaiting_upload" });
      expect(fila.mux_upload_id).toBeTruthy();
      const llamadas = await stubCalls();
      const creacion = llamadas.find((c) => c.method === "POST" && c.id === fila.mux_upload_id)!;
      expect(creacion.body).toMatchObject({
        cors_origin: new URL(page.url()).origin,
        new_asset_settings: { passthrough: fila.id, playback_policies: ["public"], video_quality: "basic", max_resolution_tier: "1080p" },
      });
      expect(llamadas.find((c) => c.method === "PUT" && c.id === fila.mux_upload_id)?.bytes).toBe(2048);
      await expect(tarjeta(page, fila.id).getByTestId("video-procesamiento")).toHaveText("Esperando el archivo");

      // Mux avisa: subida creada y asset listo.
      const video = { id: fila.id, uploadId: fila.mux_upload_id! };
      expect((await aviso(request, "video.upload.asset_created", creada(video, "as-e2e-1"))).status()).toBe(200);
      expect((await aviso(request, "video.asset.ready", lista_(video, "as-e2e-1"))).status()).toBe(200);

      // La lista se actualiza sola mientras hay algo procesándose.
      await expect(tarjeta(page, fila.id).getByTestId("video-procesamiento")).toHaveText("Listo", { timeout: 20_000 });
      await expect(tarjeta(page, fila.id).getByTestId("video-miniatura")).toHaveAttribute("src", /image\.mux\.com\/pb-as-e2e-1\/thumbnail\.jpg/);

      await tarjeta(page, fila.id).getByRole("button", { name: /Publicar/ }).click();
      await expect(tarjeta(page, fila.id).getByTestId("video-estado")).toHaveText("Publicado");
      await expect(page.getByTestId("videos-cupo")).toContainText("1 de 10");

      await tarjeta(page, fila.id).getByRole("button", { name: /Despublicar/ }).click();
      await expect(tarjeta(page, fila.id).getByTestId("video-estado")).toHaveText("Borrador");
      await tarjeta(page, fila.id).locator("summary", { hasText: "Borrar video" }).click();
      await tarjeta(page, fila.id).getByRole("button", { name: "Sí, borrar el video definitivamente" }).click();
      await expect(tarjeta(page, fila.id)).toHaveCount(0);
      expect((await stubCalls()).filter((c) => c.method === "DELETE" && c.id === "as-e2e-1")).toHaveLength(1);
      expect(await videoPorTitulo(t.orgId, "Terraza al atardecer")).toEqual([]);
    });
  });

  test("el Staff también sube", async ({ page }) => {
    await conLocal("vmux-staff", "premium", "active", async (t) => {
      await login(page, t.staff.email, t.staff.password, lista(t.slug));
      await subir(page, "Del personal", clip());
      await expect(page.getByTestId("subida-ok")).toBeVisible({ timeout: 25_000 });
      expect(await videoPorTitulo(t.orgId, "Del personal")).toHaveLength(1);
    });
  });

  test("si la subida a Mux falla, se descarta el borrador y se cancela la subida", async ({ page }) => {
    await conLocal("vmux-falla", "premium", "active", async (t) => {
      await login(page, t.owner.email, t.owner.password, lista(t.slug));
      await subir(page, "Se corta la conexión", clip(FAIL_PUT_BYTES));
      await expect(page.getByTestId("subida-error")).toContainText("La subida falló y no se guardó nada", { timeout: 25_000 });
      expect(await videoPorTitulo(t.orgId, "Se corta la conexión")).toEqual([]);
      const llamadas = await stubCalls();
      const creada = llamadas.filter((c) => c.method === "POST" && (c.body as { new_asset_settings?: { passthrough?: string } })?.new_asset_settings?.passthrough);
      const subida = creada.find((c) => llamadas.some((l) => l.method === "PUT" && l.path === `/video/v1/uploads/${c.id}/cancel`));
      expect(subida, "se canceló la subida en Mux").toBeTruthy();
    });
  });

  test("el navegador frena lo que no sirve: no es un video, pesa más de 50 MB; no se crea nada ni se llama a Mux", async ({ page }, testInfo) => {
    await conLocal("vmux-archivo", "premium", "active", async (t) => {
      const antes = (await stubCalls()).filter((c) => c.method === "POST").length;
      await login(page, t.owner.email, t.owner.password, lista(t.slug));

      await subir(page, "Un texto", { name: "notas.txt", mimeType: "text/plain", buffer: Buffer.from("hola") });
      await expect(page.getByTestId("subida-error")).toContainText("no parece un video", { timeout: 15_000 });

      // Playwright no acepta buffers de más de 50 MB: el archivo va por su ruta.
      const pesado = testInfo.outputPath("pesado.mp4");
      writeFileSync(pesado, Buffer.alloc(51 * MB, 1));
      await formulario(page).getByLabel("Nombre del video").fill("Muy pesado");
      await formulario(page).getByLabel("Archivo de video").setInputFiles(pesado);
      await formulario(page).getByRole("button", { name: "Subir video" }).click();
      await expect(page.getByTestId("subida-error")).toContainText("pesa más de 50 MB", { timeout: 15_000 });

      await formulario(page).getByLabel("Nombre del video").fill("   ");
      await formulario(page).getByLabel("Archivo de video").setInputFiles(clip());
      await formulario(page).getByRole("button", { name: "Subir video" }).click();
      await expect(page.getByTestId("subida-error")).toBeVisible();

      expect(await videoPorTitulo(t.orgId, "Un texto")).toEqual([]);
      expect(await videoPorTitulo(t.orgId, "Muy pesado")).toEqual([]);
      expect((await stubCalls()).filter((c) => c.method === "POST").length).toBe(antes);
    });
  });
});

test.describe("lo que el servidor exige aunque el navegador lo permita", () => {
  test("un asset de más de 30 s queda con error y se borra en Mux", async ({ page, request }) => {
    await conLocal("vmux-largo", "premium", "active", async (t) => {
      const video = await sembrarSubida(t.orgId, "Muy largo");
      await login(page, t.owner.email, t.owner.password, lista(t.slug));
      await expect(tarjeta(page, video.id).getByTestId("video-procesamiento")).toHaveText("Esperando el archivo");

      expect((await aviso(request, "video.asset.ready", lista_(video, "as-e2e-largo", { duration: 44 }))).status()).toBe(200);
      await page.reload();
      await expect(tarjeta(page, video.id).getByTestId("video-procesamiento")).toHaveText("Con error");
      await expect(tarjeta(page, video.id).getByTestId("video-error")).toContainText("Dura más de 30 segundos");
      await expect(tarjeta(page, video.id).getByRole("button", { name: /Publicar/ })).toBeDisabled();
      expect((await stubCalls()).filter((c) => c.method === "DELETE" && c.id === "as-e2e-largo")).toHaveLength(1);
    });
  });

  test("borrar una subida que no se completó la cancela en Mux; una vencida se ve como tal", async ({ page }) => {
    await conLocal("vmux-cancelar", "premium", "active", async (t) => {
      const pendiente = await sembrarSubida(t.orgId, "Pendiente");
      const vencida = await sembrarSubida(t.orgId, "Vencida");
      await service().from("menu_videos").update({ created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() }).eq("id", vencida.id);
      await login(page, t.owner.email, t.owner.password, lista(t.slug));
      await expect(tarjeta(page, vencida.id).getByTestId("video-procesamiento")).toHaveText("Subida vencida");
      await expect(tarjeta(page, vencida.id).getByTestId("video-vencido")).toBeVisible();

      await tarjeta(page, pendiente.id).locator("summary", { hasText: "Borrar video" }).click();
      await tarjeta(page, pendiente.id).getByRole("button", { name: "Sí, borrar el video definitivamente" }).click();
      await expect(tarjeta(page, pendiente.id)).toHaveCount(0);
      expect((await stubCalls()).filter((c) => c.method === "PUT" && c.path === `/video/v1/uploads/${pendiente.uploadId}/cancel`)).toHaveLength(1);
    });
  });

  test("el aviso de un video borrado mientras subía borra el asset sobrante en Mux", async ({ request }) => {
    const fantasma = { id: randomUUID(), uploadId: "up-fantasma" };
    expect((await aviso(request, "video.asset.ready", lista_(fantasma, `as-e2e-huerfano-${fantasma.id.slice(0, 6)}`))).status()).toBe(200);
    expect((await stubCalls()).filter((c) => c.method === "DELETE" && c.id?.startsWith(`as-e2e-huerfano-${fantasma.id.slice(0, 6)}`))).toHaveLength(1);
  });
});

test.describe("el webhook: la firma es la única puerta", () => {
  test("sin firma, con otro secreto, vieja, alterada o mal formada no cambia nada", async ({ request }) => {
    await conLocal("vmux-firma", "premium", "active", async (t) => {
      const video = await sembrarSubida(t.orgId, "Intocable");
      const datos = creada(video, "as-e2e-intruso");
      const antes = await videoPorTitulo(t.orgId, "Intocable");

      const cuerpo = JSON.stringify({ type: "video.upload.asset_created", data: datos });
      const ahora = Math.floor(Date.now() / 1000);
      const buena = signMuxPayload(cuerpo, E2E_MUX.webhookSecret, ahora);
      const casos: Array<[string, Parameters<typeof aviso>[3]]> = [
        ["sin encabezado", { cuerpo, firma: null }],
        ["encabezado vacío", { cuerpo, firma: "" }],
        ["otro secreto", { cuerpo, secreto: "otro-secreto" }],
        ["vieja", { cuerpo, t: ahora - 3600 }],
        ["del futuro", { cuerpo, t: ahora + 3600 }],
        ["cuerpo alterado", { cuerpo: cuerpo.replace("as-e2e-intruso", "as-e2e-otro"), firma: buena }],
        ["mal formada", { cuerpo, firma: "t=abc,v1=123" }],
      ];
      for (const [nombre, opciones] of casos) {
        expect((await aviso(request, "video.upload.asset_created", datos, opciones)).status(), nombre).toBe(401);
      }
      expect(await videoPorTitulo(t.orgId, "Intocable")).toEqual(antes);
      expect((await stubCalls()).filter((c) => c.id === "as-e2e-intruso")).toEqual([]);
    });
  });

  test("con firma válida: lo ilegible da 400, lo desconocido se ignora y lo demasiado grande da 413; solo GET no existe", async ({ request }) => {
    expect((await aviso(request, "x", {}, { cuerpo: "no es json" })).status()).toBe(400);
    expect((await aviso(request, "x", {}, { cuerpo: "[]" })).status()).toBe(400);
    const desconocido = await aviso(request, "video.live_stream.active", { id: "x" });
    expect(desconocido.status()).toBe(200);
    expect(await desconocido.json()).toMatchObject({ received: true, outcome: "ignored" });
    expect((await aviso(request, "x", {}, { cuerpo: JSON.stringify({ type: "x", data: { relleno: "a".repeat(300 * 1024) } }) })).status()).toBe(413);
    expect((await request.get("/api/mux/webhook")).status()).toBe(405);
  });

  test("un aviso válido y firmado cambia el estado solo del video indicado (y no el de otro local)", async ({ request }) => {
    await conLocal("vmux-a", "premium", "active", async (a) => {
      await conLocal("vmux-b", "premium", "active", async (b) => {
        const deA = await sembrarSubida(a.orgId, "De A");
        const deB = await sembrarSubida(b.orgId, "De B");
        expect((await aviso(request, "video.upload.asset_created", creada(deA, "as-e2e-a"))).status()).toBe(200);
        const filaA = (await service().from("menu_videos").select("mux_status, mux_asset_id").eq("id", deA.id).single()).data;
        const filaB = (await service().from("menu_videos").select("mux_status, mux_asset_id").eq("id", deB.id).single()).data;
        expect(filaA).toEqual({ mux_status: "processing", mux_asset_id: "as-e2e-a" });
        expect(filaB).toEqual({ mux_status: "awaiting_upload", mux_asset_id: null });
      });
    });
  });
});

test.describe("quién puede subir", () => {
  test("Básico no tiene el formulario; solo lectura lo muestra apagado con su aviso", async ({ page }) => {
    await conLocal("vmux-basico", "basic", "active", async (t) => {
      await login(page, t.owner.email, t.owner.password, lista(t.slug));
      await expect(formulario(page)).toHaveCount(0);
    });
    await conLocal("vmux-lectura", "premium", "read_only", async (t) => {
      await login(page, t.owner.email, t.owner.password, lista(t.slug));
      await expect(formulario(page).getByTestId("subir-video-aviso")).toContainText("solo lectura");
      await expect(formulario(page).getByRole("button", { name: "Subir video" })).toBeDisabled();
    });
  });

  test("a 390 px el formulario de subida, con un error largo, no desborda", async ({ page }) => {
    await conLocal("vmux-ancho", "premium", "active", async (t) => {
      await login(page, t.owner.email, t.owner.password, lista(t.slug));
      await subir(page, "M".repeat(80), { name: "n".repeat(120) + ".txt", mimeType: "text/plain", buffer: Buffer.from("x") });
      await expect(page.getByTestId("subida-error")).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  });
});

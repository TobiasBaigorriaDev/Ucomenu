import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createTenant, expectNoHorizontalOverflow, service, type Estado } from "./support";

/**
 * Likes anónimos del feed (nivel C, ficha likes-del-feed), contra el servidor de pruebas, a 390 px: el corazón desde la mesa,
 * lo que recuerda el dispositivo (y que antes del primer toque no guarda nada), dos dispositivos sobre la misma conexión, el
 * link directo (solo el conteo), la cuenta en solo lectura y el fallo del servidor. Los hosts de Mux se interceptan.
 */

const RUN = randomUUID().slice(0, 6);
const STORAGE_KEY = "ucomenu:likes";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const quitar = () => document.querySelectorAll("nextjs-portal").forEach((nodo) => nodo.remove());
    new MutationObserver(quitar).observe(document, { childList: true, subtree: true });
    quitar();
  });
  const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  await page.route(/\/\/(stream|image)\.mux\.com\//, (route) => (route.request().url().includes("image.mux.com") ? route.fulfill({ status: 200, contentType: "image/png", body: PIXEL }) : undefined));
});

async function sembrarVideo(orgId: string, title = "Terraza"): Promise<string> {
  const marca = randomUUID().slice(0, 10);
  const r = await service()
    .from("menu_videos")
    .insert({ organization_id: orgId, title, status: "published", mux_status: "ready", mux_upload_id: `up-${marca}`, mux_asset_id: `as-${marca}`, mux_playback_id: `pb-${marca}-${RUN}`, duration_seconds: 9.5 })
    .select("id")
    .single();
  if (r.error) throw new Error(r.error.message);
  return r.data.id;
}

async function mesa(orgId: string): Promise<string> {
  const branch = await service().from("branches").select("id").eq("organization_id", orgId).single();
  const r = await service().from("tables").insert({ organization_id: orgId, branch_id: branch.data!.id, label: "Mesa 7" }).select("qr_token").single();
  if (r.error) throw new Error(r.error.message);
  return r.data.qr_token as string;
}

async function conLocal(etiqueta: string, estado: Estado, prueba: (t: Awaited<ReturnType<typeof createTenant>>) => Promise<void>) {
  const t = await createTenant(etiqueta, estado);
  try {
    const r = await service().from("subscriptions").update({ plan_code: "premium" }).eq("organization_id", t.orgId);
    if (r.error) throw new Error(r.error.message);
    await prueba(t);
  } finally {
    await t.cleanup();
  }
}

const filas = async (video: string) => (await service().from("video_likes").select("device_key, rate_key").eq("video_id", video)).data ?? [];
const conteo = async (video: string) => (await service().from("menu_videos").select("like_count").eq("id", video).single()).data?.like_count;
const guardado = (page: Page) => page.evaluate((clave) => window.localStorage.getItem(clave), STORAGE_KEY);
const corazon = (page: Page) => page.getByTestId("feed-like").first();
const cantidad = (page: Page) => page.getByTestId("feed-likes-cantidad").first();

test.describe("desde la mesa", () => {
  test("el corazón suma y resta, recuerda el estado al recargar y no guarda nada hasta el primer toque", async ({ page }) => {
    await conLocal("likes-mesa", "active", async (t) => {
      const video = await sembrarVideo(t.orgId);
      const token = await mesa(t.orgId);
      await page.goto(`/t/${token}/videos`);
      await expect(page.getByTestId("feed-video")).toHaveCount(1);

      // Antes del primer toque: botón visible, sin conteo todavía y NADA guardado en el dispositivo.
      await expect(corazon(page)).toBeVisible();
      await expect(corazon(page)).toHaveAttribute("aria-pressed", "false");
      await expect(corazon(page)).toHaveAccessibleName("Me gusta");
      expect(await guardado(page)).toBeNull();
      await expect(page.context().cookies()).resolves.toEqual([]);
      await expectNoHorizontalOverflow(page);

      await corazon(page).click();
      await expect(corazon(page)).toHaveAttribute("aria-pressed", "true");
      await expect(corazon(page)).toHaveAccessibleName("Quitar me gusta");
      await expect(cantidad(page)).toContainText("1");
      await expect.poll(() => conteo(video)).toBe(1);

      // Solo un código aleatorio y el video marcado; la base guarda claves derivadas, no el código ni la mesa.
      const local = JSON.parse((await guardado(page))!) as { device: string; liked: string[] };
      expect(local.device).toMatch(/^[0-9a-f]{32}$/);
      expect(local.liked).toEqual([video]);
      const [fila, ...resto] = await filas(video);
      expect(resto).toHaveLength(0);
      expect(fila.device_key).toMatch(/^[0-9a-f]{32}$/);
      expect(fila.device_key).not.toBe(local.device);

      // Recargar: el corazón sigue marcado y el conteo es el real.
      await page.reload();
      await expect(corazon(page)).toHaveAttribute("aria-pressed", "true");
      await expect(cantidad(page)).toContainText("1");

      // Quitar.
      await corazon(page).click();
      await expect(corazon(page)).toHaveAttribute("aria-pressed", "false");
      await expect(cantidad(page)).toContainText("0");
      await expect.poll(() => conteo(video)).toBe(0);
      expect(await filas(video)).toEqual([]);
    });
  });

  test("dos dispositivos con la misma conexión suman 2; borrar los datos del navegador no suma de más al volver a tocar el mismo video desde el mismo código", async ({ browser }) => {
    await conLocal("likes-dos", "active", async (t) => {
      const video = await sembrarVideo(t.orgId);
      const token = await mesa(t.orgId);
      const a = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const b = await browser.newContext({ viewport: { width: 390, height: 844 } });
      try {
        const [paginaA, paginaB] = await Promise.all([a.newPage(), b.newPage()]);
        for (const p of [paginaA, paginaB]) {
          await p.route(/\/\/(stream|image)\.mux\.com\//, (route) => route.fulfill({ status: 200, contentType: "image/png", body: Buffer.alloc(0) }));
          await p.goto(`/t/${token}/videos`);
        }
        await corazon(paginaA).click();
        await expect.poll(() => conteo(video)).toBe(1);
        await corazon(paginaB).click();
        await expect.poll(() => conteo(video)).toBe(2);
        await expect(cantidad(paginaB)).toContainText("2");
        expect(new Set((await filas(video)).map((f) => f.device_key)).size).toBe(2);

        // El mismo código otra vez (p. ej. el almacenamiento quedó desfasado): la base responde «ya estaba» y no suma.
        const codigo = (JSON.parse((await guardado(paginaA))!) as { device: string }).device;
        await paginaA.evaluate(([clave, device]) => window.localStorage.setItem(clave, JSON.stringify({ device, liked: [] })), [STORAGE_KEY, codigo] as const);
        await paginaA.reload();
        await expect(corazon(paginaA)).toHaveAttribute("aria-pressed", "false");
        await corazon(paginaA).click();
        await expect(corazon(paginaA)).toHaveAttribute("aria-pressed", "true");
        await expect(cantidad(paginaA)).toContainText("2");
        expect(await conteo(video)).toBe(2);
      } finally {
        await a.close();
        await b.close();
      }
    });
  });

  test("si el servidor falla, el corazón vuelve atrás y lo avisa", async ({ page }) => {
    await conLocal("likes-falla", "active", async (t) => {
      const video = await sembrarVideo(t.orgId);
      const token = await mesa(t.orgId);
      await page.goto(`/t/${token}/videos`);
      await expect(corazon(page)).toBeVisible();
      await page.route(/\/t\/[0-9a-f]{32}\/videos/, (route) => (route.request().method() === "POST" ? route.fulfill({ status: 500, body: "error" }) : route.continue()));
      await corazon(page).click();
      await expect(page.getByTestId("feed-likes-aviso")).toBeVisible();
      await expect(corazon(page)).toHaveAttribute("aria-pressed", "false");
      await expect(cantidad(page)).toContainText("0");
      expect(await conteo(video)).toBe(0);
      expect(await filas(video)).toEqual([]);
    });
  });

  test("una cuenta en solo lectura ve el conteo pero no el botón (los likes se apagan)", async ({ page }) => {
    await conLocal("likes-lectura", "read_only", async (t) => {
      const video = await sembrarVideo(t.orgId);
      await service().from("video_likes").insert({ video_id: video, organization_id: t.orgId, device_key: randomBytes(16).toString("hex") });
      const token = await mesa(t.orgId);
      await page.goto(`/t/${token}/videos`);
      await expect(page.getByTestId("feed-video")).toHaveCount(1);
      await expect(page.getByTestId("feed-like")).toHaveCount(0);
      await expect(cantidad(page)).toContainText("1");
    });
  });
});

test.describe("sin mesa", () => {
  test("el link directo muestra el conteo, sin botón, y no guarda nada; con 0 no muestra nada", async ({ page }) => {
    await conLocal("likes-directo", "active", async (t) => {
      const con = await sembrarVideo(t.orgId, "Con likes");
      await sembrarVideo(t.orgId, "Sin likes");
      await service()
        .from("video_likes")
        .insert([1, 2, 3].map(() => ({ video_id: con, organization_id: t.orgId, device_key: randomBytes(16).toString("hex") })));
      await page.goto(`/m/${t.slug}/centro/videos`);
      await expect(page.getByTestId("feed-video")).toHaveCount(2);
      await expect(page.getByTestId("feed-like")).toHaveCount(0);
      await expect(page.getByTestId("feed-likes")).toHaveCount(1); // solo el del video con likes
      await expect(cantidad(page)).toContainText("3");
      expect(await guardado(page)).toBeNull();
      await expectNoHorizontalOverflow(page);
    });
  });
});

import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createTenant, expectNoHorizontalOverflow, service, type Estado } from "./support";

/**
 * Feed de videos de la carta pública (nivel C, ficha feed-de-videos), contra el servidor de pruebas, a 390 px. Los hosts de Mux
 * se interceptan (la prueba no depende de la red): así se mira QUÉ se pide y CUÁNDO (la carta no pide nada de video; el feed pide
 * solo el visible y el siguiente). La reproducción real se comprueba aparte, contra un asset de Mux de staging.
 */

// Los ids de reproducción son únicos en la tabla: un sufijo por corrida evita choques con restos de corridas anteriores.
const RUN = randomUUID().slice(0, 6);
const carta = (slug: string) => `/m/${slug}/centro`;
const feed = (slug: string) => `/m/${slug}/centro/videos`;
const slide = (page: Page, i: number) => page.locator(`[data-testid=feed-video][data-index="${i}"]`);

// Con `next dev`, el indicador de Next (esquina inferior izquierda; a veces expandido como «1 Insight») tapa botones del feed y
// bloquea el clic. No existe en el build de producción: se quita de la página para que no interfiera.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const quitar = () => document.querySelectorAll("nextjs-portal").forEach((nodo) => nodo.remove());
    new MutationObserver(quitar).observe(document, { childList: true, subtree: true });
    quitar();
  });
});

async function conPlan(orgId: string, plan: "basic" | "pro" | "premium") {
  const r = await service().from("subscriptions").update({ plan_code: plan }).eq("organization_id", orgId);
  if (r.error) throw new Error(r.error.message);
}

type Video = { title: string; playback: string; product?: string | null; status?: "draft" | "published"; sort?: number };

async function sembrar(orgId: string, v: Video): Promise<void> {
  const marca = randomUUID().slice(0, 10);
  const r = await service()
    .from("menu_videos")
    .insert({
      organization_id: orgId,
      title: v.title,
      status: v.status ?? "published",
      mux_status: "ready",
      mux_upload_id: `up-${marca}`,
      mux_asset_id: `as-${marca}`,
      mux_playback_id: `${v.playback}-${RUN}`,
      duration_seconds: 9.5,
      product_id: v.product ?? null,
      sort_order: v.sort ?? 0,
    });
  if (r.error) throw new Error(r.error.message);
}

async function platos(orgId: string) {
  const cat = await service().from("categories").insert({ organization_id: orgId, name: "Platos" }).select("id").single();
  if (cat.error) throw new Error(cat.error.message);
  const filas = await service()
    .from("products")
    .insert([
      { organization_id: orgId, category_id: cat.data.id, name: "Milanesa a la napolitana", description: "Con jamón, queso y salsa de tomate.", price_cents: 1850000, is_active: true },
      { organization_id: orgId, category_id: cat.data.id, name: "Plato oculto", description: "No debe verse", price_cents: 100000, is_active: false },
    ])
    .select("id, name");
  if (filas.error) throw new Error(filas.error.message);
  return { visible: filas.data.find((p) => p.name.startsWith("Milanesa"))!.id, oculto: filas.data.find((p) => p.name === "Plato oculto")!.id };
}

/** Intercepta los hosts de Mux: los streams quedan colgados (sin red) y los pósters devuelven un píxel; devuelve lo que se pidió. */
async function interceptarMux(page: Page, opciones: { streamFalla?: boolean } = {}) {
  const pedidos: string[] = [];
  const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  await page.route(/\/\/(stream|image)\.mux\.com\//, async (route) => {
    const url = route.request().url();
    pedidos.push(url);
    if (url.includes("image.mux.com")) return route.fulfill({ status: 200, contentType: "image/png", body: PIXEL });
    if (opciones.streamFalla) return route.fulfill({ status: 404, body: "no existe" });
    // El stream no responde nunca: no hay red ni error, solo «cargando».
  });
  return pedidos;
}
const streamsPedidos = (pedidos: string[]) =>
  pedidos.filter((u) => u.includes("stream.mux.com")).map((u) => /mux\.com\/([^./?]+)/.exec(u)![1].replace(`-${RUN}`, ""));

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

test.describe("la carta y el acceso al feed", () => {
  test("sin videos publicados no hay enlace; con ellos aparece y la carta no pide nada de Mux", async ({ page }) => {
    await conLocal("feed-acceso", "premium", "active", async (t) => {
      await platos(t.orgId);
      await sembrar(t.orgId, { title: "Borrador", playback: "pb-borrador", status: "draft" });
      await page.goto(carta(t.slug));
      await expect(page.getByTestId("ver-videos")).toHaveCount(0);

      await sembrar(t.orgId, { title: "Terraza", playback: "pb-terraza" });
      const pedidos = await interceptarMux(page);
      await page.goto(carta(t.slug));
      await expect(page.getByTestId("ver-videos")).toBeVisible();
      await expect(page.getByTestId("ver-videos")).toHaveAttribute("href", `${feed(t.slug)}?lang=es`);
      // Lo que importa: cargar la carta no pidió ni un video, ni un póster, ni nada a Mux.
      await page.waitForLoadState("networkidle");
      expect(pedidos).toEqual([]);
      const recursos = await page.evaluate(() => performance.getEntriesByType("resource").map((r) => r.name).filter((n) => n.includes("mux.com")));
      expect(recursos).toEqual([]);
    });
  });

  test("Pro, Básico o cuenta suspendida: no hay enlace y el feed no muestra videos", async ({ page }) => {
    await conLocal("feed-pro", "premium", "active", async (t) => {
      await sembrar(t.orgId, { title: "De cuando era Premium", playback: "pb-pro" });
      await conPlan(t.orgId, "pro");
      await page.goto(carta(t.slug));
      await expect(page.getByTestId("ver-videos")).toHaveCount(0);
      await page.goto(feed(t.slug));
      await expect(page.getByTestId("feed-vacio")).toBeVisible();
      await expect(page.getByTestId("feed-video")).toHaveCount(0);
      await conPlan(t.orgId, "premium");
      await page.goto(carta(t.slug));
      await expect(page.getByTestId("ver-videos")).toBeVisible();
    });
    await conLocal("feed-susp", "premium", "active", async (t) => {
      await sembrar(t.orgId, { title: "Suspendida", playback: "pb-susp" });
      await service().from("subscriptions").update({ suspended_at: new Date().toISOString() }).eq("organization_id", t.orgId);
      await page.goto(feed(t.slug));
      await expect(page.getByTestId("carta-no-disponible")).toBeVisible();
      await expect(page.getByTestId("feed-video")).toHaveCount(0);
    });
  });
});

test.describe("el feed", () => {
  test("muestra los videos en orden, uno a la vez, y solo prepara el visible y el siguiente", async ({ page }) => {
    await conLocal("feed-orden", "premium", "active", async (t) => {
      await sembrar(t.orgId, { title: "Tercero", playback: "pb-tercero", sort: 3 });
      await sembrar(t.orgId, { title: "Primero", playback: "pb-primero", sort: 1 });
      await sembrar(t.orgId, { title: "Cuarto", playback: "pb-cuarto", sort: 4 });
      await sembrar(t.orgId, { title: "Segundo", playback: "pb-segundo", sort: 2 });
      await sembrar(t.orgId, { title: "Borrador", playback: "pb-borrador", status: "draft", sort: 0 });
      const pedidos = await interceptarMux(page);

      await page.goto(feed(t.slug));
      await expect(page.getByTestId("feed-video")).toHaveCount(4);
      await expect(page.getByTestId("feed-titulo")).toHaveText(["Primero", "Segundo", "Tercero", "Cuarto"]);
      await expect(page.getByTestId("feed-posicion")).toHaveText("1 / 4");
      await expect(slide(page, 0)).toHaveAttribute("data-prepared", "true");
      await expect(slide(page, 1)).toHaveAttribute("data-prepared", "true");
      await expect(slide(page, 2)).toHaveAttribute("data-prepared", "false");
      await expect(slide(page, 3)).toHaveAttribute("data-prepared", "false");
      await expect.poll(() => streamsPedidos(pedidos).sort()).toEqual(["pb-primero", "pb-segundo"].sort());
      // Los pósters de todos los videos se piden (son livianos); el borrador no existe para el comensal.
      expect(pedidos.some((u) => u.includes("pb-borrador"))).toBe(false);

      // Al pasar al segundo se prepara el tercero y se suelta el primero.
      await page.getByTestId("feed-siguiente").click();
      await expect(page.getByTestId("feed-posicion")).toHaveText("2 / 4");
      await expect(slide(page, 0)).toHaveAttribute("data-prepared", "false");
      await expect(slide(page, 2)).toHaveAttribute("data-prepared", "true");
      await expect.poll(() => streamsPedidos(pedidos).includes("pb-tercero")).toBe(true);
      expect(streamsPedidos(pedidos)).not.toContain("pb-cuarto");
      await expect(page.getByTestId("feed-anterior")).toBeEnabled();
    });
  });

  test("las flechas del teclado cambian de video y Escape vuelve a la carta", async ({ page }) => {
    await conLocal("feed-teclado", "premium", "active", async (t) => {
      await sembrar(t.orgId, { title: "Uno", playback: "pb-uno", sort: 1 });
      await sembrar(t.orgId, { title: "Dos", playback: "pb-dos", sort: 2 });
      await interceptarMux(page);
      await page.goto(feed(t.slug));
      await page.locator("[data-testid=feed] [tabindex='0']").focus();
      await page.keyboard.press("ArrowDown");
      await expect(page.getByTestId("feed-posicion")).toHaveText("2 / 2");
      await page.keyboard.press("ArrowUp");
      await expect(page.getByTestId("feed-posicion")).toHaveText("1 / 2");
      await page.keyboard.press("Escape");
      await expect(page).toHaveURL(new RegExp(`/m/${t.slug}/centro`));
      await expect(page).not.toHaveURL(/videos/);
    });
  });

  test("«Ver plato» solo con un plato visible en la sucursal; abre nombre, precio y descripción", async ({ page }) => {
    await conLocal("feed-plato", "premium", "active", async (t) => {
      const p = await platos(t.orgId);
      await sembrar(t.orgId, { title: "Con plato visible", playback: "pb-visible", product: p.visible, sort: 1 });
      await sembrar(t.orgId, { title: "Con plato oculto", playback: "pb-oculto", product: p.oculto, sort: 2 });
      await sembrar(t.orgId, { title: "Sin plato", playback: "pb-sin", sort: 3 });
      await interceptarMux(page);
      await page.goto(feed(t.slug));
      await expect(page.getByTestId("feed-ver-plato")).toHaveCount(1);
      await slide(page, 0).getByTestId("feed-ver-plato").click();
      const panel = slide(page, 0).getByTestId("feed-plato");
      await expect(panel).toContainText("Milanesa a la napolitana");
      await expect(panel).toContainText("18.500");
      await expect(panel).toContainText("Con jamón, queso y salsa de tomate.");
      await panel.getByRole("button", { name: "Cerrar" }).click();
      await expect(panel).toHaveCount(0);
      // El plato oculto no se revela en ninguna parte de la página.
      expect(await page.content()).not.toContain("Plato oculto");
      expect(await page.content()).not.toContain("No debe verse");
    });
  });

  test("un stream que falla muestra un aviso en ese video y el feed sigue", async ({ page }) => {
    await conLocal("feed-error", "premium", "active", async (t) => {
      await sembrar(t.orgId, { title: "Uno", playback: "pb-e1", sort: 1 });
      await sembrar(t.orgId, { title: "Dos", playback: "pb-e2", sort: 2 });
      await interceptarMux(page, { streamFalla: true });
      await page.goto(feed(t.slug));
      await expect(slide(page, 0).getByTestId("feed-error")).toContainText("No se pudo reproducir este video");
      await page.getByTestId("feed-siguiente").click();
      await expect(page.getByTestId("feed-posicion")).toHaveText("2 / 2");
      await expect(page.getByTestId("feed-titulo").nth(1)).toHaveText("Dos");
    });
  });

  test("con «reducir movimiento» nada arranca solo: hay un botón de reproducir; sin esa preferencia, no", async ({ page }) => {
    await conLocal("feed-movimiento", "premium", "active", async (t) => {
      await sembrar(t.orgId, { title: "Uno", playback: "pb-m1" });
      await interceptarMux(page);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(feed(t.slug));
      await expect(slide(page, 0).getByTestId("feed-play")).toBeVisible();
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await expect(slide(page, 0).getByTestId("feed-play")).toHaveCount(0);
    });
  });

  test("si el navegador bloquea el arranque solo, el primer toque en reproducir vuelve a pedirlo y lo recupera", async ({ page }) => {
    await conLocal("feed-bloqueo", "premium", "active", async (t) => {
      await sembrar(t.orgId, { title: "Uno", playback: "pb-b1" });
      await interceptarMux(page);
      // El «navegador» rechaza todo `play()` hasta que la prueba lo permite (como si faltara un gesto del usuario).
      await page.addInitScript(() => {
        const w = window as unknown as { __plays: number; __permitir: boolean };
        w.__plays = 0;
        w.__permitir = false;
        HTMLMediaElement.prototype.play = function () {
          w.__plays += 1;
          return w.__permitir ? Promise.resolve() : Promise.reject(new DOMException("bloqueado", "NotAllowedError"));
        };
      });
      await page.goto(feed(t.slug));
      await expect(slide(page, 0).getByTestId("feed-play")).toBeVisible();
      const antes = await page.evaluate(() => {
        (window as unknown as { __permitir: boolean }).__permitir = true;
        return (window as unknown as { __plays: number }).__plays;
      });
      await slide(page, 0).getByRole("button", { name: "Reproducir" }).click();
      await expect(slide(page, 0).getByTestId("feed-play")).toHaveCount(0);
      expect(await page.evaluate(() => (window as unknown as { __plays: number }).__plays)).toBeGreaterThan(antes);
    });
  });

  test("si el navegador dice poder HLS nativo pero el video da error, pasa a hls.js (Chrome 155 lo hace)", async ({ page }) => {
    await conLocal("feed-nativo", "premium", "active", async (t) => {
      await sembrar(t.orgId, { title: "Uno", playback: "pb-n1" });
      await interceptarMux(page);
      await page.addInitScript(() => {
        const original = HTMLMediaElement.prototype.canPlayType;
        HTMLMediaElement.prototype.canPlayType = function (tipo: string) {
          return tipo === "application/vnd.apple.mpegurl" ? "maybe" : original.call(this, tipo);
        };
      });
      await page.goto(feed(t.slug));
      await expect(slide(page, 0)).toHaveAttribute("data-prepared", "true");
      const video = slide(page, 0).locator("video");
      // El navegador rechaza el stream nativo: se suelta la fuente y `hls.js` toma el video (su `src` pasa a ser un `blob:` de MSE).
      await video.evaluate((v) => v.dispatchEvent(new Event("error")));
      await expect.poll(() => video.evaluate((v) => (v as HTMLVideoElement).src)).toMatch(/^blob:/);
      await expect(slide(page, 0).getByTestId("feed-error")).toHaveCount(0);
    });
  });

  test("a 390 px, con un título larguísimo, el feed no desborda", async ({ page }) => {
    await conLocal("feed-ancho", "premium", "active", async (t) => {
      const p = await platos(t.orgId);
      await sembrar(t.orgId, { title: "M".repeat(80), playback: "pb-ancho", product: p.visible });
      await interceptarMux(page);
      await page.goto(feed(t.slug));
      await slide(page, 0).getByTestId("feed-ver-plato").click();
      await expectNoHorizontalOverflow(page);
    });
  });

  test("sin videos publicados el feed lo dice y ofrece volver a la carta; una sucursal inexistente es un 404", async ({ page }) => {
    await conLocal("feed-vacio", "premium", "active", async (t) => {
      await page.goto(feed(t.slug));
      await expect(page.getByTestId("feed-vacio")).toBeVisible();
      await page.getByRole("link", { name: "Volver a la carta" }).click();
      await expect(page).toHaveURL(new RegExp(`/m/${t.slug}/centro`));
      expect((await page.goto(`/m/${t.slug}/no-existe/videos`))?.status()).toBe(404);
    });
  });
});

test.describe("el feed desde la mesa conserva el llamado al mozo", () => {
  async function mesa(orgId: string, activa = true) {
    const branch = await service().from("branches").select("id").eq("organization_id", orgId).single();
    const r = await service()
      .from("tables")
      .insert({ organization_id: orgId, branch_id: branch.data!.id, label: "Mesa 7", is_active: activa })
      .select("qr_token")
      .single();
    if (r.error) throw new Error(r.error.message);
    return r.data.qr_token as string;
  }

  test("el enlace de la carta de mesa va al feed de la mesa; la barra sigue, no tapa el video y llama al mozo", async ({ page }) => {
    await conLocal("feed-mesa", "premium", "active", async (t) => {
      await sembrar(t.orgId, { title: "Uno", playback: "pb-mesa1", sort: 1 });
      await sembrar(t.orgId, { title: "Dos", playback: "pb-mesa2", sort: 2 });
      const token = await mesa(t.orgId);
      await interceptarMux(page);
      await page.goto(`/t/${token}`);
      await expect(page.getByTestId("ver-videos")).toHaveAttribute("href", `/t/${token}/videos?lang=es`);
      await page.getByTestId("ver-videos").click();
      await expect(page).toHaveURL(new RegExp(`/t/${token}/videos`));
      await expect(page.getByTestId("feed-video")).toHaveCount(2);

      // La barra de llamado sigue ahí y el video termina donde ella empieza.
      const barra = page.getByTestId("barra-llamado");
      await expect(barra).toBeVisible();
      const cajaBarra = (await barra.boundingBox())!;
      const cajaVideo = (await slide(page, 0).boundingBox())!;
      expect(cajaVideo.y + cajaVideo.height).toBeLessThanOrEqual(cajaBarra.y + 1);
      await expectNoHorizontalOverflow(page);

      // Y funciona: el llamado llega al personal desde el feed.
      await barra.getByRole("button", { name: "Llamar al mozo" }).click();
      await expect(page.getByTestId("mensaje-llamado")).toBeVisible();
      // La barra creció con la confirmación: el video sigue terminando donde ella empieza (revisión de Codex, ronda 1 de la mesa).
      await expect
        .poll(async () => {
          const conMensaje = (await barra.boundingBox())!;
          const video = (await slide(page, 0).boundingBox())!;
          return conMensaje.y - (video.y + video.height);
        })
        .toBeGreaterThanOrEqual(-1);
      expect((await barra.boundingBox())!.height).toBeGreaterThan(cajaBarra.height);
      const llamados = await service().from("waiter_calls").select("kind").eq("organization_id", t.orgId);
      expect(llamados.data?.map((l) => l.kind)).toEqual(["waiter"]);

      // Volver lleva a la carta de la mesa (con la barra y el número de mesa).
      await page.getByTestId("feed-volver").click();
      await expect(page).toHaveURL(new RegExp(`/t/${token}([?]|$)`));
      await expect(page.getByTestId("mesa")).toHaveText("Mesa 7");
      await expect(page.getByTestId("barra-llamado")).toBeVisible();
    });
  });

  test("el feed por la sucursal (sin mesa) no tiene barra de llamado", async ({ page }) => {
    await conLocal("feed-sin-mesa", "premium", "active", async (t) => {
      await sembrar(t.orgId, { title: "Uno", playback: "pb-sm1" });
      await interceptarMux(page);
      await page.goto(feed(t.slug));
      await expect(page.getByTestId("feed-video")).toHaveCount(1);
      await expect(page.getByTestId("barra-llamado")).toHaveCount(0);
    });
  });

  test("mesa desactivada: el feed se ve sin barra; token desconocido: 404; sin videos: aviso con la barra", async ({ page }) => {
    await conLocal("feed-mesa-off", "premium", "active", async (t) => {
      await sembrar(t.orgId, { title: "Uno", playback: "pb-off1" });
      const apagada = await mesa(t.orgId, false);
      await interceptarMux(page);
      await page.goto(`/t/${apagada}/videos`);
      await expect(page.getByTestId("feed-video")).toHaveCount(1);
      await expect(page.getByTestId("barra-llamado")).toHaveCount(0);
      expect((await page.goto("/t/00000000000000000000000000000000/videos"))?.status()).toBe(404);
    });
    await conLocal("feed-mesa-vacia", "premium", "active", async (t) => {
      const token = await mesa(t.orgId);
      await page.goto(`/t/${token}/videos`);
      await expect(page.getByTestId("feed-vacio")).toBeVisible();
      await expect(page.getByTestId("barra-llamado")).toBeVisible();
    });
  });
});

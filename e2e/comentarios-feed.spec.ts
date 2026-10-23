import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createTenant, expectNoHorizontalOverflow, login, service, type Estado } from "./support";

/**
 * Comentarios con aprobación previa del feed (nivel C, ficha comentarios-del-feed), contra el servidor de pruebas, a 390 px: el
 * formulario desde la mesa (queda pendiente y no se ve), la cola de moderación del Dueño y del Staff, la lectura sin mesa, el teclado
 * dentro de la hoja, la cuenta en solo lectura y el fallo del servidor. Los hosts de Mux se interceptan.
 */

const RUN = randomUUID().slice(0, 6);
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const VIEWPORT = { width: 390, height: 844 };

const stubMux = (target: Page | import("@playwright/test").BrowserContext) =>
  target.route(/\/\/(stream|image)\.mux\.com\//, (route) => (route.request().url().includes("image.mux.com") ? route.fulfill({ status: 200, contentType: "image/png", body: PIXEL }) : undefined));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const quitar = () => document.querySelectorAll("nextjs-portal").forEach((nodo) => nodo.remove());
    new MutationObserver(quitar).observe(document, { childList: true, subtree: true });
    quitar();
  });
  await stubMux(page);
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

/** Un comensal aparte: contexto propio (sin la sesión del panel) a 390 px. */
async function comensal(browser: Browser) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  await stubMux(context);
  return { context, page: await context.newPage() };
}

type Fila = { id: string; body: string; alias: string | null; status: string; rate_key: string | null };
const comentarios = async (video: string): Promise<Fila[]> => (await service().from("video_comments").select("id, body, alias, status, rate_key").eq("video_id", video).order("created_at")).data ?? [];
const sembrarComentario = async (orgId: string, video: string, body: string, status: "pending" | "approved" | "rejected" = "approved", alias: string | null = null) => {
  const r = await service()
    .from("video_comments")
    .insert({ video_id: video, organization_id: orgId, body, alias, status, ...(status === "pending" ? {} : { moderated_at: new Date().toISOString() }) })
    .select("id")
    .single();
  if (r.error) throw new Error(r.error.message);
  return r.data.id;
};

const boton = (page: Page) => page.getByTestId("feed-comentarios-boton").first();
const hoja = (page: Page) => page.getByTestId("feed-comentarios-hoja");
const cantidad = (page: Page) => page.getByTestId("feed-comentarios-cantidad").first();

async function abrir(page: Page) {
  await boton(page).click();
  await expect(hoja(page)).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Cargando" })).toHaveCount(0);
}

/** Abre el formulario (recién aparece al tocar «Escribir un comentario») y lo completa. */
async function escribir(page: Page, texto: string, alias = "") {
  if ((await page.getByTestId("feed-comentarios-form").count()) === 0) await page.getByTestId("feed-comentarios-escribir").click();
  await page.getByTestId("feed-comentarios-alias").fill(alias);
  await page.getByTestId("feed-comentarios-texto").fill(texto);
}

test.describe("desde la mesa", () => {
  test("se envía con alias, queda pendiente y no se ve; no guarda nada en el dispositivo", async ({ browser }) => {
    await conLocal("coment-mesa", "active", async (t) => {
      const video = await sembrarVideo(t.orgId);
      const token = await mesa(t.orgId);
      const { context, page } = await comensal(browser);
      try {
        await page.goto(`/t/${token}/videos`);
        await expect(page.getByTestId("feed-video")).toHaveCount(1);
        await expect(boton(page)).toBeVisible();
        await expect(boton(page)).toHaveAccessibleName("Comentarios");
        await expectNoHorizontalOverflow(page);

        await abrir(page);
        await expect(page.getByTestId("feed-comentarios-vacio")).toBeVisible();
        // El formulario no aparece solo: primero un botón, y recién al tocarlo el nombre y el comentario.
        await expect(page.getByTestId("feed-comentarios-form")).toHaveCount(0);
        await expect(page.getByTestId("feed-comentarios-escribir")).toHaveText("Escribir un comentario");
        await expectNoHorizontalOverflow(page);
        await page.getByTestId("feed-comentarios-escribir").click();
        await expect(page.getByTestId("feed-comentarios-alias")).toBeFocused();
        await expect(page.getByTestId("feed-comentarios-escribir")).toHaveCount(0);
        await expect(page.getByTestId("feed-comentarios-enviar")).toBeDisabled();
        await expectNoHorizontalOverflow(page);
        await escribir(page, "  Qué rico\n se ve  ", "Ana");
        await expect(page.getByTestId("feed-comentarios-contador")).toHaveText("14 de 280");
        await page.getByTestId("feed-comentarios-enviar").click();

        await expect(page.getByTestId("feed-comentarios-enviado")).toHaveText("Gracias. Tu comentario se publicará cuando el local lo apruebe.");
        // Al enviar, el formulario se guarda y vuelve el botón.
        await expect(page.getByTestId("feed-comentarios-form")).toHaveCount(0);
        await expect(page.getByTestId("feed-comentarios-escribir")).toBeVisible();
        // Pendiente: ni en la hoja ni en la base pública.
        await expect(page.getByTestId("feed-comentario")).toHaveCount(0);
        const filas = await comentarios(video);
        expect(filas).toHaveLength(1);
        expect(filas[0]).toMatchObject({ body: "Qué rico se ve", alias: "Ana", status: "pending" });
        expect(filas[0].rate_key).toMatch(/^[0-9a-f]{32}$/);

        // Nada en el dispositivo: ni cookies ni almacenamiento local.
        expect(await page.evaluate(() => window.localStorage.length)).toBe(0);
        await expect(context.cookies()).resolves.toEqual([]);

        // Recargar tampoco lo muestra, y el conteo público sigue en 0 (el botón no muestra número).
        await page.reload();
        await expect(cantidad(page)).toHaveCount(0);
        await abrir(page);
        await expect(page.getByTestId("feed-comentario")).toHaveCount(0);
      } finally {
        await context.close();
      }
    });
  });

  test("el Dueño lo aprueba en el panel y aparece en la mesa y en el link directo; retirarlo lo saca", async ({ page, browser }) => {
    await conLocal("coment-flujo", "active", async (t) => {
      const video = await sembrarVideo(t.orgId, "Terraza al atardecer");
      const token = await mesa(t.orgId);
      const { context, page: comensalPage } = await comensal(browser);
      try {
        await comensalPage.goto(`/t/${token}/videos`);
        await abrir(comensalPage);
        await escribir(comensalPage, "Volvemos el sábado", "Luz");
        await comensalPage.getByTestId("feed-comentarios-enviar").click();
        await expect(comensalPage.getByTestId("feed-comentarios-enviado")).toBeVisible();

        await login(page, t.owner.email, t.owner.password, `/panel/${t.slug}/comentarios`);
        await expect(page.getByRole("heading", { name: "Comentarios", level: 1 })).toBeVisible();
        await expectNoHorizontalOverflow(page);
        const pendientes = page.getByTestId("comentarios-pendientes");
        await expect(pendientes.getByTestId("comentarios-pendientes-total")).toHaveText("(1)");
        const tarjeta = pendientes.getByTestId("comentario");
        await expect(tarjeta.getByTestId("comentario-alias")).toHaveText("Luz");
        await expect(tarjeta.getByTestId("comentario-texto")).toHaveText("Volvemos el sábado");
        await expect(tarjeta.getByTestId("comentario-video")).toHaveText("Terraza al atardecer");

        await tarjeta.getByRole("button", { name: /Aprobar/ }).click();
        await expect(page.getByTestId("comentarios-pendientes-vacio")).toBeVisible();
        const publicados = page.getByTestId("comentarios-publicados");
        await expect(publicados.getByTestId("comentario-texto")).toHaveText("Volvemos el sábado");
        expect((await comentarios(video))[0].status).toBe("approved");

        // En la mesa (hoja recién abierta) y en el link directo, con el conteo.
        await comensalPage.reload();
        await expect(cantidad(comensalPage)).toContainText("1");
        await abrir(comensalPage);
        await expect(comensalPage.getByTestId("feed-comentario")).toHaveCount(1);
        await expect(comensalPage.getByTestId("feed-comentario")).toContainText("Luz");
        await expect(comensalPage.getByTestId("feed-comentario")).toContainText("Volvemos el sábado");

        const directo = await comensal(browser);
        try {
          await directo.page.goto(`/m/${t.slug}/centro/videos`);
          await expect(cantidad(directo.page)).toContainText("1");
          await abrir(directo.page);
          await expect(directo.page.getByTestId("feed-comentario")).toContainText("Volvemos el sábado");
          // Sin mesa: se lee, no se escribe.
          await expect(directo.page.getByTestId("feed-comentarios-form")).toHaveCount(0);
          await expect(directo.page.getByTestId("feed-comentarios-escribir")).toHaveCount(0);
          await expectNoHorizontalOverflow(directo.page);
        } finally {
          await directo.context.close();
        }

        // Retirarlo: sale de la carta y pasa a «Rechazados» con la fecha en que se borra.
        await publicados.getByRole("button", { name: /Retirar/ }).click();
        await expect(page.getByTestId("comentarios-publicados-vacio")).toBeVisible();
        const rechazados = page.getByTestId("comentarios-rechazados");
        await expect(rechazados.getByTestId("comentario-texto")).toHaveText("Volvemos el sábado");
        await expect(rechazados.getByTestId("comentario-borrado")).toContainText("Se borra el");
        await comensalPage.reload();
        await expect(cantidad(comensalPage)).toHaveCount(0);
        await abrir(comensalPage);
        await expect(comensalPage.getByTestId("feed-comentario")).toHaveCount(0);

        // Y se puede recuperar.
        await rechazados.getByRole("button", { name: /Aprobar de nuevo/ }).click();
        await expect(page.getByTestId("comentarios-rechazados-vacio")).toBeVisible();
        await expect(page.getByTestId("comentarios-publicados").getByTestId("comentario")).toHaveCount(1);
      } finally {
        await context.close();
      }
    });
  });

  test("el contador marca el límite de 280 y el envío se frena; nada llega a la base", async ({ browser }) => {
    await conLocal("coment-limite", "active", async (t) => {
      const video = await sembrarVideo(t.orgId);
      const token = await mesa(t.orgId);
      const { context, page } = await comensal(browser);
      try {
        await page.goto(`/t/${token}/videos`);
        await abrir(page);
        await escribir(page, "x".repeat(280));
        await expect(page.getByTestId("feed-comentarios-contador")).toHaveText("280 de 280");
        await expect(page.getByTestId("feed-comentarios-enviar")).toBeEnabled();
        await escribir(page, "x".repeat(281));
        await expect(page.getByTestId("feed-comentarios-contador")).toHaveText("281 de 280");
        await expect(page.getByTestId("feed-comentarios-enviar")).toBeDisabled();
        await escribir(page, "   \n  ");
        await expect(page.getByTestId("feed-comentarios-enviar")).toBeDisabled();
        // El alias no pasa de 30 caracteres.
        await page.getByTestId("feed-comentarios-alias").fill("a".repeat(40));
        await expect(page.getByTestId("feed-comentarios-alias")).toHaveValue("a".repeat(30));
        expect(await comentarios(video)).toEqual([]);
      } finally {
        await context.close();
      }
    });
  });

  test("el teclado de la hoja no mueve el feed: las flechas editan el texto y Escape cierra la hoja, no la pantalla", async ({ browser }) => {
    await conLocal("coment-teclado", "active", async (t) => {
      await sembrarVideo(t.orgId, "Uno");
      await sembrarVideo(t.orgId, "Dos");
      const token = await mesa(t.orgId);
      const { context, page } = await comensal(browser);
      try {
        await page.goto(`/t/${token}/videos`);
        await expect(page.getByTestId("feed-video")).toHaveCount(2);
        await expect(page.getByTestId("feed-posicion")).toHaveText("1 / 2");
        await abrir(page);
        await page.getByTestId("feed-comentarios-escribir").click();
        await page.getByTestId("feed-comentarios-texto").focus();
        await page.keyboard.type("hola");
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("PageDown");
        await expect(page.getByTestId("feed-posicion")).toHaveText("1 / 2");
        // Escape cierra primero el formulario (y conserva lo escrito) y recién el segundo cierra la hoja.
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("feed-comentarios-form")).toHaveCount(0);
        await expect(hoja(page)).toBeVisible();
        await expect(page.getByTestId("feed-comentarios-escribir")).toBeFocused();
        await page.getByTestId("feed-comentarios-escribir").click();
        await expect(page.getByTestId("feed-comentarios-texto")).toHaveValue("hola");
        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
        await expect(hoja(page)).toHaveCount(0);
        await expect(page).toHaveURL(new RegExp(`/t/${token}/videos`));
        // El foco vuelve al botón que abrió la hoja.
        await expect(boton(page)).toBeFocused();
      } finally {
        await context.close();
      }
    });
  });

  test("si el servidor falla, avisa y conserva lo escrito para reintentar", async ({ browser }) => {
    await conLocal("coment-falla", "active", async (t) => {
      const video = await sembrarVideo(t.orgId);
      const token = await mesa(t.orgId);
      const { context, page } = await comensal(browser);
      try {
        await page.goto(`/t/${token}/videos`);
        await abrir(page);
        await escribir(page, "No se manda", "Ana");
        await page.route(/\/t\/[0-9a-f]{32}\/videos/, (route) => (route.request().method() === "POST" ? route.fulfill({ status: 500, body: "error" }) : route.continue()));
        await page.getByTestId("feed-comentarios-enviar").click();
        await expect(page.getByTestId("feed-comentarios-error")).toBeVisible();
        await expect(page.getByTestId("feed-comentarios-texto")).toHaveValue("No se manda");
        expect(await comentarios(video)).toEqual([]);
      } finally {
        await context.close();
      }
    });
  });

  test("un reenvío idéntico no duplica el comentario", async ({ browser }) => {
    await conLocal("coment-doble", "active", async (t) => {
      const video = await sembrarVideo(t.orgId);
      const token = await mesa(t.orgId);
      const { context, page } = await comensal(browser);
      try {
        await page.goto(`/t/${token}/videos`);
        await abrir(page);
        for (let i = 0; i < 2; i++) {
          await escribir(page, "Lo mismo dos veces", "Ana");
          await page.getByTestId("feed-comentarios-enviar").click();
          await expect(page.getByTestId("feed-comentarios-enviado")).toBeVisible();
        }
        expect(await comentarios(video)).toHaveLength(1);
      } finally {
        await context.close();
      }
    });
  });

  test("una cuenta en solo lectura ve los comentarios publicados pero no puede escribir", async ({ browser }) => {
    await conLocal("coment-lectura", "read_only", async (t) => {
      const video = await sembrarVideo(t.orgId);
      await sembrarComentario(t.orgId, video, "Ya estaba publicado");
      const token = await mesa(t.orgId);
      const { context, page } = await comensal(browser);
      try {
        await page.goto(`/t/${token}/videos`);
        await expect(cantidad(page)).toContainText("1");
        await abrir(page);
        await expect(page.getByTestId("feed-comentario")).toContainText("Ya estaba publicado");
        await expect(page.getByTestId("feed-comentarios-form")).toHaveCount(0);
        await expect(page.getByTestId("feed-comentarios-escribir")).toHaveCount(0);
      } finally {
        await context.close();
      }
    });
  });
});

test.describe("sin mesa", () => {
  test("el botón aparece solo en los videos con comentarios aprobados; lo pendiente y lo rechazado no se ve", async ({ browser }) => {
    await conLocal("coment-directo", "active", async (t) => {
      const con = await sembrarVideo(t.orgId, "Con comentarios");
      const sin = await sembrarVideo(t.orgId, "Sin comentarios");
      await sembrarComentario(t.orgId, con, "Aprobado uno", "approved", "Ana");
      await sembrarComentario(t.orgId, con, "Aprobado dos");
      await sembrarComentario(t.orgId, con, "Pendiente: no se ve", "pending");
      await sembrarComentario(t.orgId, sin, "Rechazado: no se ve", "rejected");
      const { context, page } = await comensal(browser);
      try {
        await page.goto(`/m/${t.slug}/centro/videos`);
        await expect(page.getByTestId("feed-video")).toHaveCount(2);
        await expect(page.getByTestId("feed-comentarios")).toHaveCount(1); // solo el video con aprobados
        await expect(cantidad(page)).toContainText("2");
        await abrir(page);
        await expect(page.getByTestId("feed-comentario")).toHaveCount(2);
        await expect(page.getByTestId("feed-comentarios-lista")).not.toContainText("Pendiente");
        await expect(page.getByTestId("feed-comentarios-lista")).toContainText("Anónimo");
        await expect(page.getByTestId("feed-comentarios-form")).toHaveCount(0);
        expect(await page.evaluate(() => window.localStorage.length)).toBe(0);
        await expectNoHorizontalOverflow(page);
        await page.getByTestId("feed-comentarios-cerrar").click();
        await expect(hoja(page)).toHaveCount(0);
      } finally {
        await context.close();
      }
    });
  });

  test("muchos comentarios se leen por páginas, los más nuevos primero", async ({ browser }) => {
    await conLocal("coment-paginas", "active", async (t) => {
      const video = await sembrarVideo(t.orgId);
      const filas = Array.from({ length: 25 }, (_, i) => ({
        video_id: video,
        organization_id: t.orgId,
        body: `Comentario ${String(i + 1).padStart(2, "0")}`,
        status: "approved",
        moderated_at: new Date().toISOString(),
        created_at: new Date(Date.UTC(2026, 9, 1, 12, i)).toISOString(),
      }));
      const r = await service().from("video_comments").insert(filas);
      expect(r.error).toBeNull();
      const { context, page } = await comensal(browser);
      try {
        await page.goto(`/m/${t.slug}/centro/videos`);
        await expect(cantidad(page)).toContainText("25");
        await abrir(page);
        await expect(page.getByTestId("feed-comentario")).toHaveCount(20);
        await expect(page.getByTestId("feed-comentario").first()).toContainText("Comentario 25");
        await page.getByTestId("feed-comentarios-mas").click();
        await expect(page.getByTestId("feed-comentario")).toHaveCount(25);
        await expect(page.getByTestId("feed-comentario").last()).toContainText("Comentario 01");
        await expect(page.getByTestId("feed-comentarios-mas")).toHaveCount(0);
      } finally {
        await context.close();
      }
    });
  });
});

test.describe("moderación en el panel", () => {
  test("el Staff también modera, y un comentario largo no desborda a 390 px", async ({ page }) => {
    await conLocal("coment-staff", "active", async (t) => {
      const video = await sembrarVideo(t.orgId, "Terraza");
      const largo = "palabra".repeat(40).slice(0, 280);
      const id = await sembrarComentario(t.orgId, video, largo, "pending", "Alias".repeat(6));
      await login(page, t.staff.email, t.staff.password, `/panel/${t.slug}/comentarios`);
      await expect(page.getByTestId("comentarios-pendientes").getByTestId("comentario")).toHaveCount(1);
      await expectNoHorizontalOverflow(page);
      await page.locator(`[data-comment="${id}"]`).getByRole("button", { name: /Rechazar/ }).click();
      await expect(page.getByTestId("comentarios-pendientes-vacio")).toBeVisible();
      expect((await comentarios(video))[0].status).toBe("rejected");
    });
  });

  test("otro local no ve ni toca mis comentarios", async ({ page }) => {
    await conLocal("coment-ajeno-a", "active", async (a) => {
      await conLocal("coment-ajeno-b", "active", async (b) => {
        const video = await sembrarVideo(a.orgId);
        await sembrarComentario(a.orgId, video, "Es del local A", "pending");
        await login(page, b.owner.email, b.owner.password, `/panel/${b.slug}/comentarios`);
        await expect(page.getByTestId("comentarios-pendientes-vacio")).toBeVisible();
        await expect(page.getByText("Es del local A")).toHaveCount(0);
      });
    });
  });

  test("con la cuenta en solo lectura no se puede aprobar, pero sí rechazar y retirar", async ({ page }) => {
    await conLocal("coment-ro-panel", "read_only", async (t) => {
      const video = await sembrarVideo(t.orgId);
      const pendiente = await sembrarComentario(t.orgId, video, "Pendiente", "pending");
      const publicado = await sembrarComentario(t.orgId, video, "Publicado", "approved");
      await login(page, t.owner.email, t.owner.password, `/panel/${t.slug}/comentarios`);
      await expect(page.getByTestId("comentarios-solo-lectura")).toBeVisible();
      await expect(page.locator(`[data-comment="${pendiente}"]`).getByRole("button", { name: /Aprobar/ })).toBeDisabled();
      await page.locator(`[data-comment="${publicado}"]`).getByRole("button", { name: /Retirar/ }).click();
      await expect(page.getByTestId("comentarios-publicados-vacio")).toBeVisible();
      await page.locator(`[data-comment="${pendiente}"]`).getByRole("button", { name: /Rechazar/ }).click();
      await expect(page.getByTestId("comentarios-pendientes-vacio")).toBeVisible();
      expect((await comentarios(video)).map((c) => c.status)).toEqual(["rejected", "rejected"]);
      // Recuperar es aprobar: sigue apagado.
      await expect(page.getByTestId("comentarios-rechazados").getByRole("button", { name: /Aprobar de nuevo/ }).first()).toBeDisabled();
    });
  });
});

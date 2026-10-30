import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { stubCalls } from "./mux-stub";
import { alerta, createTenant, expectNoHorizontalOverflow, login, service, type Estado } from "./support";

/**
 * Videos del panel (nivel C, ficha videos-del-panel-base), contra el build y el Supabase local, a 390 px. Mux no interviene:
 * lo que dejaría el servidor al terminar de procesar (estado, asset, playback, duración) se siembra con la clave de servicio.
 * Cada prueba trabaja sobre un local propio y lo borra.
 */

const lista = (slug: string) => `/panel/${slug}/videos`;
const tarjeta = (page: Page, id: string) => page.locator(`[data-video="${id}"]`);

async function conPlan(orgId: string, plan: "basic" | "pro" | "premium") {
  const r = await service().from("subscriptions").update({ plan_code: plan }).eq("organization_id", orgId);
  if (r.error) throw new Error(r.error.message);
}

type Siembra = { title?: string; status?: "draft" | "published" | "deleting"; listo?: boolean; conAsset?: boolean; assetId?: string };

async function sembrar(orgId: string, cambios: Siembra = {}): Promise<string> {
  const listo = cambios.listo ?? true;
  const conAsset = (cambios.conAsset ?? true) && listo;
  const marca = randomUUID().slice(0, 12);
  const r = await service()
    .from("menu_videos")
    .insert({
      organization_id: orgId,
      title: cambios.title ?? "Video de prueba",
      status: cambios.status ?? "draft",
      mux_status: listo ? "ready" : "processing",
      mux_upload_id: `up-${marca}`,
      mux_asset_id: conAsset ? (cambios.assetId ?? `as-${marca}`) : null,
      mux_playback_id: conAsset ? `pb-${marca}` : null,
      duration_seconds: conAsset ? 18.2 : null,
    })
    .select("id")
    .single();
  if (r.error) throw new Error(r.error.message);
  return r.data.id;
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

test.describe("videos del panel", () => {
  test("sin videos: el menú tiene «Videos» y la pantalla explica que la subida llega pronto", async ({ page }) => {
    await conLocal("vid-vacio", "premium", "active", async (t) => {
      await login(page, t.owner.email, t.owner.password, lista(t.slug));
      await expect(page.getByRole("heading", { name: "Videos", level: 1 })).toBeVisible();
      await expect(page.getByTestId("videos-vacio")).toContainText("Todavía no hay videos");
      await expect(page.getByTestId("videos-cupo")).toContainText("0 de 10");
      await expect(page.getByRole("link", { name: "Videos" }).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  });

  test("publicar, renombrar, despublicar y el cupo se ven; uno sin procesar no se puede publicar", async ({ page }) => {
    await conLocal("vid-flujo", "premium", "active", async (t) => {
      const listo = await sembrar(t.orgId, { title: "Terraza al atardecer" });
      const crudo = await sembrar(t.orgId, { title: "Procesando todavía", listo: false });
      await login(page, t.owner.email, t.owner.password, lista(t.slug));

      await expect(tarjeta(page, listo).getByTestId("video-estado")).toHaveText("Borrador");
      await expect(tarjeta(page, listo).getByTestId("video-procesamiento")).toHaveText("Listo");
      await expect(tarjeta(page, crudo).getByTestId("video-procesamiento")).toHaveText("Procesando");
      await expect(tarjeta(page, crudo).getByRole("button", { name: /Publicar/ })).toBeDisabled();

      await tarjeta(page, listo).getByRole("button", { name: /Publicar/ }).click();
      await expect(tarjeta(page, listo).getByTestId("video-estado")).toHaveText("Publicado");
      await expect(page.getByTestId("videos-cupo")).toContainText("1 de 10");

      await tarjeta(page, listo).getByLabel("Nombre del video").fill("Terraza de noche");
      await tarjeta(page, listo).getByRole("button", { name: "Guardar" }).click();
      await expect(tarjeta(page, listo).getByText("Video guardado.")).toBeVisible();
      await expect(tarjeta(page, listo).getByTestId("video-titulo")).toHaveText("Terraza de noche");

      await tarjeta(page, listo).getByRole("button", { name: /Despublicar/ }).click();
      await expect(tarjeta(page, listo).getByTestId("video-estado")).toHaveText("Borrador");
      await expect(page.getByTestId("videos-cupo")).toContainText("0 de 10");
      expect((await service().from("menu_videos").select("status, title").eq("id", listo).single()).data).toEqual({ status: "draft", title: "Terraza de noche" });
    });
  });

  test("con el cupo lleno el mensaje es claro y no se publica; el Staff también lo ve y lo respeta", async ({ page }) => {
    await conLocal("vid-cupo", "premium", "active", async (t) => {
      for (let i = 0; i < 10; i++) await sembrar(t.orgId, { title: `Publicado ${i + 1}`, status: "published" });
      const extra = await sembrar(t.orgId, { title: "El que sobra" });
      await login(page, t.staff.email, t.staff.password, lista(t.slug));
      await expect(page.getByTestId("videos-cupo")).toContainText("10 de 10");
      await tarjeta(page, extra).getByRole("button", { name: /Publicar/ }).click();
      await expect(alerta(page)).toContainText("Llegaste al máximo de 10 videos publicados");
      await expect(tarjeta(page, extra).getByTestId("video-estado")).toHaveText("Borrador");

      await tarjeta(page, extra).locator("xpath=ancestor::ul/li").first().getByRole("button", { name: /Despublicar/ }).first().click();
      await expect(page.getByTestId("videos-cupo")).toContainText("9 de 10");
      await tarjeta(page, extra).getByRole("button", { name: /Publicar/ }).click();
      await expect(tarjeta(page, extra).getByTestId("video-estado")).toHaveText("Publicado");
      expect((await service().from("menu_videos").select("id", { count: "exact", head: true }).eq("organization_id", t.orgId).eq("status", "published")).count).toBe(10);
    });
  });

  test("borrar: sin asset se elimina; con asset se borra en Mux; si Mux falla queda «Eliminando» y se puede reintentar", async ({ page }) => {
    await conLocal("vid-borrar", "premium", "active", async (t) => {
      const sinAsset = await sembrar(t.orgId, { title: "Sin archivo", listo: false, conAsset: false });
      const conAsset = await sembrar(t.orgId, { title: "Con archivo", assetId: `as-ok-${randomUUID().slice(0, 8)}` });
      // El prefijo «fail-» hace que el Mux de mentira rechace el borrado del asset (Mux caído).
      const muxCaido = await sembrar(t.orgId, { title: "Con Mux caído", assetId: `fail-${randomUUID().slice(0, 8)}` });
      await login(page, t.owner.email, t.owner.password, lista(t.slug));

      await tarjeta(page, sinAsset).locator("summary", { hasText: "Borrar video" }).click();
      await tarjeta(page, sinAsset).getByRole("button", { name: "Sí, borrar el video definitivamente" }).click();
      await expect(tarjeta(page, sinAsset)).toHaveCount(0);

      const asset = (await service().from("menu_videos").select("mux_asset_id").eq("id", conAsset).single()).data!.mux_asset_id!;
      await tarjeta(page, conAsset).locator("summary", { hasText: "Borrar video" }).click();
      await tarjeta(page, conAsset).getByRole("button", { name: "Sí, borrar el video definitivamente" }).click();
      await expect(tarjeta(page, conAsset)).toHaveCount(0);
      expect((await stubCalls()).filter((c) => c.method === "DELETE" && c.id === asset)).toHaveLength(1);

      await tarjeta(page, muxCaido).locator("summary", { hasText: "Borrar video" }).click();
      await tarjeta(page, muxCaido).getByRole("button", { name: "Sí, borrar el video definitivamente" }).click();
      // Mux no responde: el video sale de la lista de publicados y queda esperando el borrado del asset.
      await expect(tarjeta(page, muxCaido).getByTestId("video-estado")).toHaveText("Eliminando");
      await expect(tarjeta(page, muxCaido).getByText("falta borrarlo del servicio de video")).toBeVisible();
      await expect(tarjeta(page, muxCaido).getByRole("button", { name: "Reintentar" })).toBeVisible();
      await expect(tarjeta(page, muxCaido).getByRole("button", { name: /^Publicar/ })).toHaveCount(0);
      expect((await service().from("menu_videos").select("status").eq("id", muxCaido).single()).data?.status).toBe("deleting");
    });
  });

  test("Pro tiene el feed (ADR 0049): cupo de 10 y se puede publicar", async ({ page }) => {
    await conLocal("vid-pro", "pro", "active", async (t) => {
      const id = await sembrar(t.orgId, { title: "Terraza en Pro" });
      await login(page, t.owner.email, t.owner.password, lista(t.slug));
      await expect(page.getByTestId("videos-sin-plan")).toHaveCount(0);
      await expect(page.getByTestId("videos-cupo")).toContainText("0 de 10");
      await tarjeta(page, id).getByRole("button", { name: /Publicar/ }).click();
      await expect(tarjeta(page, id).getByTestId("video-estado")).toHaveText("Publicado");
      await expect(page.getByTestId("videos-cupo")).toContainText("1 de 10");
    });
  });

  test("Básico: la pantalla explica que el feed es del plan Pro y no deja publicar; los videos se conservan", async ({ page }) => {
    await conLocal("vid-basico", "basic", "active", async (t) => {
      const id = await sembrar(t.orgId, { title: "De cuando tenía el feed" });
      await login(page, t.owner.email, t.owner.password, lista(t.slug));
      await expect(page.getByTestId("videos-sin-plan")).toContainText("incluido en el plan Pro");
      await expect(page.getByTestId("videos-cupo")).toHaveCount(0);
      await expect(tarjeta(page, id).getByTestId("video-titulo")).toHaveText("De cuando tenía el feed");
      await expect(tarjeta(page, id).getByRole("button", { name: /Publicar/ })).toBeDisabled();
      // Renombrar sí se puede: el plan solo cierra la publicación.
      await tarjeta(page, id).getByLabel("Nombre del video").fill("Renombrado en Básico");
      await tarjeta(page, id).getByRole("button", { name: "Guardar" }).click();
      await expect(tarjeta(page, id).getByText("Video guardado.")).toBeVisible();
    });
  });

  test("en solo lectura se ven los videos pero ningún control escribe", async ({ page }) => {
    await conLocal("vid-lectura", "premium", "read_only", async (t) => {
      const id = await sembrar(t.orgId, { title: "Solo para mirar" });
      await login(page, t.owner.email, t.owner.password, lista(t.slug));
      await expect(tarjeta(page, id).getByTestId("video-titulo")).toHaveText("Solo para mirar");
      await expect(tarjeta(page, id).getByRole("button", { name: /Publicar/ })).toBeDisabled();
      await expect(tarjeta(page, id).getByLabel("Nombre del video")).toBeDisabled();
      await expect(tarjeta(page, id).getByRole("button", { name: "Guardar" })).toBeDisabled();
    });
  });

  test("a 390 px la lista, con el nombre más largo y el borrado abierto, no desborda", async ({ page }) => {
    await conLocal("vid-ancho", "premium", "active", async (t) => {
      const id = await sembrar(t.orgId, { title: "M".repeat(80) });
      await sembrar(t.orgId, { title: "Eliminando " + "N".repeat(60), status: "deleting" });
      await login(page, t.owner.email, t.owner.password, lista(t.slug));
      await tarjeta(page, id).locator("summary", { hasText: "Borrar video" }).click();
      await expectNoHorizontalOverflow(page);
    });
  });

  test("quien no es del local no ve la pantalla de otro", async ({ page }) => {
    await conLocal("vid-a", "premium", "active", async (a) => {
      await conLocal("vid-b", "premium", "active", async (b) => {
        await sembrar(a.orgId, { title: "Secreto de A" });
        await login(page, b.owner.email, b.owner.password);
        expect((await page.goto(lista(a.slug)))?.status()).toBe(404);
        await expect(page.getByText("Secreto de A")).toHaveCount(0);
      });
    });
  });
});

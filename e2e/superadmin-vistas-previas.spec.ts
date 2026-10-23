import { expect, test, type Page } from "@playwright/test";
import { purgeAuditLogWhere } from "../tests/rls/purge-price-history";
import { todayInArgentina } from "../src/lib/admin/validation";
import { SEED_PASSWORD, alerta, createTenant, expectNoHorizontalOverflow, login, service } from "./support";

/**
 * Vistas previas de funciones por organización (nivel C, ficha vistas-previas-de-funciones, ADR 0039), contra el build y el
 * Supabase local, a 390 px: el SuperAdmin habilita una función con fin y motivo, cambia el fin y la termina; el Dueño no ve nada
 * de eso. Cada prueba trabaja sobre un local propio y lo borra con su auditoría.
 */

const ADMIN_EMAIL = "admin@ucomenu.test";
const DIA_MS = 24 * 60 * 60 * 1000;
const detalle = (slug: string) => `/admin/organizaciones/${slug}`;
const enDias = (dias: number) => todayInArgentina(new Date(Date.now() + dias * DIA_MS));
const funcion = (page: Page, clave: string) => page.getByTestId("vistas-previas").locator(`[data-feature="${clave}"]`);

const limpiarAuditoria = (orgId: string) => purgeAuditLogWhere(`organization_id = '${orgId}'`);

test.describe("vistas previas de funciones", () => {
  test("habilitar, cambiar el fin y terminar una función; el Dueño no ve nada", async ({ page, browser }) => {
    const t = await createTenant("adm-vp");
    try {
      await login(page, ADMIN_EMAIL, SEED_PASSWORD, detalle(t.slug));
      const pedidos = funcion(page, "orders");
      await expect(page.getByTestId("vistas-previas").getByTestId("vista-previa")).toHaveCount(4);
      await expect(pedidos.getByTestId("vista-previa-estado")).toHaveText("Sin vista previa.");
      await expectNoHorizontalOverflow(page);

      // Sin motivo no se envía (el campo es obligatorio); con fin y motivo, queda vigente.
      await pedidos.locator("#preview-fin-orders").fill(enDias(14));
      await pedidos.locator("#preview-motivo-orders").fill("Piloto con el local");
      await pedidos.getByRole("button", { name: "Habilitar función" }).click();
      await expect(pedidos.getByRole("status")).toContainText("quedó habilitada");
      await expect(pedidos.getByTestId("vista-previa-estado")).toContainText("Vigente hasta");
      await expect(pedidos.getByTestId("vista-previa-estado")).toContainText("motivo: Piloto con el local");
      await expect(pedidos).toHaveAttribute("data-active", "true");
      const iniciada = page.getByTestId("auditoria").filter({ hasText: "Vista previa de función iniciada" });
      await expect(iniciada).toContainText("Pedidos del mozo");
      await expect(iniciada).toContainText("motivo: Piloto con el local");
      await expect(funcion(page, "customers")).toHaveAttribute("data-active", "false");

      // El Dueño no ve la vista previa ni su motivo en su suscripción.
      const dueno = await browser.newPage();
      await login(dueno, t.owner.email, t.owner.password, `/panel/${t.slug}/suscripcion`);
      await expect(dueno.getByText(/vista previa/i)).toHaveCount(0);
      await expect(dueno.getByText("Piloto con el local")).toHaveCount(0);
      await dueno.close();

      // Cambiar el fin.
      await pedidos.locator("#preview-fin-orders").fill(enDias(30));
      await pedidos.locator("#preview-motivo-orders").fill("Se extiende el piloto");
      await pedidos.getByRole("button", { name: "Cambiar el fin" }).click();
      await expect(pedidos.getByTestId("vista-previa-estado")).toContainText("motivo: Se extiende el piloto");
      await expect(page.getByTestId("auditoria").filter({ hasText: "Vista previa de función modificada" })).toBeVisible();

      // Terminarla.
      await pedidos.getByText("Terminar la vista previa de Pedidos del mozo").click();
      await pedidos.locator("#preview-fin-motivo-orders").fill("Terminó el piloto");
      await pedidos.getByRole("button", { name: "Terminar vista previa" }).click();
      await expect(pedidos.getByTestId("vista-previa-estado")).toContainText("Terminó el");
      await expect(pedidos).toHaveAttribute("data-active", "false");
      await expect(page.getByTestId("auditoria").filter({ hasText: "Vista previa de función finalizada" })).toContainText("motivo: Terminó el piloto");
      await expect(pedidos.getByText("Terminar la vista previa de Pedidos del mozo")).toHaveCount(0);
    } finally {
      await limpiarAuditoria(t.orgId);
      await t.cleanup();
    }
  });

  test("un fin fuera de rango o sin motivo no se guarda y avisa", async ({ page }) => {
    const t = await createTenant("adm-vp-rango");
    try {
      await login(page, ADMIN_EMAIL, SEED_PASSWORD, detalle(t.slug));
      const promos = funcion(page, "promotions");
      // Pasado el tope de 90 días: el navegador lo marca inválido (max) y no envía; saltamos esa barrera para ver el mensaje del servidor.
      await promos.locator("#preview-fin-promotions").evaluate((el: HTMLInputElement) => el.removeAttribute("max"));
      await promos.locator("#preview-fin-promotions").fill(enDias(200));
      await promos.locator("#preview-motivo-promotions").fill("Demasiado largo");
      await promos.getByRole("button", { name: "Habilitar función" }).click();
      await expect(alerta(page)).toContainText("hasta 90 días");
      await expect(promos.getByTestId("vista-previa-estado")).toHaveText("Sin vista previa.");
      expect((await service().from("organization_feature_previews").select("feature").eq("organization_id", t.orgId)).data).toEqual([]);
    } finally {
      await limpiarAuditoria(t.orgId);
      await t.cleanup();
    }
  });
});

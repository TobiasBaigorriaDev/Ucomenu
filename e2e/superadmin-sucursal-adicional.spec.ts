import { expect, test, type Page } from "@playwright/test";
import { purgeAuditLogWhere } from "../tests/rls/purge-price-history";
import { SEED_PASSWORD, alerta, createTenant, expectNoHorizontalOverflow, login, service } from "./support";

/**
 * Sucursal adicional para Pro (nivel C, ficha sucursal-adicional, ADR 0039), contra el build y el Supabase local, a 390 px:
 * el SuperAdmin vende y quita sucursales (eligiendo cuáles se desactivan al quitar), y el Dueño ve el cupo, el precio y la
 * salida cuando llega al tope. Cada prueba trabaja sobre un local propio y lo borra con su auditoría.
 */

const ADMIN_EMAIL = "admin@ucomenu.test";
const detalle = (slug: string) => `/admin/organizaciones/${slug}`;
const bloque = (page: Page) => page.getByTestId("sucursales-extra");

async function conPlan(orgId: string, plan: "basic" | "pro" | "premium") {
  const r = await service().from("subscriptions").update({ plan_code: plan }).eq("organization_id", orgId);
  if (r.error) throw new Error(r.error.message);
}

async function sucursal(orgId: string, slug: string) {
  const r = await service().from("branches").insert({ organization_id: orgId, slug, name: slug.toUpperCase() });
  if (r.error) throw new Error(r.error.message);
}

const activas = async (orgId: string) =>
  ((await service().from("branches").select("slug").eq("organization_id", orgId).eq("is_active", true).order("slug")).data ?? []).map((b) => b.slug);

const limpiarAuditoria = (orgId: string) => purgeAuditLogWhere(`organization_id = '${orgId}'`);

test.describe("sucursal adicional", () => {
  test("vender una, verla el Dueño con su precio y quitarla eligiendo cuál se desactiva", async ({ page, browser }) => {
    const t = await createTenant("adm-extra");
    try {
      await conPlan(t.orgId, "pro");
      await sucursal(t.orgId, "norte");
      await login(page, ADMIN_EMAIL, SEED_PASSWORD, detalle(t.slug));

      await expect(bloque(page).getByTestId("sucursales-extra-estado")).toContainText("Sin sucursales adicionales");
      await expect(bloque(page)).toContainText("$ 12.000 ARS");
      await expectNoHorizontalOverflow(page);

      // Vender 1.
      await page.locator("#extra-cantidad").fill("1");
      await page.locator("#extra-motivo").fill("Contrató una sucursal");
      await bloque(page).getByRole("button", { name: "Guardar sucursales adicionales" }).click();
      await expect(bloque(page).getByRole("status")).toContainText("quedó registrada");
      await expect(bloque(page).getByTestId("sucursales-extra-estado")).toContainText("1 sucursal adicional vigente");
      await expect(bloque(page).getByTestId("sucursales-extra-estado")).toContainText("de un tope de 3");
      const movimiento = page.getByTestId("auditoria").filter({ hasText: "Add-on activado" });
      await expect(movimiento).toContainText("1 sucursal adicional");
      await expect(movimiento).toContainText("motivo: Contrató una sucursal");

      // El Dueño ve el cupo, el desglose con el precio y el movimiento sin motivo.
      const dueno = await browser.newPage();
      await login(dueno, t.owner.email, t.owner.password, `/panel/${t.slug}/suscripcion`);
      await expect(dueno.getByTestId("suscripcion-sucursales")).toHaveText("2 de 3 (2 del plan + 1 adicional · ARS 12.000/mes)");
      await expect(dueno.getByText("Sucursales adicionales activadas por UcoMenu")).toBeVisible();
      await expect(dueno.getByText("Contrató una sucursal")).toHaveCount(0);

      // Con 3 activas, quitar la adicional exige elegir cuál se desactiva.
      await sucursal(t.orgId, "sur");
      await page.reload();
      await page.locator("#extra-cantidad").fill("0");
      const elegir = page.getByTestId("extra-desactivar");
      await expect(elegir).toContainText("Elegí la sucursal que se desactiva");
      await page.locator("#extra-motivo").fill("Dejó de pagarla");
      await bloque(page).getByRole("button", { name: "Guardar sucursales adicionales" }).click();
      await expect(alerta(page)).toContainText("no coinciden con las que hay que desactivar");
      expect(await activas(t.orgId)).toEqual(["centro", "norte", "sur"]);

      await elegir.getByLabel("SUR (sur)").check();
      await page.locator("#extra-motivo").fill("Dejó de pagarla");
      await bloque(page).getByRole("button", { name: "Guardar sucursales adicionales" }).click();
      await expect(bloque(page).getByRole("status")).toContainText("se desactivaron las sucursales elegidas");
      await expect(bloque(page).getByTestId("sucursales-extra-estado")).toContainText("Sin sucursales adicionales");
      expect(await activas(t.orgId)).toEqual(["centro", "norte"]);
      await expect(page.getByTestId("auditoria").filter({ hasText: "Add-on finalizado" })).toContainText("desactivadas: sur");

      // El Dueño ve la sucursal desactivada y que no tiene más cupo.
      await dueno.goto(`/panel/${t.slug}/sucursales`);
      await expect(dueno.getByTestId("sucursales-uso")).toContainText("2 de 2");
      await expect(dueno.getByTestId("sucursal").filter({ hasText: "SUR" })).toHaveAttribute("data-active", "false");
      await dueno.close();
    } finally {
      await limpiarAuditoria(t.orgId);
      await t.cleanup();
    }
  });

  test("al llegar al tope el Dueño de Pro lee «Pedí una sucursal adicional»; el de Básico, la salida de siempre", async ({ page }) => {
    const pro = await createTenant("adm-extra-tope");
    const basico = await createTenant("adm-extra-basico");
    try {
      await conPlan(pro.orgId, "pro");
      await sucursal(pro.orgId, "norte");
      await login(page, pro.owner.email, pro.owner.password, `/panel/${pro.slug}/sucursales`);
      await expect(page.getByTestId("aviso-tope")).toContainText("Pedí una sucursal adicional a UcoMenu (ARS 12.000/mes cada una)");
      await expectNoHorizontalOverflow(page);

      await conPlan(basico.orgId, "basic");
      await page.context().clearCookies();
      await login(page, basico.owner.email, basico.owner.password, `/panel/${basico.slug}/sucursales`);
      await expect(page.getByTestId("aviso-tope")).toContainText("cambiar de plan");
      await expect(page.getByTestId("aviso-tope")).not.toContainText("ARS");
    } finally {
      await limpiarAuditoria(pro.orgId);
      await limpiarAuditoria(basico.orgId);
      await pro.cleanup();
      await basico.cleanup();
    }
  });

  test("sobre Básico o Premium el bloque dice que hace falta Pro y no ofrece el formulario", async ({ page }) => {
    const t = await createTenant("adm-extra-nopro");
    try {
      await conPlan(t.orgId, "basic");
      await login(page, ADMIN_EMAIL, SEED_PASSWORD, detalle(t.slug));
      await expect(page.getByTestId("sucursales-extra-plan")).toContainText("Hace falta el plan Pro");
      await expect(page.locator("#extra-cantidad")).toHaveCount(0);

      await conPlan(t.orgId, "premium");
      await page.reload();
      await expect(page.getByTestId("sucursales-extra-plan")).toContainText("Premium no tiene tope de sucursales");
    } finally {
      await limpiarAuditoria(t.orgId);
      await t.cleanup();
    }
  });
});

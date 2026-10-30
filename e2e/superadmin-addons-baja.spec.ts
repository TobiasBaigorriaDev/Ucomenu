import { expect, test, type Page } from "@playwright/test";
import { purgeAuditLogWhere } from "../tests/rls/purge-price-history";
import { SEED_PASSWORD, alerta, createTenant, expectNoHorizontalOverflow, login, service } from "./support";

/**
 * SuperAdmin: add-ons y baja de organizaciones (nivel C, ficha addons-y-baja-de-organizaciones), contra el build y el
 * Supabase local, a 390 px. Cada prueba trabaja sobre un local propio (`createTenant`) y lo borra con su auditoría.
 *
 * Desde ADR 0031 el catálogo genérico de add-ons está vacío (WebAR se retiró); la sucursal adicional tiene su propio bloque
 * (`superadmin-sucursal-adicional.spec.ts`). La pantalla se prueba sin add-ons genéricos y, para las funciones que se
 * conservan, con un add-on de ensayo que se inserta y se borra acá (ficha catalogo-video-feed).
 */

const ADMIN_EMAIL = "admin@ucomenu.test";
const ADDON = "tt_ensayo";
const DIA_MS = 24 * 60 * 60 * 1000;
const detalle = (slug: string) => `/admin/organizaciones/${slug}`;

const seccion = (page: Page, id: string) => page.locator(`section[aria-labelledby="${id}"]`);
const addon = (page: Page) => page.getByTestId("addon").first();
const enDias = (dias: number) => new Date(Date.now() + dias * DIA_MS).toISOString().slice(0, 10);

async function conPlan(orgId: string, plan: "basic" | "pro" | "premium") {
  const r = await service().from("subscriptions").update({ plan_code: plan }).eq("organization_id", orgId);
  if (r.error) throw new Error(r.error.message);
}
const limpiarAuditoria = (orgId: string) => purgeAuditLogWhere(`organization_id = '${orgId}'`);

test.describe("add-ons", () => {
  // Serie: la primera prueba necesita el catálogo genérico vacío y las demás lo llenan con un add-on de ensayo.
  test.describe.configure({ mode: "serial" });

  test("sin add-ons genéricos: dice que no hay otros a la venta y no ofrece formularios", async ({ page }) => {
    const t = await createTenant("adm-addon-vacio");
    try {
      await conPlan(t.orgId, "premium");
      await login(page, ADMIN_EMAIL, SEED_PASSWORD, detalle(t.slug));
      await expect(page.getByTestId("addons-vacio")).toContainText("Hoy no hay otros add-ons a la venta");
      await expect(page.getByTestId("addons-vacio")).toContainText("plan Pro");
      await expect(page.getByTestId("addon")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Activar add-on" })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
    } finally {
      await t.cleanup();
    }
  });

  test.describe("con un add-on de ensayo", () => {
    test.beforeAll(async () => {
      const r = await service().from("addons").upsert({
        code: ADDON,
        name: "Ensayo",
        monthly_price_usd_cents: 1000,
        base_model_quota: 15,
        pack_size: 10,
        pack_monthly_price_usd_cents: 500,
        allowed_plans: ["pro", "premium"],
      });
      if (r.error) throw new Error(r.error.message);
    });
    test.afterAll(async () => {
      await service().from("addons").delete().eq("code", ADDON);
    });

    test("activar con packs y fin, cambiar, finalizar y volver a activar; el Dueño ve el historial sin el motivo", async ({ page, browser }) => {
      const t = await createTenant("adm-addon");
      try {
        await conPlan(t.orgId, "pro");
        await login(page, ADMIN_EMAIL, SEED_PASSWORD, detalle(t.slug));
        await expect(addon(page).getByTestId("addon-estado")).toContainText("Nunca contratado");

        const form = addon(page).locator("form").first();
        await form.getByLabel("Packs extra").fill("2");
        await form.getByLabel("Termina el (opcional)").fill(enDias(40));
        await form.getByLabel("Motivo de la activación").fill("Contrató el ensayo con dos packs");
        await form.getByRole("button", { name: "Activar add-on" }).click();
        await expect(form.getByRole("status")).toContainText("el add-on quedó registrado");
        await expect(addon(page).getByTestId("addon-estado")).toContainText("Vigente");
        await expect(addon(page).getByTestId("addon-estado")).toContainText("cupo de 35");
        await expect(addon(page)).toHaveAttribute("data-active", "true");
        // Tras guardar, el formulario conserva lo guardado y ahora ofrece cambiar.
        await expect(form.getByLabel("Packs extra")).toHaveValue("2");
        await expect(form.getByRole("button", { name: "Guardar cambios" })).toBeVisible();

        const movimiento = page.getByTestId("auditoria").filter({ hasText: "Add-on activado" });
        await expect(movimiento).toContainText(ADDON);
        await expect(movimiento).toContainText("2 packs extra");
        await expect(movimiento).toContainText("motivo: Contrató el ensayo con dos packs");
        await expect(movimiento).toContainText(`por ${ADMIN_EMAIL}`);

        // Cambiar los packs.
        await form.getByLabel("Packs extra").fill("3");
        await form.getByLabel("Motivo del cambio").fill("Pidió otro pack");
        await form.getByRole("button", { name: "Guardar cambios" }).click();
        await expect(form.getByRole("status")).toContainText("el add-on quedó registrado");
        await expect(addon(page).getByTestId("addon-estado")).toContainText("cupo de 45");
        await expect(page.getByTestId("auditoria").filter({ hasText: "Add-on modificado" })).toContainText("3 packs extra");

        // Repetir lo mismo lo dice el servidor y no agrega movimientos.
        await form.getByLabel("Motivo del cambio").fill("otra vez");
        await form.getByRole("button", { name: "Guardar cambios" }).click();
        await expect(alerta(page)).toContainText("ya está vigente con esos packs");
        await expect(page.getByTestId("auditoria").filter({ hasText: "Add-on modificado" })).toHaveCount(1);

        // El Dueño lo ve en su historial, sin el motivo.
        const dueno = await browser.newPage();
        await login(dueno, t.owner.email, t.owner.password, `/panel/${t.slug}/suscripcion`);
        await expect(dueno.getByText(`${ADDON} modificado por UcoMenu`)).toBeVisible();
        await expect(dueno.getByText(`${ADDON} activado por UcoMenu`)).toBeVisible();
        await expect(dueno.getByText("Pidió otro pack")).toHaveCount(0);
        await expect(dueno.getByText("Contrató el ensayo con dos packs")).toHaveCount(0);

        // Finalizar.
        await page.locator("summary", { hasText: "Finalizar Ensayo" }).click();
        const fin = addon(page).locator("form").filter({ has: page.getByRole("button", { name: "Finalizar add-on" }) });
        await fin.getByLabel("Motivo").fill("Dejó de pagarlo");
        await fin.getByRole("button", { name: "Finalizar add-on" }).click();
        // El formulario de finalizar desaparece con el add-on vigente: la confirmación es el cambio de estado y el movimiento.
        await expect(addon(page).getByTestId("addon-estado")).toContainText("Finalizado");
        await expect(addon(page)).toHaveAttribute("data-active", "false");
        await expect(page.getByTestId("auditoria").filter({ hasText: "Add-on finalizado" })).toContainText("motivo: Dejó de pagarlo");

        // Volver a activarlo es una activación nueva.
        const otra = addon(page).locator("form").first();
        await otra.getByLabel("Motivo de la activación").fill("Volvió");
        await otra.getByRole("button", { name: "Activar add-on" }).click();
        await expect(otra.getByRole("status")).toContainText("el add-on quedó registrado");
        await expect(page.getByTestId("auditoria").filter({ hasText: "Add-on activado" })).toHaveCount(2);
        await dueno.close();
      } finally {
        await limpiarAuditoria(t.orgId);
        await t.cleanup();
      }
    });

    test("sobre un plan Básico no se ofrece: dice qué plan hace falta", async ({ page }) => {
      const t = await createTenant("adm-addon-basic");
      try {
        await conPlan(t.orgId, "basic");
        await login(page, ADMIN_EMAIL, SEED_PASSWORD, detalle(t.slug));
        await expect(page.getByTestId("addon-plan-no-admitido")).toContainText("Pro o Premium");
        await expect(page.getByRole("button", { name: "Activar add-on" })).toHaveCount(0);
      } finally {
        await t.cleanup();
      }
    });

    test("la fecha de fin pasada y el motivo vacío se rechazan con un mensaje claro", async ({ page }) => {
      const t = await createTenant("adm-addon-mal");
      try {
        await conPlan(t.orgId, "pro");
        await login(page, ADMIN_EMAIL, SEED_PASSWORD, detalle(t.slug));
        const form = addon(page).locator("form").first();
        await form.getByLabel("Termina el (opcional)").fill("2020-01-01");
        await form.getByLabel("Motivo de la activación").fill("x");
        await form.getByRole("button", { name: "Activar add-on" }).click();
        await expect(alerta(page)).toContainText("«Termina el» tiene que ser una fecha futura");
        await expect(form.getByLabel("Motivo de la activación")).toHaveValue("x");
        await expect(addon(page).getByTestId("addon-estado")).toContainText("Nunca contratado");
      } finally {
        await limpiarAuditoria(t.orgId);
        await t.cleanup();
      }
    });

    test("a 390 px la sección de add-ons, vigente y con el formulario de finalizar abierto, no desborda", async ({ page }) => {
      const t = await createTenant("adm-addon-ancho");
      try {
        await conPlan(t.orgId, "premium");
        const r = await service().rpc("admin_set_addon", {
          p_actor: "a0000000-0000-4000-8000-000000000008",
          p_org: t.orgId,
          p_addon: ADDON,
          p_extra_packs: 50,
          p_ends_at: null as unknown as string,
          p_reason: "M".repeat(200),
        });
        expect(r.error).toBeNull();
        await login(page, ADMIN_EMAIL, SEED_PASSWORD, detalle(t.slug));
        await expect(addon(page).getByTestId("addon-estado")).toContainText("cupo de 515");
        await page.locator("summary", { hasText: "Finalizar Ensayo" }).click();
        await expectNoHorizontalOverflow(page);
      } finally {
        await limpiarAuditoria(t.orgId);
        await t.cleanup();
      }
    });
  });
});

test.describe("baja de la organización", () => {
  test("dar de baja exige confirmar; cierra la carta y el acceso del local sin borrar nada; reactivar lo devuelve", async ({ page, browser }) => {
    const t = await createTenant("adm-baja");
    try {
      const publico = await browser.newPage();
      expect((await publico.goto(`/m/${t.slug}/centro`))?.status()).toBe(200);

      const dueno = await browser.newPage();
      await login(dueno, t.owner.email, t.owner.password, `/panel/${t.slug}`);
      await expect(dueno).toHaveURL(new RegExp(`/panel/${t.slug}`));

      await login(page, ADMIN_EMAIL, SEED_PASSWORD, detalle(t.slug));
      const baja = seccion(page, "seccion-baja").locator("form");
      await expect(page.getByTestId("aviso-baja")).toContainText("Es distinto de suspender");
      await baja.getByLabel("Motivo de la baja").fill("Cierra el local");
      // La casilla de confirmación es obligatoria: sin ella el navegador no envía el formulario.
      await baja.getByRole("button", { name: "Dar de baja la organización" }).click();
      await expect(baja.getByRole("status")).toHaveCount(0);
      await baja.getByRole("checkbox").check();
      await baja.getByRole("button", { name: "Dar de baja la organización" }).click();
      await expect(baja.getByRole("status")).toContainText("quedó dada de baja");

      await expect(page.getByTestId("estado-organizacion")).toContainText("inactiva");
      await expect(page.getByTestId("auditoria").filter({ hasText: "Baja de la organización" })).toContainText("motivo: Cierra el local");
      await expect(seccion(page, "seccion-baja").getByRole("heading")).toHaveText("Reactivar la organización");

      // El público ya no la ve.
      expect((await publico.goto(`/m/${t.slug}/centro`))?.status()).toBe(404);
      // El Dueño y el Staff no entran: el panel y la sala dan 404.
      expect((await dueno.goto(`/panel/${t.slug}`))?.status()).toBe(404);
      expect((await dueno.goto(`/panel/${t.slug}/carta`))?.status()).toBe(404);
      await dueno.goto("/panel");
      await expect(dueno.getByRole("heading", { name: "Tu cuenta no tiene ningún local" })).toBeVisible();
      await expect(dueno.getByText("puede haber sido dado de baja")).toBeVisible();

      const personal = await browser.newPage();
      await login(personal, t.staff.email, t.staff.password, "/panel");
      expect((await personal.goto(`/sala/${t.slug}`))?.status()).toBe(404);
      await personal.close();

      // No se borró nada.
      const filas = await service().from("organizations").select("is_active").eq("id", t.orgId).single();
      expect(filas.data?.is_active).toBe(false);
      expect((await service().from("branches").select("id").eq("organization_id", t.orgId)).data).toHaveLength(1);

      // Reactivar: sin casilla; el local vuelve entero.
      const alta = seccion(page, "seccion-baja").locator("form");
      await alta.getByLabel("Motivo de la reactivación").fill("Reabrió");
      await alta.getByRole("button", { name: "Reactivar la organización" }).click();
      await expect(alta.getByRole("status")).toContainText("está activa otra vez");
      await expect(page.getByTestId("estado-organizacion")).not.toContainText("inactiva");
      expect((await publico.goto(`/m/${t.slug}/centro`))?.status()).toBe(200);
      expect((await dueno.goto(`/panel/${t.slug}`))?.status()).toBe(200);
      await dueno.close();
      await publico.close();
    } finally {
      await limpiarAuditoria(t.orgId);
      await t.cleanup();
    }
  });

  test("a 390 px la sección de baja, con el motivo más largo, no desborda", async ({ page }) => {
    const t = await createTenant("adm-baja-ancho");
    try {
      await login(page, ADMIN_EMAIL, SEED_PASSWORD, detalle(t.slug));
      await seccion(page, "seccion-baja").locator("form").getByLabel("Motivo de la baja").fill("M".repeat(200));
      await expectNoHorizontalOverflow(page);
    } finally {
      await t.cleanup();
    }
  });
});

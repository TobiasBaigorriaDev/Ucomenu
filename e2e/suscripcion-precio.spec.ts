import { expect, test } from "@playwright/test";
import { purgeAuditLogWhere, purgeOrgRecordsWhere } from "../tests/rls/purge-price-history";
import { createTenant, expectNoHorizontalOverflow, login, service, type Tenant } from "./support";

/**
 * Lo que el Dueño paga (ficha precio-en-suscripcion) contra el build y el Supabase local, a 390 px: el precio de lista de su plan por
 * mes o por año según su ciclo, las sucursales adicionales aparte (otra moneda, sin sumar), el último pago y la prueba gratuita sin costo.
 */

const ADMIN_ID = "a0000000-0000-4000-8000-000000000008"; // SuperAdmin del seed
const DIA_MS = 24 * 60 * 60 * 1000;
const tenants: Tenant[] = [];

test.afterAll(async () => {
  for (const t of tenants) {
    purgeOrgRecordsWhere(`o.id = '${t.orgId}'`);
    purgeAuditLogWhere(`organization_id = '${t.orgId}'`);
    await t.cleanup();
  }
});

/** Compara con espacios comunes: `Intl` usa un espacio duro entre la moneda y el número. */
const plain = (texto: string | null) => (texto ?? "").replace(/ /g, " ");

async function local(label: string, plan: "basic" | "pro", cycle: "monthly" | "yearly") {
  const t = await createTenant(label, "active");
  tenants.push(t);
  await service().from("subscriptions").update({ plan_code: plan, billing_cycle: cycle }).eq("organization_id", t.orgId);
  return t;
}

test.describe("Suscripción: lo que paga el Dueño", () => {
  test("plan Pro anual: precio por año y último pago; sin desborde a 390 px", async ({ browser }) => {
    const t = await local("precio-anual", "pro", "yearly");
    const pago = await service().rpc("admin_register_payment", {
      p_actor: ADMIN_ID,
      p_org: t.orgId,
      p_amount_cents: 2_000_000,
      p_currency: "ARS",
      p_method: "transfer",
      p_reference: "op-precio",
      p_paid_on: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date()),
      p_covers_until: new Date(Date.now() + 30 * DIA_MS).toISOString(),
    });
    expect(pago.error).toBeNull();

    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/panel/${t.slug}/suscripcion`);
    await expect(page.getByTestId("suscripcion-precio-valor")).toHaveText(/US\$\s?380 USD por año/);
    await expect(page.getByTestId("suscripcion-precio-linea")).toHaveCount(0);
    expect(plain(await page.getByTestId("suscripcion-ultimo-pago").textContent())).toContain("$ 20.000 ARS");
    await expect(page.getByTestId("suscripcion-precio-nota")).toContainText("precios de lista");
    await expectNoHorizontalOverflow(page);
    await context.close();
  });

  test("plan Pro mensual con sucursales adicionales: el plan en USD y las adicionales en ARS, cada una en su línea", async ({ page }) => {
    const t = await local("precio-adicionales", "pro", "monthly");
    const alta = await service().from("subscription_addons").insert({ organization_id: t.orgId, addon_code: "extra_branch", extra_packs: 2 });
    expect(alta.error).toBeNull();
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/panel/${t.slug}/suscripcion`);
    await expect(page.getByTestId("suscripcion-precio-valor")).toHaveText(/US\$\s?40 USD por mes/);
    expect(plain(await page.getByTestId("suscripcion-precio-linea").textContent())).toBe("Más $ 24.000 ARS por mes por 2 sucursales adicionales.");
    await expect(page.getByTestId("suscripcion-ultimo-pago")).toHaveCount(0);
  });

  test("en la prueba gratuita no cuesta nada y dice qué viene después", async ({ page }) => {
    const t = await local("precio-prueba", "basic", "monthly");
    const fin = new Date(Date.now() + 5 * DIA_MS).toISOString();
    await service().from("subscriptions").update({ trial_ends_at: fin, current_period_end: null }).eq("organization_id", t.orgId);
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/panel/${t.slug}/suscripcion`);
    await expect(page.getByTestId("suscripcion-precio-valor")).toHaveText("Sin costo durante la prueba");
    expect(plain(await page.getByTestId("suscripcion-precio-linea").first().textContent())).toBe("Después de la prueba: US$ 20 USD por mes.");
  });

  test("el Personal no ve ningún precio", async ({ page }) => {
    const t = await local("precio-staff", "pro", "monthly");
    await login(page, t.staff.email, t.staff.password);
    await page.goto(`/panel/${t.slug}/suscripcion`);
    await expect(page.getByTestId("suscripcion-precio")).toHaveCount(0);
    await expect(page.getByTestId("suscripcion-precio-valor")).toHaveCount(0);
    await expect(page.getByText("US$")).toHaveCount(0);
  });
});

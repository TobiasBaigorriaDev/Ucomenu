import { expect, test } from "@playwright/test";
import { purgeAuditLogWhere, purgeOrgRecordsWhere } from "../tests/rls/purge-price-history";
import { createTenant, expectNoHorizontalOverflow, login, service, type Tenant } from "./support";

/**
 * El Dueño lee los pagos y el historial de cambios de su cuenta (nivel C; ficha dueno-lee-pagos-y-auditoria, ADR 0021),
 * contra el build y el Supabase local, a 390 px. Los movimientos los hace el SuperAdmin del seed por las mismas funciones
 * de base que usa `/admin`; la pantalla solo los lee.
 */

const ADMIN_ID = "a0000000-0000-4000-8000-000000000008"; // SuperAdmin del seed
const DIA_MS = 24 * 60 * 60 * 1000;
const MOTIVO_INTERNO = "nota-interna-e2e-no-visible";
const REFERENCIA = "op-e2e-visible-7731";

const tenants: Tenant[] = [];

test.afterAll(async () => {
  for (const t of tenants) {
    purgeOrgRecordsWhere(`o.id = '${t.orgId}'`);
    purgeAuditLogWhere(`organization_id = '${t.orgId}'`);
    await t.cleanup();
  }
});

const enDias = (dias: number) => new Date(Date.now() + dias * DIA_MS).toISOString();
const hoyAr = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());

async function pagar(t: Tenant, dias: number, cents: number) {
  const { error } = await service().rpc("admin_register_payment", {
    p_actor: ADMIN_ID,
    p_org: t.orgId,
    p_amount_cents: cents,
    p_currency: "ARS",
    p_method: "transfer",
    p_reference: REFERENCIA,
    p_paid_on: hoyAr(),
    p_covers_until: enDias(dias),
  });
  expect(error).toBeNull();
}

async function local(label: string, conHistoria = true) {
  const t = await createTenant(label, "active");
  tenants.push(t);
  await service().from("subscriptions").update({ plan_code: "pro" }).eq("organization_id", t.orgId);
  if (conHistoria) {
    await pagar(t, 30, 2_000_000);
    const plan = await service().rpc("admin_change_plan", { p_actor: ADMIN_ID, p_org: t.orgId, p_plan: "premium", p_billing_cycle: "yearly", p_reason: MOTIVO_INTERNO });
    expect(plan.error).toBeNull();
    const suspende = await service().rpc("admin_set_suspension", { p_actor: ADMIN_ID, p_org: t.orgId, p_suspend: true, p_reason: MOTIVO_INTERNO });
    expect(suspende.error).toBeNull();
    const reactiva = await service().rpc("admin_set_suspension", { p_actor: ADMIN_ID, p_org: t.orgId, p_suspend: false, p_reason: MOTIVO_INTERNO });
    expect(reactiva.error).toBeNull();
  }
  return t;
}

test.describe("Suscripción: pagos y historial", () => {
  test("el Dueño ve sus pagos y el historial, sin el motivo interno ni quién del equipo actuó, y la página cabe en 390 px", async ({ browser }) => {
    const t = await local("cuenta-lee");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/panel/${t.slug}/suscripcion`);
    await expect(page.getByRole("heading", { name: "Suscripción" })).toBeVisible();

    const pagos = page.getByTestId("pago");
    await expect(pagos).toHaveCount(1);
    await expect(pagos.first()).toContainText(/\$\s?20\.000\s?ARS/);
    await expect(pagos.first()).toContainText("Transferencia");
    await expect(pagos.first()).toContainText(`Referencia: ${REFERENCIA}`);
    await expect(pagos.first()).toContainText("Recibido el");

    const cambios = page.getByTestId("cambio");
    await expect(cambios).toHaveCount(4);
    // El más nuevo primero.
    await expect(cambios.nth(0)).toContainText("Cuenta reactivada por UcoMenu");
    await expect(cambios.nth(1)).toContainText("Cuenta suspendida por UcoMenu");
    await expect(cambios.nth(2)).toContainText("Cambio de plan");
    await expect(cambios.nth(2)).toContainText("De Pro, mensual a Premium, anual");
    await expect(cambios.nth(3)).toContainText("Pago registrado");
    for (const c of await cambios.all()) await expect(c).toContainText("Equipo de UcoMenu");

    // Lo que no debe verse: el motivo interno, el email de quien actuó, ids.
    const html = await page.content();
    for (const prohibido of [MOTIVO_INTERNO, "admin@ucomenu.test", ADMIN_ID, "registered_by", "actor_email"]) {
      expect(html.includes(prohibido), `no debería aparecer «${prohibido}»`).toBe(false);
    }
    await expectNoHorizontalOverflow(page);
    await context.close();
  });

  test("sin movimientos, cada sección dice que todavía no hay nada", async ({ browser }) => {
    const t = await local("cuenta-vacia", false);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/panel/${t.slug}/suscripcion`);
    await expect(page.getByTestId("pagos-vacio")).toHaveText("Todavía no hay pagos registrados.");
    await expect(page.getByTestId("historial-vacio")).toBeVisible();
    await expect(page.getByTestId("pagos-mas")).toHaveCount(0);
    await context.close();
  });

  test("el Staff no entra a la Suscripción ni ve pagos o historial; otro Dueño no ve lo de este local", async ({ browser }) => {
    const t = await local("cuenta-ajeno");
    const otro = await local("cuenta-otro", false);

    const staff = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const paginaStaff = await staff.newPage();
    await login(paginaStaff, t.staff.email, t.staff.password);
    await paginaStaff.goto(`/panel/${t.slug}/suscripcion`);
    await expect(paginaStaff.getByTestId("pago")).toHaveCount(0);
    await expect(paginaStaff.getByTestId("cambio")).toHaveCount(0);
    await expect(paginaStaff.getByTestId("pagos")).toHaveCount(0);
    await staff.close();

    // El Dueño de otro local pidiendo ESTE local: la página lo devuelve a lo suyo y no muestra nada ajeno.
    const ajeno = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const paginaAjena = await ajeno.newPage();
    await login(paginaAjena, otro.owner.email, otro.owner.password);
    await paginaAjena.goto(`/panel/${t.slug}/suscripcion`);
    await expect(paginaAjena.getByTestId("pago")).toHaveCount(0);
    await expect(paginaAjena.getByTestId("cambio")).toHaveCount(0);
    await ajeno.close();
  });

  test("«Ver más» pagina los pagos sin repetir y el cursor inválido se ignora", async ({ browser }) => {
    const t = await local("cuenta-paginas", false);
    // 26 pagos: una página de 24 y una segunda con 2. Cada uno cubre más que el anterior (la base no deja repetir la vigencia).
    for (let i = 1; i <= 26; i += 1) await pagar(t, 30 + i * 5, 1_000_000 + i * 100);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/panel/${t.slug}/suscripcion`);

    await expect(page.getByTestId("pago")).toHaveCount(24);
    await expect(page.getByTestId("pago").first()).toContainText(/10\.026/); // el más nuevo primero ($ 10.026)
    await page.getByTestId("pagos-mas").click();
    await expect(page).toHaveURL(/pagos_antes=/);
    await expect(page.getByTestId("pago")).toHaveCount(2);
    await expect(page.getByTestId("pago").first()).toContainText(/10\.002/);
    await expect(page.getByTestId("pagos-mas")).toHaveCount(0);

    // Un cursor inventado se ignora (vuelve a la primera página) y no rompe la pantalla.
    await page.goto(`/panel/${t.slug}/suscripcion?pagos_antes=${encodeURIComponent("1; drop table payments")}&cambios_antes=ayer`);
    await expect(page.getByTestId("pago")).toHaveCount(24);
    await context.close();
  });
});

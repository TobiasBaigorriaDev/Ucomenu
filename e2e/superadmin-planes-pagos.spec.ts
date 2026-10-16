import { expect, test, type Page } from "@playwright/test";
import { purgeAuditLogWhere, purgeOrgRecordsWhere } from "../tests/rls/purge-price-history";
import { SEED_PASSWORD, TEST_PASSWORD, alerta, createTenant, deleteAccountsByEmail, expectNoHorizontalOverflow, login, service } from "./support";

/**
 * SuperAdmin: plan, suspensión y pagos a mano (nivel C, ficha superadmin-planes-pagos), contra el build y el Supabase
 * local, a 390 px. Cada prueba trabaja sobre un local propio (`createTenant`) y lo borra, con sus pagos y su auditoría.
 */

const ADMIN_EMAIL = "admin@ucomenu.test";
const ADMIN_ID = "a0000000-0000-4000-8000-000000000008"; // SuperAdmin del seed
const rand = () => Math.random().toString(36).slice(2, 8);
const DIA_MS = 24 * 60 * 60 * 1000;

const detalle = (slug: string) => `/admin/organizaciones/${slug}`;

/** El formulario que contiene el botón dado: la página tiene tres. */
const formulario = (page: Page, boton: string) => page.locator("form").filter({ has: page.getByRole("button", { name: boton }) });

async function limpiarAuditoria(orgId: string) {
  purgeAuditLogWhere(`organization_id = '${orgId}'`);
}

test.describe("quién puede entrar a la ficha de una organización", () => {
  test("sin sesión pide ingresar; el Dueño y el personal reciben un 404 sin ningún dato", async ({ page }) => {
    const t = await createTenant("adm-acceso");
    try {
      await page.goto(detalle(t.slug));
      await expect(page).toHaveURL(/\/login\?next=/);

      for (const persona of [t.owner, t.staff]) {
        await login(page, persona.email, persona.password, "/panel");
        const respuesta = await page.goto(detalle(t.slug));
        expect(respuesta?.status()).toBe(404);
        await expect(page.getByText(t.name)).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Registrar pago" })).toHaveCount(0);
        await page.goto("/panel");
        await page.getByRole("button", { name: "Salir" }).click();
      }
    } finally {
      await t.cleanup();
    }
  });

  test("el SuperAdmin llega desde la lista y una organización inexistente da 404", async ({ page }) => {
    const t = await createTenant("adm-lista");
    try {
      await login(page, ADMIN_EMAIL, SEED_PASSWORD, "/admin");
      await page.getByTestId("organizacion").filter({ hasText: `(${t.slug})` }).getByRole("link", { name: t.name }).click();
      await expect(page).toHaveURL(new RegExp(`${detalle(t.slug)}$`));
      await expect(page.getByRole("heading", { name: t.name })).toBeVisible();
      await expect(page.getByTestId("suscripcion")).toContainText("Al día");

      expect((await page.goto(detalle("e2e-no-existe-nunca")))?.status()).toBe(404);
    } finally {
      await t.cleanup();
    }
  });
});

test.describe("cambiar el plan", () => {
  test("cambia plan y ciclo con motivo, queda en los movimientos y el Dueño lo ve", async ({ page, browser }) => {
    const t = await createTenant("adm-plan");
    try {
      await login(page, ADMIN_EMAIL, SEED_PASSWORD, detalle(t.slug));
      const form = formulario(page, "Cambiar plan");
      await form.getByLabel("Plan", { exact: true }).selectOption("premium");
      await form.getByLabel("Facturación").selectOption("yearly");
      await form.getByLabel("Motivo del cambio").fill("acuerdo anual");
      await form.getByRole("button", { name: "Cambiar plan" }).click();
      await expect(form.getByRole("status")).toContainText("el plan quedó cambiado");

      // Tras guardar, los selectores muestran lo guardado (no vuelven a los valores del primer montaje): si no, el
      // próximo envío cambiaría solo el ciclo y revertiría el plan en silencio (revisión de Codex).
      await expect(form.getByLabel("Plan", { exact: true })).toHaveValue("premium");
      await expect(form.getByLabel("Facturación")).toHaveValue("yearly");

      await expect(page.getByTestId("suscripcion")).toContainText("Premium");
      await expect(page.getByTestId("suscripcion")).toContainText("anual");
      const movimiento = page.getByTestId("auditoria").filter({ hasText: "Cambio de plan" });
      await expect(movimiento).toContainText("Premium, anual");
      await expect(movimiento).toContainText("motivo: acuerdo anual");
      await expect(movimiento).toContainText(`por ${ADMIN_EMAIL}`);

      // El Dueño lo ve en su pantalla de suscripción.
      const otro = await browser.newPage();
      await login(otro, t.owner.email, t.owner.password, `/panel/${t.slug}/suscripcion`);
      await expect(otro.getByText("Premium", { exact: true })).toBeVisible();
      await expect(otro.getByText("Anual", { exact: true })).toBeVisible();
      await otro.close();
    } finally {
      await limpiarAuditoria(t.orgId);
      await t.cleanup();
    }
  });

  test("sin cambios, el servidor lo dice y no agrega movimientos; lo escrito se conserva", async ({ page }) => {
    const t = await createTenant("adm-igual");
    try {
      await service().from("subscriptions").update({ plan_code: "pro", billing_cycle: "monthly" }).eq("organization_id", t.orgId);
      await login(page, ADMIN_EMAIL, SEED_PASSWORD, detalle(t.slug));
      const form = formulario(page, "Cambiar plan");
      await form.getByLabel("Motivo del cambio").fill("a ver");
      await form.getByRole("button", { name: "Cambiar plan" }).click();
      await expect(alerta(page)).toContainText("Ese ya es el plan");
      await expect(form.getByLabel("Motivo del cambio")).toHaveValue("a ver");
      await expect(page.getByTestId("auditoria").filter({ hasText: "Cambio de plan" })).toHaveCount(0);
    } finally {
      await limpiarAuditoria(t.orgId);
      await t.cleanup();
    }
  });
});

test.describe("suspender y reactivar", () => {
  test("suspender oculta la carta y bloquea la edición; reactivar lo devuelve sin agregar tiempo", async ({ page, browser }) => {
    const t = await createTenant("adm-susp");
    try {
      const publico = await browser.newPage();
      expect((await publico.goto(`/m/${t.slug}/centro`))?.status()).toBe(200);
      await expect(publico.getByText("Carta temporalmente no disponible")).toHaveCount(0);

      await login(page, ADMIN_EMAIL, SEED_PASSWORD, detalle(t.slug));
      const antes = await service().from("subscriptions").select("current_period_end").eq("organization_id", t.orgId).single();
      // El mismo formulario (en la misma posición) pasa de «Suspender» a «Reactivar»: se lo ubica por su sección.
      const suspender = page.locator('section[aria-labelledby="seccion-suspension"] form');
      await suspender.getByLabel("Motivo de la suspensión").fill("pago rechazado");
      await suspender.getByRole("button", { name: "Suspender organización" }).click();
      await expect(suspender.getByRole("status")).toContainText("quedó suspendida");
      await expect(page.getByTestId("suscripcion")).toContainText("Suspendida a mano");
      await expect(page.getByTestId("suscripcion")).toContainText("Según sus fechas");
      await expect(page.getByTestId("auditoria").filter({ hasText: "Suspensión a mano" })).toContainText("motivo: pago rechazado");

      // La carta pública se oculta en el acto y el Dueño ve que la suspendió UcoMenu.
      await publico.goto(`/m/${t.slug}/centro`);
      await expect(publico.getByText("Carta temporalmente no disponible")).toBeVisible();
      const dueno = await browser.newPage();
      await login(dueno, t.owner.email, t.owner.password, `/panel/${t.slug}`);
      await expect(dueno.getByTestId("mora-banner")).toContainText("Tu cuenta fue suspendida por UcoMenu");
      await dueno.goto(`/panel/${t.slug}/suscripcion`);
      await expect(dueno.getByText("Suspendida por UcoMenu", { exact: true })).toBeVisible();

      // Reactivar.
      const reactivar = suspender;
      await reactivar.getByLabel("Motivo de la reactivación").fill("regularizado");
      await reactivar.getByRole("button", { name: "Reactivar organización" }).click();
      await expect(reactivar.getByRole("status")).toContainText("se quitó la suspensión");
      await expect(page.getByTestId("suscripcion")).toContainText("Al día");
      await expect(page.getByTestId("suscripcion")).not.toContainText("Suspendida a mano");
      await publico.goto(`/m/${t.slug}/centro`);
      await expect(publico.getByText("Carta temporalmente no disponible")).toHaveCount(0);
      await dueno.goto(`/panel/${t.slug}`);
      await expect(dueno.getByTestId("mora-banner")).toHaveCount(0);

      const despues = await service().from("subscriptions").select("current_period_end").eq("organization_id", t.orgId).single();
      expect(despues.data?.current_period_end).toBe(antes.data?.current_period_end);
      await publico.close();
      await dueno.close();
    } finally {
      await limpiarAuditoria(t.orgId);
      await t.cleanup();
    }
  });

  test("reactivar una cuenta con las fechas vencidas avisa que seguirá en mora", async ({ page }) => {
    const t = await createTenant("adm-susp-mora", "read_only");
    try {
      await service().from("subscriptions").update({ suspended_at: new Date().toISOString() }).eq("organization_id", t.orgId);
      await login(page, ADMIN_EMAIL, SEED_PASSWORD, detalle(t.slug));
      await expect(page.getByTestId("suscripcion")).toContainText("Suspendida a mano");
      await expect(page.getByText("quedará «Vencida, en solo lectura»")).toBeVisible();
    } finally {
      await limpiarAuditoria(t.orgId);
      await t.cleanup();
    }
  });
});

test.describe("registrar un pago", () => {
  test("un pago en gracia restablece la cuenta, queda en el historial y se ve en el panel del Dueño", async ({ page, browser }) => {
    const t = await createTenant("adm-pago", "grace");
    try {
      await login(page, ADMIN_EMAIL, SEED_PASSWORD, detalle(t.slug));
      await expect(page.getByTestId("suscripcion")).toContainText("Vencida, en período de gracia");

      const form = formulario(page, "Registrar pago");
      await form.getByLabel("Importe").fill("20.000,50");
      await form.getByLabel("Moneda").selectOption("ARS");
      await form.getByLabel("Cómo se pagó").selectOption("transfer");
      await form.getByLabel("Referencia (opcional)").fill("op-12345");
      // La fecha del pago propone hoy y «cubre hasta» un ciclo después del día de hoy (ya venció).
      await expect(form.getByLabel("Fecha del pago")).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
      await expect(form.getByLabel("Cubre hasta")).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
      const cubreHasta = await form.getByLabel("Cubre hasta").inputValue();
      await form.getByRole("button", { name: "Registrar pago" }).click();
      await expect(form.getByRole("status")).toContainText("el pago quedó registrado");

      await expect(page.getByTestId("suscripcion")).toContainText("Al día");
      const pago = page.getByTestId("pago");
      await expect(pago).toHaveCount(1);
      await expect(pago).toContainText("20.000,50");
      await expect(pago).toContainText("ARS");
      await expect(pago).toContainText("Transferencia");
      await expect(pago).toContainText("op-12345");
      await expect(page.getByTestId("auditoria").filter({ hasText: "Pago registrado" })).toContainText(`por ${ADMIN_EMAIL}`);
      // La referencia no se copia a los movimientos.
      await expect(page.getByTestId("auditoria").filter({ hasText: "Pago registrado" })).not.toContainText("op-12345");

      // El Dueño sale de la gracia: sin aviso de mora.
      const dueno = await browser.newPage();
      await login(dueno, t.owner.email, t.owner.password, `/panel/${t.slug}/suscripcion`);
      await expect(dueno.getByText("Al día")).toBeVisible();
      await dueno.goto(`/panel/${t.slug}`);
      await expect(dueno.getByTestId("mora-banner")).toHaveCount(0);
      await dueno.close();

      // Reenviar lo mismo (doble clic, o recargar y repetir) no duplica nada.
      const segunda = formulario(page, "Registrar pago");
      await segunda.getByLabel("Importe").fill("20000");
      await segunda.getByLabel("Moneda").selectOption("ARS");
      await segunda.getByLabel("Cómo se pagó").selectOption("transfer");
      await segunda.getByLabel("Cubre hasta").fill(cubreHasta);
      await segunda.getByRole("button", { name: "Registrar pago" }).click();
      // Ya cubre hasta esa fecha: la propuesta nueva sería un ciclo más, pero repetir la misma fecha se rechaza.
      await expect(alerta(page)).toContainText("posterior al vencimiento actual");
      await expect(page.getByTestId("pago")).toHaveCount(1);
    } finally {
      await limpiarAuditoria(t.orgId);
      await t.cleanup();
    }
  });

  test("datos inválidos o una fecha que no extiende se rechazan con un mensaje claro y no registran nada", async ({ page }) => {
    const t = await createTenant("adm-pago-mal", "active");
    try {
      await login(page, ADMIN_EMAIL, SEED_PASSWORD, detalle(t.slug));
      const form = formulario(page, "Registrar pago");
      await form.getByLabel("Importe").fill("cero");
      await form.getByLabel("Moneda").selectOption("USD");
      await form.getByLabel("Cómo se pagó").selectOption("cash");
      await form.getByRole("button", { name: "Registrar pago" }).click();
      await expect(alerta(page)).toContainText("Revisá el importe");
      await expect(form.getByLabel("Importe")).toHaveValue("cero"); // lo escrito se conserva

      // Una fecha anterior al vencimiento actual (cuenta al día, vence en 5 días) no se acepta.
      await form.getByLabel("Importe").fill("20");
      await form.getByLabel("Cubre hasta").fill(new Date(Date.now() + 2 * DIA_MS).toISOString().slice(0, 10));
      await form.getByRole("button", { name: "Registrar pago" }).click();
      await expect(alerta(page)).toContainText("posterior al vencimiento actual");

      // Fecha del pago en el futuro.
      await form.getByLabel("Cubre hasta").fill(new Date(Date.now() + 40 * DIA_MS).toISOString().slice(0, 10));
      await form.getByLabel("Fecha del pago").fill(new Date(Date.now() + 3 * DIA_MS).toISOString().slice(0, 10));
      await form.getByRole("button", { name: "Registrar pago" }).click();
      await expect(alerta(page)).toContainText("Fecha del pago");

      await expect(page.getByTestId("pago")).toHaveCount(0);
      const pagos = await service().from("payments").select("id").eq("organization_id", t.orgId);
      expect(pagos.data).toEqual([]);
    } finally {
      await limpiarAuditoria(t.orgId);
      await t.cleanup();
    }
  });
});

test.describe("la prueba gratuita", () => {
  test("se ve como prueba (no como mora), el pago la convierte en período propio y el Dueño ve cada etapa", async ({ page, browser }) => {
    const t = await createTenant("adm-prueba");
    try {
      const db = service();
      const fin = new Date(Date.now() + 9 * DIA_MS).toISOString();
      await db.from("subscriptions").update({ current_period_end: null, trial_ends_at: fin, plan_code: "basic" }).eq("organization_id", t.orgId);

      await login(page, ADMIN_EMAIL, SEED_PASSWORD, detalle(t.slug));
      await expect(page.getByTestId("suscripcion")).toContainText("En prueba gratuita");
      await expect(page.getByTestId("suscripcion")).toContainText("Al día");
      await expect(page.getByText("la organización está en prueba", { exact: false })).toBeVisible();
      await page.goto("/admin");
      await expect(page.getByTestId("organizacion").filter({ hasText: `(${t.slug})` })).toContainText("En prueba gratuita");

      const dueno = await browser.newPage();
      await login(dueno, t.owner.email, t.owner.password, `/panel/${t.slug}/suscripcion`);
      await expect(dueno.getByText("En prueba gratuita")).toBeVisible();

      // Prueba vencida hace 3 días: «Prueba vencida» y, aparte, la gracia de mora.
      await db.from("subscriptions").update({ trial_ends_at: new Date(Date.now() - 3 * DIA_MS + 3_600_000).toISOString() }).eq("organization_id", t.orgId);
      await page.goto(detalle(t.slug));
      await expect(page.getByTestId("suscripcion")).toContainText("Prueba vencida");
      await expect(page.getByTestId("suscripcion")).toContainText("Vencida, en período de gracia");
      await dueno.goto(`/panel/${t.slug}/suscripcion`);
      await expect(dueno.getByText("Prueba vencida")).toBeVisible();

      // Un pago la convierte en período propio.
      const form = formulario(page, "Registrar pago");
      await form.getByLabel("Importe").fill("20");
      await form.getByLabel("Moneda").selectOption("USD");
      await form.getByLabel("Cómo se pagó").selectOption("other");
      await form.getByRole("button", { name: "Registrar pago" }).click();
      await expect(form.getByRole("status")).toContainText("el pago quedó registrado");
      await expect(page.getByTestId("suscripcion")).toContainText("Ya pasó a un período propio");
      await expect(page.getByTestId("suscripcion")).toContainText("Al día");
      await dueno.close();
    } finally {
      await limpiarAuditoria(t.orgId);
      await t.cleanup();
    }
  });
});

test.describe("a 390 px", () => {
  test("la ficha con un identificador de 64 caracteres, una referencia larga y todo lo registrado no desborda", async ({ page }) => {
    const slug = `e2e-adm-${rand()}${"x".repeat(64)}`.slice(0, 64);
    const email = `e2e-adm-${rand()}@example.test`;
    const db = service();
    const org = await db.from("organizations").insert({ slug, name: "N".repeat(80) }).select("id").single();
    if (org.error) throw new Error(org.error.message);
    const orgId = org.data.id;
    try {
      const creada = await db.auth.admin.createUser({ email, password: TEST_PASSWORD, email_confirm: true });
      await db.from("memberships").insert({ user_id: creada.data.user!.id, organization_id: orgId, role: "owner" });
      await db.from("subscriptions").update({ current_period_end: new Date(Date.now() + 3 * DIA_MS).toISOString(), trial_ends_at: null }).eq("organization_id", orgId);
      const rpc = await db.rpc("admin_register_payment", {
        p_actor: ADMIN_ID,
        p_org: orgId,
        p_amount_cents: 99_999_999_999,
        p_currency: "ARS",
        p_method: "payment_link",
        p_reference: "R".repeat(120),
        p_paid_on: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date()),
        p_covers_until: new Date(Date.now() + 40 * DIA_MS).toISOString(),
      });
      expect(rpc.error).toBeNull();
      await db.rpc("admin_set_suspension", { p_actor: ADMIN_ID, p_org: orgId, p_suspend: true, p_reason: "M".repeat(200) });

      await login(page, ADMIN_EMAIL, SEED_PASSWORD, detalle(slug));
      await expect(page.getByTestId("pago")).toHaveCount(1);
      await expect(page.getByTestId("auditoria").first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.goto("/admin");
      await expect(page.getByTestId("organizacion").filter({ hasText: slug })).toContainText("Suspendida a mano");
      await expectNoHorizontalOverflow(page);
    } finally {
      purgeOrgRecordsWhere(`o.id = '${orgId}'`);
      purgeAuditLogWhere(`organization_id = '${orgId}'`);
      await db.from("organizations").delete().eq("id", orgId);
      await deleteAccountsByEmail([email]);
    }
  });

  test("la ficha de un local común cabe en 390 px", async ({ page }) => {
    const t = await createTenant("adm-ancho", "grace");
    try {
      await login(page, ADMIN_EMAIL, SEED_PASSWORD, detalle(t.slug));
      await expect(page.getByRole("heading", { name: "Registrar un pago" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    } finally {
      await t.cleanup();
    }
  });
});

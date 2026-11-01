import { randomInt } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { signMercadoPagoNotification } from "../src/lib/cobro/firma";
import { purgeAuditLogWhere, purgeOrgRecordsWhere } from "../tests/rls/purge-price-history";
import { E2E_MP, stubPayment, stubPreference } from "./mp-stub";
import { SEED_PASSWORD, createTenant, expectNoHorizontalOverflow, login, service, type Tenant } from "./support";

/**
 * Cobro con link de Mercado Pago (nivel C, ficha cobro-con-link-de-mercado-pago, ADR 0052) contra el build y el Supabase local, a 390 px.
 * Mercado Pago es un servidor de mentira local (`e2e/mp-stub.ts`): el navegador del Dueño llega a su «checkout» y los avisos se mandan
 * firmados desde la prueba, como los mandaría Mercado Pago. La API real se probó aparte (ver la ficha).
 */

const ADMIN_EMAIL = "admin@ucomenu.test";
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
const suscripcion = (slug: string) => `/panel/${slug}/suscripcion`;
const nuevoPagoId = () => String(randomInt(100_000_000, 999_999_999));

async function local(label: string) {
  const t = await createTenant(label, "active");
  tenants.push(t);
  await service().from("subscriptions").update({ plan_code: "pro", billing_cycle: "monthly" }).eq("organization_id", t.orgId);
  return t;
}

const pagos = async (orgId: string) => (await service().from("payments").select("*").eq("organization_id", orgId)).data ?? [];
const vencimiento = async (orgId: string) => new Date((await service().from("subscriptions").select("current_period_end").eq("organization_id", orgId).single()).data!.current_period_end!).getTime();

/** El Dueño pulsa «Pagar» y llega al checkout de mentira: devuelve lo que la app le mandó a Mercado Pago. */
async function pagar(page: Page, slug: string) {
  await page.goto(suscripcion(slug));
  await page.getByRole("button", { name: "Pagar con Mercado Pago" }).click();
  await page.waitForURL(/127\.0\.0\.1:\d+\/checkout\/pref-stub-/);
  const prefId = new URL(page.url()).pathname.split("/").pop()!;
  const pref = await stubPreference(prefId);
  const items = pref.body.items as { unit_price: number }[];
  return { reference: String(pref.body.external_reference), amountCents: Math.round(items[0].unit_price * 100), pref };
}

/** Manda un aviso firmado, como lo haría Mercado Pago. */
async function aviso(
  request: APIRequestContext,
  paymentId: string,
  opciones: { firma?: string | null; secreto?: string; ts?: number; query?: string; requestId?: string } = {},
) {
  const requestId = opciones.requestId ?? `req-${paymentId}`;
  const ts = opciones.ts ?? Date.now();
  const firma = opciones.firma === undefined ? signMercadoPagoNotification({ dataId: paymentId, requestId, ts }, opciones.secreto ?? E2E_MP.webhookSecret) : opciones.firma;
  const query = opciones.query ?? `data.id=${paymentId}&type=payment`;
  return request.post(`/api/mercadopago/webhook?${query}`, {
    data: Buffer.from(JSON.stringify({ action: "payment.updated", data: { id: paymentId }, type: "payment" }), "utf8"),
    headers: { "Content-Type": "application/json", "x-request-id": requestId, ...(firma === null ? {} : { "x-signature": firma }) },
  });
}

test.describe("el Dueño paga con Mercado Pago", () => {
  test("«Pagar» lleva al checkout con el importe de la base y el aviso firmado renueva la suscripción una sola vez", async ({ page, request }) => {
    const t = await local("mp-pagar");
    const antes = await vencimiento(t.orgId);
    await login(page, t.owner.email, t.owner.password);
    await page.goto(suscripcion(t.slug));
    expect(plain(await page.getByTestId("pagar-total").textContent())).toContain("$ 29.000 ARS");
    await expect(page.getByTestId("pagar-total")).toContainText("por mes");
    await expect(page.getByTestId("pagar-desglose")).toContainText("Plan Pro mensual");
    await expectNoHorizontalOverflow(page);

    const { reference, amountCents, pref } = await pagar(page, t.slug);
    // Lo que viajó a Mercado Pago: el importe de la base, la intención como referencia, el aviso firmado y el regreso a Suscripción.
    expect(amountCents).toBe(2_900_000);
    expect(pref.body).toMatchObject({ external_reference: reference, expires: true });
    expect((pref.body.items as { currency_id: string; quantity: number }[])[0]).toMatchObject({ currency_id: "ARS", quantity: 1 });
    expect(String(pref.body.notification_url)).toMatch(/\/api\/mercadopago\/webhook\?source_news=webhooks$/);
    expect(JSON.stringify(pref.body)).not.toMatch(/payer|email/);
    expect((pref.body.back_urls as { success: string }).success).toContain(`${suscripcion(t.slug)}?pago=exito`);

    // Pedir el link otra vez reutiliza el mismo (misma intención, una sola pendiente).
    await page.goto(suscripcion(t.slug));
    await expect(page.getByTestId("pagar-pendiente")).toBeVisible();
    const otra = await pagar(page, t.slug);
    expect(otra.reference).toBe(reference);

    // Mercado Pago aprueba el pago y avisa.
    const id = nuevoPagoId();
    await stubPayment({ id, externalReference: reference, amountCents });
    const respuesta = await aviso(request, id);
    expect(respuesta.status()).toBe(200);
    expect(await respuesta.json()).toMatchObject({ received: true, outcome: "registered" });
    expect(await pagos(t.orgId)).toHaveLength(1);
    const despues = await vencimiento(t.orgId);
    expect(despues - antes).toBeGreaterThan(27 * DIA_MS);
    expect(despues - antes).toBeLessThan(32 * DIA_MS);

    // El mismo aviso otra vez no vuelve a renovar.
    expect((await (await aviso(request, id)).json()).outcome).toBe("already_registered");
    expect(await pagos(t.orgId)).toHaveLength(1);
    expect(await vencimiento(t.orgId)).toBe(despues);

    // El Dueño ve el resultado: pago registrado, vencimiento nuevo y nada más que pagar por ahora.
    await page.goto(`${suscripcion(t.slug)}?pago=exito`);
    await expect(page.getByTestId("pagar-aviso")).toContainText("Volviste de Mercado Pago");
    await expect(page.getByTestId("pagar-cubierto")).toContainText("por adelantado");
    await expect(page.getByTestId("pagar-total")).toHaveCount(0);
    await expect(page.getByTestId("pago")).toHaveCount(1);
    await expect(page.getByTestId("pago").first()).toContainText("$ 29.000");
    await expectNoHorizontalOverflow(page);
  });

  test("«Ya pagué, verificar» registra el pago aunque el aviso no haya llegado", async ({ page }) => {
    const t = await local("mp-verificar");
    await login(page, t.owner.email, t.owner.password);
    const { reference, amountCents } = await pagar(page, t.slug);

    await page.goto(suscripcion(t.slug));
    // Todavía no pagó: no se registra nada.
    await page.getByRole("button", { name: "Ya pagué, verificar" }).click();
    await expect(page.getByText("Todavía no vemos el pago aprobado")).toBeVisible();
    expect(await pagos(t.orgId)).toHaveLength(0);

    await stubPayment({ id: nuevoPagoId(), externalReference: reference, amountCents });
    await page.getByRole("button", { name: "Ya pagué, verificar" }).click();
    await expect(page.getByTestId("pagar-aviso")).toContainText("Registramos tu pago");
    await expect(page).toHaveURL(/pago=registrado/);
    expect(await pagos(t.orgId)).toHaveLength(1);
    // Con la suscripción al día ya no hay link pendiente que verificar.
    await expect(page.getByRole("button", { name: "Ya pagué, verificar" })).toHaveCount(0);
  });

  test("el Personal no ve el pago ni puede pedirlo", async ({ page }) => {
    const t = await local("mp-staff");
    await login(page, t.staff.email, t.staff.password);
    await page.goto(suscripcion(t.slug));
    await expect(page.getByTestId("pagar")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Pagar con Mercado Pago" })).toHaveCount(0);
  });

  test("con la suscripción suspendida a mano no se ofrece pagar", async ({ page }) => {
    const t = await local("mp-suspendida");
    await service().from("subscriptions").update({ suspended_at: new Date().toISOString() }).eq("organization_id", t.orgId);
    await login(page, t.owner.email, t.owner.password);
    await page.goto(suscripcion(t.slug));
    await expect(page.getByRole("button", { name: "Pagar con Mercado Pago" })).toHaveCount(0);
  });

  test("el aviso de regreso «fallo» dice que no se cobró nada", async ({ page }) => {
    const t = await local("mp-fallo");
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`${suscripcion(t.slug)}?pago=fallo`);
    await expect(page.getByTestId("pagar-aviso")).toContainText("No se te cobró nada");
  });
});

test.describe("el aviso (webhook): solo lo firmado y verificado mueve la vigencia", () => {
  test("sin firma, firma ajena, secreto equivocado o firma vieja: 401 y ningún cambio", async ({ page, request }) => {
    const t = await local("mp-firma");
    await login(page, t.owner.email, t.owner.password);
    const { reference, amountCents } = await pagar(page, t.slug);
    const id = nuevoPagoId();
    await stubPayment({ id, externalReference: reference, amountCents });
    const antes = await vencimiento(t.orgId);

    expect((await aviso(request, id, { firma: null })).status()).toBe(401);
    expect((await aviso(request, id, { firma: "ts=1,v1=" + "0".repeat(64) })).status()).toBe(401);
    expect((await aviso(request, id, { secreto: "otro-secreto" })).status()).toBe(401);
    expect((await aviso(request, id, { ts: Date.now() - 3 * DIA_MS })).status()).toBe(401);
    // Firmado para otro pago: el data.id de la URL no coincide con el firmado.
    const ajena = signMercadoPagoNotification({ dataId: nuevoPagoId(), requestId: `req-${id}`, ts: Date.now() }, E2E_MP.webhookSecret);
    expect((await aviso(request, id, { firma: ajena })).status()).toBe(401);

    expect(await pagos(t.orgId)).toHaveLength(0);
    expect(await vencimiento(t.orgId)).toBe(antes);
  });

  test("con firma válida igual se verifica contra la API: un pago que no existe o que no está aprobado no cambia nada", async ({ page, request }) => {
    const t = await local("mp-verifica");
    await login(page, t.owner.email, t.owner.password);
    const { reference, amountCents } = await pagar(page, t.slug);
    const antes = await vencimiento(t.orgId);

    const inexistente = await aviso(request, nuevoPagoId());
    expect(inexistente.status()).toBe(200);
    expect((await inexistente.json()).outcome).toBe("not_found");

    const pendiente = nuevoPagoId();
    await stubPayment({ id: pendiente, externalReference: reference, amountCents, status: "pending" });
    expect((await (await aviso(request, pendiente)).json()).outcome).toBe("ignored_status");

    // Otros tipos de aviso o sin pago: se ignoran con 200 / se rechazan.
    const otroTipo = nuevoPagoId();
    expect((await (await aviso(request, otroTipo, { query: `data.id=${otroTipo}&type=subscription_preapproval` })).json()).outcome).toBe("ignored_type");

    expect(await pagos(t.orgId)).toHaveLength(0);
    expect(await vencimiento(t.orgId)).toBe(antes);
  });
});

test.describe("lo que no cuadra queda a revisar", () => {
  test("un pago por otro importe no renueva y el SuperAdmin lo ve y lo resuelve", async ({ browser, page, request }) => {
    const t = await local("mp-revision");
    await login(page, t.owner.email, t.owner.password);
    const { reference } = await pagar(page, t.slug);
    const antes = await vencimiento(t.orgId);

    const id = nuevoPagoId();
    await stubPayment({ id, externalReference: reference, amountCents: 100_000 });
    expect(await (await aviso(request, id)).json()).toMatchObject({ received: true, outcome: "review" });
    expect(await pagos(t.orgId)).toHaveLength(0);
    expect(await vencimiento(t.orgId)).toBe(antes);

    const contexto = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const admin = await contexto.newPage();
    await login(admin, ADMIN_EMAIL, SEED_PASSWORD, `/admin/organizaciones/${t.slug}`);
    const seccion = admin.getByTestId("pagos-a-revisar");
    await expect(seccion).toBeVisible();
    await expect(seccion.getByTestId("pago-a-revisar")).toHaveCount(1);
    await expect(seccion).toContainText(id);
    await expect(seccion).toContainText("no coincide con el pedido");
    await expectNoHorizontalOverflow(admin);

    await seccion.getByText("Marcar como resuelto").first().click();
    await seccion.getByLabel("Qué se hizo").fill("Reembolsado en Mercado Pago");
    await seccion.getByRole("button", { name: "Marcar como resuelto" }).click();
    // Resuelto, la lista queda vacía y la sección entera desaparece.
    await expect(admin.getByTestId("pagos-a-revisar")).toHaveCount(0);
    await admin.reload();
    await expect(admin.getByTestId("pagos-a-revisar")).toHaveCount(0);
    await contexto.close();
  });
});

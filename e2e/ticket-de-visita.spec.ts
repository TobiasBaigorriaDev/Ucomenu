import { expect, test, type Page } from "@playwright/test";
import { issueVisitTicket, VISIT_TTL_MS } from "../src/lib/llamados/visit-ticket";
import { createTenant, expectNoHorizontalOverflow, login, service, type Tenant } from "./support";

/**
 * Ticket de visita (ficha ticket-de-visita): una pestaña vieja de `/t/{token}` ya no puede avisar, y la sala muestra
 * cuánto hacía que el comensal había escaneado. Contra el build y el Supabase local, a 390 px. El servidor de pruebas
 * usa un secreto fijo (`playwright.config.ts`), así que acá se pueden firmar tickets vencidos o de otra mesa.
 */

const tenants: Tenant[] = [];
const HORA = 60 * 60_000;
const MIN = 60_000;

async function nuevoLocal(label: string) {
  const t = await createTenant(label, "active");
  tenants.push(t);
  const db = service();
  await db.from("subscriptions").update({ plan_code: "pro" }).eq("organization_id", t.orgId);
  const branch = await db.from("branches").select("id").eq("organization_id", t.orgId).single();
  await db.from("categories").insert({ organization_id: t.orgId, name: "Platos" });
  const mesas = await db
    .from("tables")
    .insert([
      { organization_id: t.orgId, branch_id: branch.data!.id, label: "Mesa 1" },
      { organization_id: t.orgId, branch_id: branch.data!.id, label: "Mesa 2" },
    ])
    .select("id, label, qr_token")
    .order("label");
  if (mesas.error) throw new Error(mesas.error.message);
  // Una mesa real existe mucho antes de que alguien la escanee: su turno (ADR 0044) empezó hace días. Estas pruebas fabrican tickets «de hace
  // 3 horas» y «de hace media hora»; sobre una mesa recién creada serían anteriores a su propio nacimiento y se darían por una visita terminada.
  await db.from("tables").update({ turn_started_at: new Date(Date.now() - 2 * 24 * HORA).toISOString() }).eq("branch_id", branch.data!.id);
  return { t, branch: branch.data!.id, mesa1: mesas.data[0], mesa2: mesas.data[1] };
}

test.afterAll(async () => {
  for (const t of tenants) await t.cleanup();
});

const llamadosDe = async (orgId: string) =>
  (await service().from("waiter_calls").select("*").eq("organization_id", orgId).order("created_at")).data ?? [];

const barra = (page: Page) => page.getByTestId("barra-llamado");
const vencida = (page: Page) => page.getByTestId("sesion-vencida");
const llamarAlMozo = (page: Page) => barra(page).getByRole("button", { name: "Llamar al mozo" });
const pedirCuenta = (page: Page) => barra(page).getByRole("button", { name: "Pedir la cuenta" });
const MENSAJE_VENCIDA = "Esta sesión venció";

/** Cambia el ticket que lleva el formulario (como lo haría una pestaña vieja o alguien que lo manipule). */
const ponerTicket = (page: Page, ticket: string | null) =>
  page.locator('input[name="ticket"]').evaluate((el, valor) => {
    if (valor === null) el.remove();
    else (el as HTMLInputElement).value = valor;
  }, ticket);

test.describe("el ticket de visita en la pestaña del comensal", () => {
  test("recién escaneado: llama con normalidad y la base guarda cuándo abrió la carta", async ({ page }) => {
    const { t, mesa1 } = await nuevoLocal("ticket-ok");
    const antes = Date.now();
    await page.goto(`/t/${mesa1.qr_token}`);
    await expect(barra(page)).toBeVisible();
    await expect(vencida(page)).toHaveCount(0);

    await llamarAlMozo(page).click();
    await expect(page.getByTestId("mensaje-llamado")).toContainText("Avisamos al personal");
    const [fila] = await llamadosDe(t.orgId);
    const visita = Date.parse(fila.visit_started_at);
    expect(visita).toBeGreaterThan(antes - 5_000);
    expect(visita).toBeLessThanOrEqual(Date.now() + 1_000);
  });

  test("pasadas 3 horas con la pestaña abierta, los botones se reemplazan por pedir que se escanee de nuevo y no se crea nada", async ({ page }) => {
    const { t, mesa1 } = await nuevoLocal("ticket-reloj");
    await page.clock.install();
    await page.goto(`/t/${mesa1.qr_token}`);
    await expect(llamarAlMozo(page)).toBeVisible();

    await page.clock.fastForward(VISIT_TTL_MS - MIN);
    await expect(llamarAlMozo(page)).toBeVisible(); // todavía vigente

    await page.clock.fastForward(2 * MIN);
    await expect(vencida(page)).toContainText(MENSAJE_VENCIDA);
    await expect(vencida(page)).toHaveAttribute("role", "status");
    await expect(llamarAlMozo(page)).toHaveCount(0);
    await expect(pedirCuenta(page)).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    expect(await llamadosDe(t.orgId)).toHaveLength(0);
  });

  test("la pestaña que vuelve a primer plano ya vencida lo nota (los celulares congelan los temporizadores)", async ({ page }) => {
    const { mesa1 } = await nuevoLocal("ticket-visible");
    await page.clock.install();
    await page.goto(`/t/${mesa1.qr_token}`);
    await expect(llamarAlMozo(page)).toBeVisible();
    // El tiempo pasa sin que corra el temporizador (pantalla apagada) y la pestaña vuelve.
    await page.clock.setSystemTime(Date.now() + VISIT_TTL_MS + 5 * MIN);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(vencida(page)).toContainText(MENSAJE_VENCIDA);
  });

  test("el servidor rechaza un ticket vencido (aunque la pestaña siga mostrando los botones): mismo aviso y nada se crea", async ({ page }) => {
    const { t, mesa1 } = await nuevoLocal("ticket-servidor");
    await page.goto(`/t/${mesa1.qr_token}`);
    await ponerTicket(page, issueVisitTicket(mesa1.qr_token, Date.now() - VISIT_TTL_MS - MIN));
    await llamarAlMozo(page).click();
    await expect(vencida(page)).toContainText(MENSAJE_VENCIDA);
    await expect(llamarAlMozo(page)).toHaveCount(0);
    expect(await llamadosDe(t.orgId)).toHaveLength(0);
  });

  test("un ticket de hace casi 3 horas todavía sirve", async ({ page }) => {
    const { t, mesa1 } = await nuevoLocal("ticket-borde");
    await page.goto(`/t/${mesa1.qr_token}`);
    await ponerTicket(page, issueVisitTicket(mesa1.qr_token, Date.now() - VISIT_TTL_MS + 5 * MIN));
    await pedirCuenta(page).click();
    await expect(page.getByTestId("mensaje-llamado")).toContainText("Pedimos tu cuenta");
    expect(await llamadosDe(t.orgId)).toHaveLength(1);
  });

  test("un ticket de otra mesa, sin ticket, retocado o inventado se rechaza igual y no deja huella", async ({ page }) => {
    const { t, mesa1, mesa2 } = await nuevoLocal("ticket-malos");
    const buenoDeOtra = issueVisitTicket(mesa2.qr_token, Date.now());
    const propio = issueVisitTicket(mesa1.qr_token, Date.now());
    const [segundos, firma] = propio.split(".");
    const intentos: (string | null)[] = [
      buenoDeOtra,
      null,
      "",
      "no-es-un-ticket",
      `${Number(segundos) + 3600}.${firma}`, // «renovado» sin la firma
      `${segundos}.${"0".repeat(32)}`,
    ];
    for (const ticket of intentos) {
      await page.goto(`/t/${mesa1.qr_token}`);
      await ponerTicket(page, ticket);
      await llamarAlMozo(page).click();
      await expect(vencida(page), String(ticket)).toContainText(MENSAJE_VENCIDA);
    }
    expect(await llamadosDe(t.orgId)).toHaveLength(0);
  });

  test("recargar la página emite un ticket nuevo (límite conocido y aceptado: desde afuera es indistinguible de un escaneo)", async ({ page }) => {
    const { t, mesa1 } = await nuevoLocal("ticket-recarga");
    await page.goto(`/t/${mesa1.qr_token}`);
    const primero = await page.locator('input[name="ticket"]').inputValue();
    await page.waitForTimeout(1100); // los tickets llevan segundos: otro segundo, otro ticket
    await page.reload();
    const segundo = await page.locator('input[name="ticket"]').inputValue();
    expect(segundo).not.toBe(primero);
    await llamarAlMozo(page).click();
    await expect(page.getByTestId("mensaje-llamado")).toContainText("Avisamos al personal");
    expect(await llamadosDe(t.orgId)).toHaveLength(1);
  });
});

test.describe("la cuenta atendida cierra la sesión de la mesa (ficha cerrar-sesion-al-atender-la-cuenta)", () => {
  test("la pestaña abierta antes de que el personal atienda la cuenta deja de poder avisar; escanear de nuevo lo permite", async ({ page }) => {
    const { t, branch, mesa1 } = await nuevoLocal("ticket-cuenta");
    await page.goto(`/t/${mesa1.qr_token}`);
    await expect(llamarAlMozo(page)).toBeVisible();
    await ponerTicket(page, issueVisitTicket(mesa1.qr_token, Date.now() - 30 * MIN)); // escaneó hace media hora

    // El personal atiende la cuenta de la mesa (la base marca `attended_at` al pasar a «atendido»).
    const db = service();
    const cuenta = await db
      .from("waiter_calls")
      .insert({ organization_id: t.orgId, branch_id: branch, table_id: mesa1.id, kind: "bill" })
      .select("id")
      .single();
    expect(cuenta.error).toBeNull();
    expect((await db.from("waiter_calls").update({ status: "attended" }).eq("id", cuenta.data!.id)).error).toBeNull();

    // Dentro de los 10 minutos de gracia la pestaña todavía llama (quien pidió la cuenta puede seguir pidiendo).
    await llamarAlMozo(page).click();
    await expect(page.getByTestId("mensaje-llamado")).toContainText("Avisamos al personal");
    await db.from("waiter_calls").delete().eq("table_id", mesa1.id).eq("kind", "waiter");

    // Pasada la gracia (la atención fue hace 11 minutos) la pestaña vieja todavía muestra los botones, pero la acción
    // responde lo mismo que con un ticket vencido.
    expect((await db.from("waiter_calls").update({ attended_at: new Date(Date.now() - 11 * MIN).toISOString() }).eq("id", cuenta.data!.id)).error).toBeNull();
    await page.reload();
    await ponerTicket(page, issueVisitTicket(mesa1.qr_token, Date.now() - 30 * MIN));
    await llamarAlMozo(page).click();
    await expect(vencida(page)).toContainText(MENSAJE_VENCIDA);
    await expect(llamarAlMozo(page)).toHaveCount(0);
    expect(await llamadosDe(t.orgId)).toHaveLength(1); // solo la cuenta ya atendida

    // Quien escanea de nuevo recibe un ticket posterior y llama con normalidad.
    await page.reload();
    await llamarAlMozo(page).click();
    await expect(page.getByTestId("mensaje-llamado")).toContainText("Avisamos al personal");
    expect(await llamadosDe(t.orgId)).toHaveLength(2);
  });
});

test.describe("la sala muestra cuánto hacía que había escaneado", () => {
  /** Llamados cargados con la clave de servicio (lo que se prueba es la pantalla, no la función). */
  async function sembrar(t: Tenant, branch: string, mesaId: string, visitaHace: number | null) {
    const r = await service()
      .from("waiter_calls")
      .insert({
        organization_id: t.orgId,
        branch_id: branch,
        table_id: mesaId,
        kind: "waiter",
        visit_started_at: visitaHace === null ? null : new Date(Date.now() - visitaHace).toISOString(),
      });
    expect(r.error).toBeNull();
  }

  test("muestra los minutos entre el escaneo y el aviso; con 2 horas o más advierte; sin dato no muestra nada", async ({ page }) => {
    const { t, branch, mesa1, mesa2 } = await nuevoLocal("ticket-sala");
    const mesa3 = await service()
      .from("tables")
      .insert({ organization_id: t.orgId, branch_id: branch, label: "Mesa 3" })
      .select("id")
      .single();
    // 30 s de margen: la base marca `created_at` unos ms después de `Date.now()` y la pantalla trunca a minutos (daría 39).
    await sembrar(t, branch, mesa1.id, 40 * MIN + 30_000); // llamó 40 min después de escanear
    await sembrar(t, branch, mesa2.id, 2 * HORA + 40 * MIN + 30_000); // 2 h 40 min: pestaña olvidada
    await sembrar(t, branch, mesa3.data!.id, null); // sin dato

    await login(page, t.staff.email, t.staff.password);
    await page.goto(`/sala/${t.slug}`);
    const tarjeta = (mesa: string) => page.locator(`[data-testid="llamado"][data-mesa="${mesa}"]`);

    await expect(tarjeta("Mesa 1").getByTestId("escaneo")).toContainText("Escaneó el QR 40 min antes del aviso");
    await expect(tarjeta("Mesa 1").getByTestId("escaneo")).toHaveAttribute("data-vieja", "false");
    await expect(tarjeta("Mesa 1")).not.toContainText("confirmá que siga en la mesa");

    await expect(tarjeta("Mesa 2").getByTestId("escaneo")).toContainText("Escaneó el QR 2 h 40 min antes del aviso");
    await expect(tarjeta("Mesa 2").getByTestId("escaneo")).toHaveAttribute("data-vieja", "true");
    await expect(tarjeta("Mesa 2")).toContainText("confirmá que siga en la mesa");

    await expect(tarjeta("Mesa 3")).toBeVisible();
    await expect(tarjeta("Mesa 3").getByTestId("escaneo")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test("de punta a punta: un llamado hecho desde la carta aparece en la sala con «Escaneó el QR» de pocos segundos", async ({ page, browser }) => {
    const { t, mesa1 } = await nuevoLocal("ticket-punta");
    const comensal = await browser.newPage();
    await comensal.goto(`/t/${mesa1.qr_token}`);
    await comensal.getByTestId("barra-llamado").getByRole("button", { name: "Llamar al mozo" }).click();
    await expect(comensal.getByTestId("mensaje-llamado")).toContainText("Avisamos al personal");
    await comensal.close();

    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/sala/${t.slug}`);
    const escaneo = page.locator('[data-testid="llamado"][data-mesa="Mesa 1"]').getByTestId("escaneo");
    await expect(escaneo).toContainText(/Escaneó el QR \d+ s antes del aviso/);
    await expect(escaneo).toHaveAttribute("data-vieja", "false");
  });
});

import { expect, test } from "@playwright/test";
import { conDobles, pitidos } from "./audio-doble";
import { createTenant, expectNoHorizontalOverflow, login, service, type Tenant } from "./support";

/**
 * Cartel de llamados dentro del panel (ficha aviso-push-desde-el-panel): quien navega el panel se entera arriba, sin salir,
 * de que una mesa llamó. Mismo sondeo que la sala (~3 s), contra el build y el Supabase local, a 390 px.
 */

const tenants: Tenant[] = [];

async function nuevoLocal(label: string, plan: "pro" | "basic" = "pro") {
  const t = await createTenant(label, "active");
  tenants.push(t);
  const db = service();
  await db.from("subscriptions").update({ plan_code: plan }).eq("organization_id", t.orgId);
  const branch = await db.from("branches").select("id").eq("organization_id", t.orgId).single();
  const mesas = await db
    .from("tables")
    .insert(["Mesa 1", "Mesa 2"].map((label) => ({ organization_id: t.orgId, branch_id: branch.data!.id, label })))
    .select("qr_token, label")
    .order("label");
  if (mesas.error) throw new Error(mesas.error.message);
  return { t, mesas: mesas.data as { qr_token: string; label: string }[] };
}

test.afterAll(async () => {
  for (const t of tenants) await t.cleanup();
});

async function llamar(token: string, kind: "waiter" | "bill" = "waiter") {
  const { data, error } = await service().rpc("create_waiter_call", { p_token: token, p_kind: kind });
  expect(error).toBeNull();
  expect(data).toEqual({ status: "created" });
}

const lista = (page: import("@playwright/test").Page) => page.getByTestId("llamados-aviso-lista");

test.describe("cartel de llamados en el panel", () => {
  test("un llamado aparece arriba mientras se navega el panel, se puede ocultar y vuelve a aparecer con uno nuevo", async ({ browser }) => {
    const { t, mesas } = await nuevoLocal("panel-aviso");
    const otro = await nuevoLocal("panel-aviso-otro");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await login(page, t.staff.email, t.staff.password);
    await page.goto(`/panel/${t.slug}/carta`);
    await expect(page.getByRole("heading", { name: "Carta", exact: true })).toBeVisible();
    await expect(page.getByTestId("llamados-aviso-titulo")).toHaveCount(0);

    await llamar(otro.mesas[0].qr_token); // otro local: no se ve acá
    await llamar(mesas[0].qr_token);
    await expect(page.getByTestId("llamados-aviso-titulo")).toHaveText("Una mesa necesita atención", { timeout: 12_000 });
    await expect(lista(page)).toContainText("Mesa 1");
    await expect(lista(page)).toContainText("llama al mozo");
    await expectNoHorizontalOverflow(page);

    // La navegación marca «Sala en vivo» en modo alerta, con el contador.
    const alerta = page.locator('a[data-alerta="true"]');
    await expect(alerta).toHaveCount(1);
    await expect(alerta).toContainText("Sala en vivo");
    await expect(alerta).toContainText("1 llamado pendiente");

    // Se navega a otra pantalla del panel sin recargar: el cartel sigue.
    await page.getByRole("link", { name: "Mesas" }).first().click();
    await expect(page).toHaveURL(new RegExp(`/panel/${t.slug}/mesas`));
    await expect(page.getByTestId("llamados-aviso-titulo")).toBeVisible();

    await page.getByRole("button", { name: "Ocultar" }).click();
    await expect(page.getByTestId("llamados-aviso-titulo")).toHaveCount(0);
    await expect(page.locator('a[data-alerta="true"]')).toHaveCount(1); // ocultar el cartel no apaga la alerta: sigue pendiente

    await llamar(mesas[1].qr_token, "bill");
    await expect(page.getByTestId("llamados-aviso-titulo")).toHaveText("Una mesa necesita atención", { timeout: 12_000 });
    await expect(lista(page)).toContainText("Mesa 2");
    await expect(lista(page)).not.toContainText("Mesa 1"); // la oculta sigue oculta
    await expect(lista(page)).toContainText("pide la cuenta");
    await expect(page.locator('a[data-alerta="true"]')).toContainText("2 llamados pendientes");
    await expectNoHorizontalOverflow(page);

    // Atendido en la sala: el cartel se va solo.
    await service().from("waiter_calls").update({ status: "attended" }).eq("organization_id", t.orgId);
    await expect(page.getByTestId("llamados-aviso-titulo")).toHaveCount(0, { timeout: 12_000 });
    await expect(page.locator('a[data-alerta="true"]')).toHaveCount(0);
    await context.close();
  });

  test("el enlace del cartel lleva a la sala en vivo, que no repite el cartel", async ({ browser }) => {
    const { t, mesas } = await nuevoLocal("panel-aviso-enlace");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/panel/${t.slug}`);
    await llamar(mesas[0].qr_token);
    await expect(page.getByTestId("llamados-aviso-titulo")).toBeVisible({ timeout: 12_000 });
    await page.getByRole("link", { name: "Ir a la sala en vivo" }).click();
    await expect(page.getByRole("heading", { name: "Sala en vivo" })).toBeVisible();
    await expect(page.getByTestId("llamados-aviso")).toHaveCount(0);
    await context.close();
  });

  test("con el plan Básico (sin llamado al mozo) el panel no muestra ni consulta el cartel", async ({ browser }) => {
    const { t } = await nuevoLocal("panel-aviso-basico", "basic");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const consultas: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/estado")) consultas.push(request.url());
    });
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/panel/${t.slug}`);
    await expect(page.getByRole("heading", { name: "Resumen" })).toBeVisible();
    await page.waitForTimeout(4_000);
    await expect(page.getByTestId("llamados-aviso")).toHaveCount(0);
    expect(consultas).toEqual([]);
    await context.close();
  });
});

test.describe("sonido de los llamados fuera de la sala", () => {
  test("lo activado en la sala sigue sonando al pasar a otra pantalla del panel; los pendientes que ya había no suenan", async ({ browser }) => {
    const { t, mesas } = await nuevoLocal("panel-sonido-sala");
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await conDobles(context);
    const page = await context.newPage();
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/sala/${t.slug}`);
    await page.getByRole("button", { name: "Activar alertas" }).click();
    await expect(page.getByTestId("alertas-activas")).toBeVisible();
    expect(await pitidos(page)).toBe(1); // el de confirmación

    // A otra pantalla del panel SIN recargar (el módulo del sonido sigue vivo).
    await llamar(mesas[0].qr_token); // ya pendiente cuando llega el cartel: no debe sonar
    await page.getByRole("link", { name: "Panel", exact: true }).click();
    await page.getByRole("link", { name: "Carta" }).first().click();
    await expect(page).toHaveURL(new RegExp(`/panel/${t.slug}/carta`));
    await expect(page.getByTestId("llamados-aviso-titulo")).toBeVisible({ timeout: 12_000 });
    await page.waitForTimeout(4_000);
    expect(await pitidos(page)).toBeLessThanOrEqual(2); // a lo sumo el de la sala si alcanzó a verlo; nunca uno por cada sondeo

    const antes = await pitidos(page);
    await llamar(mesas[1].qr_token, "bill");
    await expect.poll(() => pitidos(page), { timeout: 12_000 }).toBe(antes + 1);
    await context.close();
  });

  test("el sonido se activa desde el Resumen y suena con un llamado nuevo mientras se navega; silenciarlo lo calla", async ({ browser }) => {
    const { t, mesas } = await nuevoLocal("panel-sonido-resumen");
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await conDobles(context);
    const page = await context.newPage();
    await login(page, t.staff.email, t.staff.password);
    await page.goto(`/panel/${t.slug}`);
    await page.getByRole("button", { name: "Activar sonido de llamados" }).click();
    await expect(page.getByTestId("sonido-activo")).toBeVisible();
    expect(await pitidos(page)).toBe(1);

    await page.getByRole("link", { name: "Mesas" }).first().click();
    await expect(page).toHaveURL(new RegExp(`/panel/${t.slug}/mesas`));
    await llamar(mesas[0].qr_token);
    await expect.poll(() => pitidos(page), { timeout: 12_000 }).toBe(2);

    await page.getByRole("link", { name: "Resumen" }).first().click();
    await page.getByRole("button", { name: "Silenciar sonido" }).click();
    await llamar(mesas[1].qr_token, "bill");
    await expect(page.getByTestId("llamados-aviso-lista")).toContainText("Mesa 2", { timeout: 12_000 });
    expect(await pitidos(page)).toBe(2); // el cartel avisa, pero ya no suena
    await context.close();
  });

  test("tras recargar, el sonido que estaba activado vuelve con el primer toque en la pantalla", async ({ browser }) => {
    const { t, mesas } = await nuevoLocal("panel-sonido-recarga");
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await conDobles(context);
    const page = await context.newPage();
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/panel/${t.slug}`);
    await page.getByRole("button", { name: "Activar sonido de llamados" }).click();
    await expect(page.getByTestId("sonido-activo")).toBeVisible();

    // Se espera al primer sondeo de la página recargada: un llamado hecho antes de él cuenta como «ya había» y no suena.
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => performance.getEntriesByType("resource").some((e) => e.name.includes("/estado"))), { timeout: 12_000 })
      .toBe(true);
    await expect(page.getByRole("button", { name: "Activar sonido de llamados" })).toBeVisible(); // el navegador exige un gesto: todavía no suena
    await page.getByRole("heading", { name: "Resumen" }).click(); // el primer toque lo vuelve a armar, sin pitido de confirmación
    await expect(page.getByTestId("sonido-activo")).toBeVisible();
    expect(await pitidos(page)).toBe(0); // la página recargada empieza de cero: el armado no hace ruido

    await llamar(mesas[0].qr_token);
    await expect.poll(() => pitidos(page), { timeout: 12_000 }).toBe(1);
    await context.close();
  });
});

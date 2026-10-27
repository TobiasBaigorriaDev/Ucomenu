import { expect, test, type Page } from "@playwright/test";
import { createTenant, expectNoHorizontalOverflow, login, service, type Tenant } from "./support";

/**
 * Pantalla «Anotar» de la Sala (ficha sala-anotar-pedido, ADR 0041), contra el build y el Supabase local, a 390 px: el mozo elige un
 * plato con sus opciones, cantidad y observación, lo anota, y lo anotado aparece en el pedido de la mesa y en «Mesas».
 */

const tenants: Tenant[] = [];

async function nuevoLocal(label: string, plan: "basic" | "pro" = "pro") {
  const t = await createTenant(label);
  tenants.push(t);
  const db = service();
  if (plan === "pro") await db.from("subscriptions").update({ plan_code: "pro" }).eq("organization_id", t.orgId);
  const branch = await db.from("branches").select("id").eq("organization_id", t.orgId).single();
  const mesas = await db
    .from("tables")
    .insert(["Mesa 1", "Mesa 2"].map((l) => ({ organization_id: t.orgId, branch_id: branch.data!.id, label: l })))
    .select("id, label")
    .order("label");
  if (mesas.error) throw new Error(mesas.error.message);
  const category = await db.from("categories").insert({ organization_id: t.orgId, name: "Platos" }).select("id").single();
  const plato = async (name: string, price_cents: number) => {
    const p = await db.from("products").insert({ organization_id: t.orgId, category_id: category.data!.id, name, price_cents }).select("id").single();
    if (p.error) throw new Error(p.error.message);
    return p.data.id as string;
  };
  const bife = await plato("Bife de chorizo", 10000);
  const flan = await plato("Flan casero", 3000);
  const agotado = await plato("Lomo agotado", 12000);
  const oculto = await plato("Plato oculto", 4000);
  const grupo = async (name: string, min: number, max: number, sort: number, opciones: [string, number][]) => {
    const g = await db.from("option_groups").insert({ organization_id: t.orgId, product_id: bife, name, min_choices: min, max_choices: max, sort_order: sort }).select("id").single();
    if (g.error) throw new Error(g.error.message);
    const o = await db.from("options").insert(opciones.map(([n, d], i) => ({ organization_id: t.orgId, group_id: g.data.id, name: n, price_delta_cents: d, sort_order: i })));
    if (o.error) throw new Error(o.error.message);
  };
  await grupo("Punto", 1, 1, 0, [["Jugoso", 0], ["A punto", 0]]);
  await grupo("Extras", 0, 2, 1, [["Bacon", 1500], ["Huevo", 1000], ["Queso", 1200]]);
  const ajustes = await db.from("product_availability").insert([
    { organization_id: t.orgId, branch_id: branch.data!.id, product_id: agotado, is_available: false, is_visible: true, price_cents: null },
    { organization_id: t.orgId, branch_id: branch.data!.id, product_id: oculto, is_available: true, is_visible: false, price_cents: null },
  ]);
  if (ajustes.error) throw new Error(ajustes.error.message);
  return { t, branch: branch.data!.id as string, mesas: mesas.data as { id: string; label: string }[], bife, flan };
}

async function abrirAnotar(page: Page, l: Awaited<ReturnType<typeof nuevoLocal>>, quien: "owner" | "staff" = "staff") {
  await login(page, l.t[quien].email, l.t[quien].password);
  await page.goto(`/sala/${l.t.slug}/mesas`);
  await page.getByRole("link", { name: /Anotar pedido: Mesa 1/ }).click();
  await expect(page).toHaveURL(new RegExp(`/sala/${l.t.slug}/mesas/${l.mesas[0].id}/anotar$`));
  await expect(page.getByTestId("anotar-mesa")).toHaveText("Mesa 1");
}

async function abrirCarta(page: Page) {
  await page.getByTestId("abrir-carta").click();
  await expect(page.getByTestId("hoja-carta")).toBeVisible();
}

const plato = (page: Page, nombre: string) => page.locator(`[data-testid="plato"][data-plato="${nombre}"]`);

test.afterAll(async () => {
  for (const t of tenants) await t.cleanup();
});

test.describe("anotar un pedido", () => {
  test("el Staff anota un plato con variante obligatoria, adicionales con tope, cantidad y observación; queda en el pedido y en «Mesas»", async ({ browser }) => {
    const l = await nuevoLocal("anotar-flujo");
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await abrirAnotar(page, l);
    await expect(page.getByTestId("sin-lineas")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // Ambos accesos abren la misma carta; el superior acompaña al regreso a Mesas.
    await page.getByTestId("abrir-carta-arriba").click();
    await expect(page.getByTestId("hoja-carta")).toBeVisible();
    await page.getByTestId("carta-listo").click();
    const back = await page.getByRole("link", { name: "Volver a mesas" }).boundingBox();
    const add = await page.getByTestId("abrir-carta-arriba").boundingBox();
    expect(Math.abs(back!.y - add!.y)).toBeLessThan(5);
    await page.screenshot({ path: "output/playwright/acciones-pedido-mobile.png", fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: "output/playwright/acciones-pedido-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });

    // La carta de la sucursal (en su hoja): lo oculto no está, lo agotado no se puede tocar.
    await abrirCarta(page);
    await expect(plato(page, "Plato oculto")).toHaveCount(0);
    await expect(plato(page, "Lomo agotado")).toBeDisabled();
    await expect(page.getByTestId("carta")).toContainText("Agotado en esta sucursal");

    await page.getByLabel("Buscar plato").fill("CHORIZO");
    await expect(page.getByTestId("plato")).toHaveCount(1);
    await plato(page, "Bife de chorizo").click();
    const hoja = page.getByTestId("hoja-anotar");
    await expect(hoja).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // Sin elegir el punto no se puede anotar, y la pantalla dice qué falta.
    const confirmar = page.getByTestId("anotar-confirmar");
    await expect(confirmar).toBeDisabled();
    await expect(page.getByTestId("faltan")).toContainText("Falta elegir: Punto");

    await hoja.getByLabel("Una más").click();
    await expect(page.getByTestId("cantidad")).toHaveText("2");
    await hoja.getByLabel("A punto").check();
    await expect(confirmar).toBeEnabled();
    await expect(page.getByTestId("faltan")).toHaveCount(0);

    // Extras: hasta dos. El tercero queda deshabilitado mientras haya dos elegidos.
    await hoja.getByLabel(/Bacon/).check();
    await hoja.getByLabel(/Huevo/).check();
    await expect(hoja.getByLabel(/Queso/)).toBeDisabled();
    // 2 × (100 + 15 + 10) = 250
    await expect(confirmar).toContainText("$ 250");

    await hoja.getByLabel("Observación").fill("  sin sal  ");
    await confirmar.click();

    await expect(hoja).toHaveCount(0);
    const linea = page.getByTestId("linea");
    await expect(linea).toHaveCount(1);
    await expect(linea).toContainText("2 × Bife de chorizo");
    await expect(linea).toContainText("A punto, Bacon, Huevo");
    await expect(linea).toContainText("«sin sal»");
    await expect(linea).toContainText("Anotado");
    await expect(page.getByTestId("pedido-total")).toHaveAttribute("data-centavos", "25000");
    // La hoja de la carta sigue abierta para anotar el próximo plato.
    await expect(page.getByTestId("hoja-carta")).toBeVisible();
    await expect(page.getByTestId("hoja-carta").getByTestId("anotado")).toContainText("Anotado: 2 × Bife de chorizo");

    // Lo que la base guardó: el precio lo puso ella, las opciones quedaron copiadas.
    const fila = await service()
      .from("order_items")
      .select("quantity, unit_price_cents, options_cents, note, status, product_name")
      .eq("organization_id", l.t.orgId);
    expect(fila.data).toHaveLength(1);
    expect(fila.data![0]).toMatchObject({ quantity: 2, unit_price_cents: 10000, options_cents: 2500, note: "sin sal", status: "noted", product_name: "Bife de chorizo" });
    await expectNoHorizontalOverflow(page);

    // Otro plato en la misma mesa suma al mismo pedido, y «Mesas» lo muestra.
    await page.getByLabel("Buscar plato").fill("flan");
    await plato(page, "Flan casero").click();
    await page.getByTestId("anotar-confirmar").click();
    await page.getByTestId("carta-listo").click();
    await expect(page.getByTestId("hoja-carta")).toHaveCount(0);
    await expect(page.getByTestId("linea")).toHaveCount(2);
    await expect(page.getByTestId("pedido-total")).toHaveAttribute("data-centavos", "28000");
    await page.getByRole("link", { name: "Volver a mesas" }).click();
    const mesa1 = page.locator('[data-testid="mesa"][data-mesa="Mesa 1"]');
    await expect(mesa1.getByTestId("pedido-estado")).toHaveText("3 platos · 3 anotados");
    await expect(mesa1.getByTestId("pedido-total")).toHaveAttribute("data-centavos", "28000");
    await expect(mesa1.getByRole("link", { name: /Ver pedido y anotar/ })).toBeVisible();
    await ctx.close();
  });

  test("cerrar la hoja no anota nada; un plato sin opciones se anota de una sola vez", async ({ browser }) => {
    const l = await nuevoLocal("anotar-cerrar");
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await abrirAnotar(page, l, "owner");
    await abrirCarta(page);
    await plato(page, "Flan casero").click();
    await page.getByRole("button", { name: "Cerrar sin anotar" }).click();
    await expect(page.getByTestId("hoja-anotar")).toHaveCount(0);
    await expect(page.getByTestId("hoja-carta")).toBeVisible();
    await page.getByRole("button", { name: "Cerrar la carta" }).click();
    await expect(page.getByTestId("hoja-carta")).toHaveCount(0);
    await expect(page.getByTestId("sin-lineas")).toBeVisible();
    expect((await service().from("order_items").select("id").eq("organization_id", l.t.orgId)).data).toHaveLength(0);

    await abrirCarta(page);
    await plato(page, "Flan casero").click();
    await expect(page.getByTestId("anotar-confirmar")).toBeEnabled();
    await page.getByTestId("anotar-confirmar").click();
    await expect(page.getByTestId("linea")).toHaveCount(1);
    await expect(page.getByTestId("pedido-total")).toHaveAttribute("data-centavos", "3000");
    await ctx.close();
  });

  test("si se pierde la respuesta, reintentar no duplica la línea", async ({ browser }) => {
    const l = await nuevoLocal("anotar-reintento");
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await abrirAnotar(page, l);
    await abrirCarta(page);
    await plato(page, "Flan casero").click();

    // La primera vez la acción llega al servidor y se anota, pero la respuesta nunca vuelve al navegador.
    let perdida = false;
    await page.route("**/anotar", async (route) => {
      if (!perdida && route.request().method() === "POST" && route.request().headers()["next-action"]) {
        perdida = true;
        await route.fetch();
        await route.abort("connectionreset");
        return;
      }
      await route.continue();
    });
    await page.getByTestId("anotar-confirmar").click();
    await expect(page.getByTestId("anotar-error")).toContainText("No se pudo confirmar si se anotó");
    expect((await service().from("order_items").select("id").eq("organization_id", l.t.orgId)).data).toHaveLength(1);

    // Volver a tocar «Anotar» usa la misma clave: la base devuelve la línea ya anotada.
    await page.getByTestId("anotar-confirmar").click();
    await expect(page.getByTestId("hoja-carta").getByTestId("anotado")).toContainText("Ya estaba anotado");
    await expect(page.getByTestId("linea")).toHaveCount(1);
    expect((await service().from("order_items").select("id").eq("organization_id", l.t.orgId)).data).toHaveLength(1);
    await ctx.close();
  });

  test("si la carta cambió mientras tanto, lo dice y no anota", async ({ browser }) => {
    const l = await nuevoLocal("anotar-cambio");
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await abrirAnotar(page, l);
    await abrirCarta(page);
    await plato(page, "Flan casero").click();
    // Otra persona agota el plato en la sucursal después de que se cargó la pantalla.
    const r = await service().from("product_availability").insert({ organization_id: l.t.orgId, branch_id: l.branch, product_id: l.flan, is_available: false, is_visible: true, price_cents: null });
    expect(r.error).toBeNull();
    await page.getByTestId("anotar-confirmar").click();
    await expect(page.getByTestId("anotar-error")).toContainText("ya no está disponible");
    expect((await service().from("order_items").select("id").eq("organization_id", l.t.orgId)).data).toHaveLength(0);
    await ctx.close();
  });

  test("sin la función de pedidos (plan Básico) la pantalla lo explica y no ofrece la carta; de otro local no se abre", async ({ browser }) => {
    const l = await nuevoLocal("anotar-basico", "basic");
    const otro = await nuevoLocal("anotar-ajeno");
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await login(page, l.t.staff.email, l.t.staff.password);
    await page.goto(`/sala/${l.t.slug}/mesas/${l.mesas[0].id}/anotar`);
    await expect(page.getByTestId("anotar-deshabilitada")).toContainText("Los pedidos no están disponibles");
    await expect(page.getByTestId("plato")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await ctx.close();

    // Una mesa de otro local (aunque se conozca su id) no existe para quien no es de él; un id que no es uuid, tampoco.
    const ctxOtro = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const ajeno = await ctxOtro.newPage();
    await login(ajeno, otro.t.staff.email, otro.t.staff.password);
    const cruzada = await ajeno.goto(`/sala/${otro.t.slug}/mesas/${l.mesas[0].id}/anotar`);
    expect(cruzada?.status()).toBe(404);
    const rara = await ajeno.goto(`/sala/${otro.t.slug}/mesas/no-es-un-uuid/anotar`);
    expect(rara?.status()).toBe(404);
    await ctxOtro.close();
  });

  test("sin sesión, la pantalla manda a iniciar sesión", async ({ page }) => {
    const l = await nuevoLocal("anotar-sinsesion");
    await page.goto(`/sala/${l.t.slug}/mesas/${l.mesas[0].id}/anotar`);
    await expect(page).toHaveURL(/\/login/);
  });
});

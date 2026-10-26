import { expect, test } from "@playwright/test";
import { createTenant, expectNoHorizontalOverflow, login, service, type Estado, type Tenant } from "./support";
import { sql } from "../tests/rls/helpers"; // después de ./support: este carga las variables de entorno
import { BA, loc, MAD, sembrarEscenario, sembrarPedido, type LocalAnalitica } from "../tests/rls/escenario-analitica-pedidos";

/**
 * Analítica de pedidos (nivel C; ficha analitica-de-pedidos, ADR 0045) contra el build y el Supabase local, a 390 px: el Dueño
 * de un local con el plan ve el resumen del período contra el anterior, las ventas por día, las franjas, los platos, las
 * categorías y las anulaciones, cambia de período y de sucursal, y puede recorrer los gráficos con mouse, toque y teclado.
 * Los números esperados son los del escenario compartido (`tests/rls/escenario-analitica-pedidos.ts`).
 */

const tenants: Tenant[] = [];

async function nuevoLocal(label: string, opciones: { plan?: "pro" | "basic"; estado?: Estado; escenario?: boolean } = {}) {
  const { plan = "pro", estado = "active", escenario = true } = opciones;
  const t = await createTenant(label, estado);
  tenants.push(t);
  const db = service();
  await db.from("subscriptions").update({ plan_code: plan }).eq("organization_id", t.orgId);
  const uno = (await db.from("branches").select("id").eq("organization_id", t.orgId).eq("slug", "centro").single()).data!.id as string;
  // El plan Básico admite una sola sucursal: ahí la «segunda» es la misma.
  const dos = plan === "basic" ? uno : ((await db.from("branches").insert({ organization_id: t.orgId, slug: "norte", name: "Norte" }).select("id").single()).data!.id as string);
  if (plan !== "basic") sql(`update public.branches set timezone = '${MAD}' where id = '${dos}'`);
  const platos = (await db.from("categories").insert({ organization_id: t.orgId, name: "Platos" }).select("id").single()).data!.id as string;
  const postres = (await db.from("categories").insert({ organization_id: t.orgId, name: "Postres" }).select("id").single()).data!.id as string;
  const filas = [
    ["Milanesa", platos, 10000],
    ["Ensalada", platos, 5000],
    ["Flan", postres, 3000],
    ["Sopa", platos, 4000],
    ["Tarta", postres, 3500],
    ["Oculto", platos, 6000],
  ] as const;
  const r = await db.from("products").insert(filas.map(([name, category_id, price_cents], i) => ({ organization_id: t.orgId, category_id, name, price_cents, sort_order: i }))).select("id, name");
  const local: LocalAnalitica = { orgId: t.orgId, uno, dos, producto: Object.fromEntries(r.data!.map((p) => [p.name, p.id])) };
  if (escenario) sembrarEscenario(local);
  return { t, local };
}

test.afterAll(async () => {
  for (const t of tenants) await t.cleanup();
});

test.describe("la analítica de pedidos del Dueño", () => {
  test("resumen contra el período anterior, ventas por día, franjas, platos, categorías, sin pedidos y control; cabe en 390 px", async ({ browser }) => {
    const { t } = await nuevoLocal("anp-completa");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/panel/${t.slug}/analitica`);
    await expect(page.getByRole("heading", { name: "Analítica", exact: true })).toBeVisible();
    await expect(page.getByTestId("analitica-periodos").getByRole("link", { name: "Últimos 30 días" })).toHaveAttribute("aria-current", "page");

    // Resumen: 4 pedidos, 49.000 centavos, 7 platos; contra el anterior (1 pedido por 6.000).
    await expect(page.getByTestId("kpi-ventas-valor")).toContainText("490");
    await expect(page.getByTestId("kpi-ventas-cambio")).toHaveAttribute("data-cambio", "717");
    await expect(page.getByTestId("kpi-ventas-cambio")).toContainText("+717 %");
    await expect(page.getByTestId("kpi-pedidos-valor")).toHaveText("4");
    await expect(page.getByTestId("kpi-pedidos-cambio")).toHaveAttribute("data-cambio", "300");
    await expect(page.getByTestId("kpi-ticket-valor")).toContainText("123");
    await expect(page.getByTestId("kpi-unidades-valor")).toHaveText("7");
    await expect(page.getByTestId("kpi-tiempo-valor")).toHaveText("1 h");
    await expect(page.getByTestId("kpi-promos-valor")).toContainText("10");

    // Ventas por día: un punto por día, con ceros; ayer (3 pedidos, 36.000) y hace 3 días (13.000).
    const dias = page.getByTestId("grafico-dias");
    await expect(dias.locator("[data-indice]")).toHaveCount(30);
    await expect(dias.locator('[data-indice="28"]')).toHaveAttribute("data-valor", "36000");
    await expect(dias.locator('[data-indice="26"]')).toHaveAttribute("data-valor", "13000");
    await expect(page.getByTestId("dias-resumen")).toContainText("Mejor día");
    await expect(page.getByTestId("tabla-dias").locator("tbody tr")).toHaveCount(30);

    // Franjas: 7 × 24 celdas y cuatro con pedidos; el detalle dice día, hora y cantidad.
    const mapa = page.getByTestId("mapa-de-calor");
    await expect(mapa.locator("button")).toHaveCount(168);
    await expect(mapa.locator('button:not([data-pedidos="0"])')).toHaveCount(4);
    await expect(page.getByTestId("franjas-top").locator("li")).toHaveCount(3);
    await expect(page.getByTestId("tabla-franjas").locator("tbody tr")).toHaveCount(7);

    // Platos que más venden, con unidades y vistas.
    const vendidos = page.getByTestId("vendido-fila");
    await expect(vendidos).toHaveCount(3);
    await expect(vendidos.nth(0)).toContainText("Milanesa");
    await expect(vendidos.nth(0)).toContainText("320");
    await expect(vendidos.nth(0)).toContainText("3 unidades");
    await expect(vendidos.nth(0)).toContainText("50 vistas");
    await expect(vendidos.nth(1)).toContainText("Ensalada");
    await expect(vendidos.nth(2)).toContainText("Flan");

    // Categorías.
    await expect(page.getByTestId("categoria-fila")).toHaveCount(2);
    await expect(page.getByTestId("categoria-fila").nth(0)).toContainText("Platos");
    await expect(page.getByTestId("categoria-fila").nth(0)).toContainText("94 %");
    await expect(page.getByTestId("categoria-fila").nth(1)).toContainText("6 %");

    // Platos sin pedidos: primero los más vistos; el oculto en una sucursal se ve en la otra.
    await expect(page.getByTestId("sinpedidos-total")).toContainText("3 platos publicados no tuvieron pedidos");
    const sinPedidos = page.getByTestId("sinpedidos-fila");
    await expect(sinPedidos).toHaveCount(3);
    await expect(sinPedidos.nth(0)).toContainText("Sopa");
    await expect(sinPedidos.nth(0)).toContainText("20 vistas");
    await expect(sinPedidos.nth(1)).toContainText("Tarta");
    await expect(sinPedidos.nth(2)).toContainText("Oculto");
    await expect(sinPedidos.nth(2)).toContainText("sin vistas");

    // Control: un anulado y cuatro platos cancelados, con sus motivos.
    await expect(page.getByTestId("control-anulados")).toContainText("1");
    await expect(page.getByTestId("control-anulados")).toContainText("Cliente se fue");
    await expect(page.getByTestId("control-cancelados")).toContainText("4");
    await expect(page.getByTestId("control-cancelados")).toContainText(/se equivocó/i);

    // Lo de antes sigue estando.
    await expect(page.getByTestId("top-platos")).toBeVisible();
    await expect(page.getByTestId("llamados-horas")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await context.close();
  });

  test("el período y la sucursal cambian lo que corresponde y se conservan entre sí; un período inventado cae en 30 días", async ({ browser }) => {
    const { t } = await nuevoLocal("anp-periodo");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/panel/${t.slug}/analitica`);
    const periodos = page.getByTestId("analitica-periodos");

    await periodos.getByRole("link", { name: "Últimos 7 días" }).click();
    await expect(page).toHaveURL(/dias=7/);
    await expect(page.getByTestId("grafico-dias").locator("[data-indice]")).toHaveCount(7);
    await expect(page.getByTestId("kpi-pedidos-valor")).toHaveText("4");
    await expect(page.getByTestId("kpi-ventas-cambio")).toHaveAttribute("data-cambio", "sin-datos"); // antes no hubo ventas: no se inventa un porcentaje
    await expect(page.getByTestId("kpi-ventas-cambio")).toContainText("Sin datos de los 7 días anteriores");

    await periodos.getByRole("link", { name: "Últimos 90 días" }).click();
    await expect(page).toHaveURL(/dias=90/);
    await expect(page.getByTestId("grafico-dias").locator("[data-indice]")).toHaveCount(90);
    await expect(page.getByTestId("kpi-pedidos-valor")).toHaveText("5"); // entra el de hace 40 días
    await expectNoHorizontalOverflow(page);

    // El filtro de sucursal conserva el período, y el período conserva la sucursal.
    await page.getByTestId("analitica-sucursales").getByRole("link", { name: "Norte" }).click();
    await expect(page).toHaveURL(/sucursal=norte/);
    await expect(page).toHaveURL(/dias=90/);
    await expect(page.getByTestId("kpi-pedidos-valor")).toHaveText("2");
    await expect(page.getByTestId("kpi-ventas-valor")).toContainText("100");
    await periodos.getByRole("link", { name: "Últimos 30 días" }).click();
    await expect(page).toHaveURL(/sucursal=norte/);
    await expect(page).toHaveURL(/dias=30/);
    await expect(page.getByTestId("analitica-sucursales").getByRole("link", { name: "Norte" })).toHaveAttribute("aria-current", "page");

    await page.getByTestId("analitica-sucursales").getByRole("link", { name: "Centro" }).click();
    await expect(page.getByTestId("kpi-pedidos-valor")).toHaveText("2");
    await expect(page.getByTestId("kpi-ventas-valor")).toContainText("390");
    // Con una sucursal con pedidos, el plato oculto en ella no figura entre los que no se piden.
    await expect(page.getByTestId("sinpedidos-fila")).toHaveCount(2);

    // Un período inventado cae en 30 días.
    await page.goto(`/panel/${t.slug}/analitica?dias=15`);
    await expect(page.getByTestId("analitica-periodos").getByRole("link", { name: "Últimos 30 días" })).toHaveAttribute("aria-current", "page");
    await page.goto(`/panel/${t.slug}/analitica?dias=30%3B+drop`);
    await expect(page.getByTestId("analitica-periodos").getByRole("link", { name: "Últimos 30 días" })).toHaveAttribute("aria-current", "page");
    await context.close();
  });

  test("con el mouse, pasar por una barra de ventas o una franja muestra el detalle; al sacar el cursor se va la barra", async ({ browser }) => {
    const { t } = await nuevoLocal("anp-mouse");
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/panel/${t.slug}/analitica`);
    const cartel = page.getByTestId("grafico-dias-cartel");
    await expect(cartel).toHaveCount(0);

    await page.getByTestId("grafico-dias").locator('[data-indice="28"]').hover();
    await expect(cartel).toContainText("$ 360");
    await expect(cartel).toContainText("3 pedidos cerrados");
    await page.getByTestId("grafico-dias").locator('[data-indice="20"]').hover();
    await expect(cartel).toContainText("Sin ventas");
    await page.getByRole("heading", { name: "Analítica", exact: true }).hover();
    await expect(cartel).toHaveCount(0);

    const celda = page.getByTestId("mapa-de-calor").locator('[data-hora="13"]:not([data-pedidos="0"])');
    await expect(celda).toHaveCount(1);
    await celda.hover();
    await expect(page.getByTestId("mapa-detalle")).toContainText("13 a 14 h");
    await expect(page.getByTestId("mapa-detalle")).toContainText("1 pedido");
    await expect(page.getByTestId("mapa-detalle")).toContainText("$ 260");
    await context.close();
  });

  test("con el teclado, una barra de ventas entra con Tab, las flechas la recorren y Escape cierra; la franja se recorre en dos direcciones", async ({ browser }) => {
    const { t } = await nuevoLocal("anp-teclado");
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/panel/${t.slug}/analitica`);

    const dias = page.getByTestId("grafico-dias");
    const cartel = page.getByTestId("grafico-dias-cartel");
    await expect(dias.locator("button[tabindex='0']")).toHaveCount(1);
    await expect(dias.locator("button[tabindex='0']")).toHaveAttribute("data-valor", "36000"); // entra por el mejor día
    await dias.locator('[data-indice="28"]').focus();
    await expect(cartel).toContainText("3 pedidos cerrados");
    await page.keyboard.press("ArrowLeft");
    await expect(dias.locator('[data-indice="27"]')).toBeFocused();
    await page.keyboard.press("End");
    await expect(dias.locator('[data-indice="29"]')).toBeFocused();
    await page.keyboard.press("ArrowRight"); // en el borde no se sale
    await expect(dias.locator('[data-indice="29"]')).toBeFocused();
    await page.keyboard.press("Home");
    await expect(dias.locator('[data-indice="0"]')).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(cartel).toHaveCount(0);
    await expect(dias.locator('[data-indice="28"]')).toHaveAttribute("aria-label", /\$\s360, 3 pedidos/);

    const mapa = page.getByTestId("mapa-de-calor");
    await expect(mapa.locator("button[tabindex='0']")).toHaveCount(1);
    const entrada = mapa.locator("button[tabindex='0']");
    const dia = Number(await entrada.getAttribute("data-dia"));
    const hora = Number(await entrada.getAttribute("data-hora"));
    await entrada.focus();
    await expect(page.getByTestId("mapa-detalle")).toContainText("pedido");
    if (dia < 7) {
      await page.keyboard.press("ArrowDown");
      await expect(mapa.locator(`[data-dia="${dia + 1}"][data-hora="${hora}"]`)).toBeFocused();
      await page.keyboard.press("ArrowUp");
    } else {
      await page.keyboard.press("ArrowUp");
      await expect(mapa.locator(`[data-dia="${dia - 1}"][data-hora="${hora}"]`)).toBeFocused();
      await page.keyboard.press("ArrowDown");
    }
    await expect(mapa.locator(`[data-dia="${dia}"][data-hora="${hora}"]`)).toBeFocused();
    await page.keyboard.press("End");
    await expect(mapa.locator(`[data-dia="${dia}"][data-hora="23"]`)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(mapa.locator(`[data-dia="${dia}"][data-hora="0"]`)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("mapa-detalle")).toContainText("Pasá el cursor");
    await context.close();
  });

  test("en el teléfono, tocar una barra de ventas o una franja muestra el detalle; se queda y se va al tocar afuera; el cartel no se corta en los bordes", async ({ browser }) => {
    const { t } = await nuevoLocal("anp-tactil");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/panel/${t.slug}/analitica?dias=90`);
    const dias = page.getByTestId("grafico-dias");
    const cartel = page.getByTestId("grafico-dias-cartel");

    await dias.locator('[data-indice="88"]').tap();
    await expect(cartel).toContainText("3 pedidos cerrados");
    await page.waitForTimeout(400);
    await expect(cartel).toBeVisible(); // al soltar el dedo se queda
    for (const indice of [0, 89]) {
      await dias.locator(`[data-indice="${indice}"]`).tap();
      await expect(cartel).toBeVisible();
      const caja = (await cartel.boundingBox())!;
      expect(caja.x, `barra ${indice}`).toBeGreaterThanOrEqual(0);
      expect(caja.x + caja.width, `barra ${indice}`).toBeLessThanOrEqual(390);
    }
    await expectNoHorizontalOverflow(page);
    await page.getByRole("heading", { name: "Analítica", exact: true }).tap();
    await expect(cartel).toHaveCount(0);

    await page.getByTestId("mapa-de-calor").locator('[data-hora="13"]:not([data-pedidos="0"])').tap();
    await expect(page.getByTestId("mapa-detalle")).toContainText("13 a 14 h");
    await page.getByRole("heading", { name: "Analítica", exact: true }).tap();
    await expect(page.getByTestId("mapa-detalle")).toContainText("Pasá el cursor");
    await context.close();
  });

  test("un local sin pedidos lo explica y no arma gráficos; platos más vistos y llamados siguen", async ({ browser }) => {
    const { t } = await nuevoLocal("anp-vacia", { escenario: false });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/panel/${t.slug}/analitica`);
    await expect(page.getByTestId("resumen-vacio")).toContainText("Todavía no hay pedidos cerrados");
    for (const id of ["ventas-por-dia", "franjas", "platos-vendidos", "ventas-por-categoria", "platos-sin-pedidos", "control"]) {
      await expect(page.getByTestId(id), id).toHaveCount(0);
    }
    await expect(page.getByTestId("platos-vacio")).toBeVisible();
    await expect(page.getByTestId("horas-vacio")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await context.close();
  });

  test("con la cuenta en «solo lectura» se sigue viendo; con el plan Básico, solo el aviso", async ({ browser }) => {
    const lectura = await nuevoLocal("anp-lectura", { estado: "read_only" });
    const basico = await nuevoLocal("anp-basico", { plan: "basic" });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await login(page, lectura.t.owner.email, lectura.t.owner.password);
    await page.goto(`/panel/${lectura.t.slug}/analitica`);
    await expect(page.getByTestId("kpi-ventas-valor")).toContainText("490");
    await context.clearCookies();

    await login(page, basico.t.owner.email, basico.t.owner.password);
    await page.goto(`/panel/${basico.t.slug}/analitica`);
    await expect(page.getByTestId("analitica-no-incluida")).toContainText("desde el plan Pro");
    await expect(page.getByTestId("resumen")).toHaveCount(0);
    await expect(page.getByTestId("kpi-ventas-valor")).toHaveCount(0);
    await context.close();
  });

  test("cada local ve solo lo suyo: los pedidos de otro no entran a la cuenta", async ({ browser }) => {
    const a = await nuevoLocal("anp-uno");
    const b = await nuevoLocal("anp-otro", { escenario: false });
    sembrarPedido(b.local.orgId, {
      branch: b.local.uno,
      estado: "closed",
      abre: loc(BA, 1, "12:00"),
      cierra: loc(BA, 1, "12:30"),
      lineas: [{ producto: b.local.producto.Milanesa, nombre: "Milanesa", qty: 99, base: 10000 }],
    });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await login(page, a.t.owner.email, a.t.owner.password);
    await page.goto(`/panel/${a.t.slug}/analitica`);
    await expect(page.getByTestId("kpi-ventas-valor")).toContainText("490");
    await expect(page.getByTestId("kpi-unidades-valor")).toHaveText("7");
    await context.close();
  });
});

import { expect, test, type Page } from "@playwright/test";
import { createTenant, expectNoHorizontalOverflow, login, service, type Tenant } from "./support";
import { sql } from "../tests/rls/helpers"; // después de ./support: este carga las variables de entorno

/**
 * Analítica básica (nivel C; ficha analitica-basica, ADR 0022) contra el build y el Supabase local, a 390 px: la carta
 * pública cuenta una vista por plato y por visita sin guardar nada en el dispositivo, y el Dueño de un local con el plan ve
 * los platos más vistos y los llamados por hora; el Staff y el plan Básico, no.
 */

const tenants: Tenant[] = [];

type Local = { t: Tenant; branch: string; branch2: string; platos: Record<string, string>; mesas: { id: string; token: string; branch: string }[] };

async function nuevoLocal(label: string, plan: "pro" | "basic" = "pro"): Promise<Local> {
  const t = await createTenant(label, "active");
  tenants.push(t);
  const db = service();
  await db.from("subscriptions").update({ plan_code: plan }).eq("organization_id", t.orgId);
  const b1 = (await db.from("branches").select("id").eq("organization_id", t.orgId).eq("slug", "centro").single()).data!.id as string;
  const b2 = plan === "basic" ? b1 : ((await db.from("branches").insert({ organization_id: t.orgId, slug: "norte", name: "Norte" }).select("id").single()).data!.id as string);
  const categoria = (await db.from("categories").insert({ organization_id: t.orgId, name: "Platos" }).select("id").single()).data!.id as string;
  const platos = await db
    .from("products")
    .insert(["Milanesa", "Ensalada", "Flan"].map((name, i) => ({ organization_id: t.orgId, category_id: categoria, name, price_cents: 1000, sort_order: i })))
    .select("id, name");
  const mesas = await db
    .from("tables")
    .insert([
      { organization_id: t.orgId, branch_id: b1, label: "Mesa 1" },
      { organization_id: t.orgId, branch_id: b2, label: "Mesa 2" },
    ])
    .select("id, qr_token, branch_id, label")
    .order("label");
  return {
    t,
    branch: b1,
    branch2: b2,
    platos: Object.fromEntries(platos.data!.map((p) => [p.name, p.id])),
    mesas: mesas.data!.map((m) => ({ id: m.id, token: m.qr_token, branch: m.branch_id })),
  };
}

test.afterAll(async () => {
  for (const t of tenants) await t.cleanup();
});

const vistas = (orgId: string) => Number(sql(`select coalesce(sum(views), 0) from public.dish_view_counts where organization_id = '${orgId}'`)[0][0]);
const filas = (orgId: string) => Number(sql(`select count(*) from public.dish_view_counts where organization_id = '${orgId}'`)[0][0]);

/** Cuenta los pedidos de conteo de vistas que hace la página. */
function contarPedidos(page: Page) {
  const pedidos: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/vista-plato") pedidos.push(request.url());
  });
  return pedidos;
}

const abrirYCerrar = async (page: Page, plato: string) => {
  await page.getByRole("button", { name: `Ver detalle de ${plato}` }).click();
  const dialogo = page.getByRole("dialog", { name: plato });
  await expect(dialogo).toBeVisible();
  await dialogo.getByRole("button", { name: "Volver a la carta" }).click();
  await expect(dialogo).toBeHidden();
};

test.describe("la ruta que cuenta las vistas", () => {
  test("solo acepta un POST chico con dos ids válidos, no devuelve cookies y no cuenta lo que no cuadra", async ({ request }) => {
    const l = await nuevoLocal("ana-ruta");
    const url = "/api/vista-plato";
    const valido = { branch: l.branch, product: l.platos.Milanesa };

    const ok = await request.post(url, { data: valido });
    expect(ok.status()).toBe(200);
    expect(await ok.json()).toEqual({ counted: true });
    expect(ok.headers()["set-cookie"]).toBeUndefined();
    expect(ok.headers()["cache-control"]).toContain("no-store");
    expect(vistas(l.t.orgId)).toBe(1);

    // Lo que no cuadra no cuenta ni rompe: ids que no son uuid, JSON roto, vacío, demasiado grande, método equivocado.
    const sinContar = await request.post(url, { data: { branch: "no-es-uuid", product: "tampoco" } });
    expect([sinContar.status(), await sinContar.json()]).toEqual([200, { counted: false }]);
    expect((await request.post(url, { data: Buffer.from("{roto"), headers: { "content-type": "application/json" } })).status()).toBe(400);
    expect((await request.post(url, { data: Buffer.from(""), headers: { "content-type": "application/json" } })).status()).toBe(400);
    expect((await request.post(url, { data: { branch: l.branch, product: l.platos.Milanesa, relleno: "x".repeat(2000) } })).status()).toBe(413);
    expect((await request.get(url)).status()).toBe(405);
    // Un plato de otra organización o inexistente no cuenta.
    const otro = await nuevoLocal("ana-ruta-otro");
    expect(await (await request.post(url, { data: { branch: l.branch, product: otro.platos.Milanesa } })).json()).toEqual({ counted: false });
    expect(await (await request.post(url, { data: { branch: l.branch, product: "00000000-0000-4000-8000-0000000000aa" } })).json()).toEqual({ counted: false });
    expect(vistas(l.t.orgId)).toBe(1);
    expect(vistas(otro.t.orgId)).toBe(0);
  });
});

test.describe("la carta pública cuenta las vistas", () => {
  test("un conteo lento no demora «Llamar al mozo» (no comparten la cola de acciones del servidor)", async ({ browser }) => {
    const l = await nuevoLocal("ana-no-bloquea");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    // El conteo queda retenido hasta que la prueba lo suelte.
    let soltar!: () => void;
    const puerta = new Promise<void>((resolve) => (soltar = resolve));
    // Se retiene el pedido de conteo SEA CUAL SEA el mecanismo (una ruta o una acción del servidor): se lo reconoce por el id del plato.
    await page.route("**/*", async (route) => {
      const pedido = route.request();
      const esConteo = pedido.method() === "POST" && (pedido.postData() ?? "").includes(l.platos.Milanesa);
      if (esConteo) await puerta;
      await route.continue();
    });
    await page.goto(`/t/${l.mesas[0].token}`);
    await expect(page.getByTestId("barra-llamado")).toBeVisible();

    await abrirYCerrar(page, "Milanesa"); // dispara el conteo, que queda esperando
    await page.getByTestId("barra-llamado").getByRole("button", { name: "Llamar al mozo" }).click();
    await expect(page.getByTestId("mensaje-llamado")).toBeVisible({ timeout: 8_000 }); // el llamado se confirmó con el conteo todavía retenido
    const llamados = await service().from("waiter_calls").select("id").eq("organization_id", l.t.orgId);
    expect(llamados.data).toHaveLength(1);
    expect(vistas(l.t.orgId)).toBe(0); // y la vista todavía no llegó

    soltar();
    await expect.poll(() => vistas(l.t.orgId)).toBe(1);
    await context.close();
  });

  test("una vista por plato y por visita; recargar es otra visita; no se guarda nada en el dispositivo", async ({ browser }) => {
    const l = await nuevoLocal("ana-carta");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(`/m/${l.t.slug}/centro`);

    await abrirYCerrar(page, "Milanesa");
    await expect.poll(() => vistas(l.t.orgId)).toBe(1);
    await abrirYCerrar(page, "Milanesa"); // el mismo plato en la misma visita: no suma
    await abrirYCerrar(page, "Ensalada");
    await expect.poll(() => vistas(l.t.orgId)).toBe(2);
    await page.waitForTimeout(800);
    expect(vistas(l.t.orgId)).toBe(2);
    expect(filas(l.t.orgId)).toBe(2);

    // Recargar es otra visita: el mismo plato vuelve a contar.
    await page.reload();
    await abrirYCerrar(page, "Milanesa");
    await expect.poll(() => vistas(l.t.orgId)).toBe(3);
    expect(sql(`select views from public.dish_view_counts where product_id = '${l.platos.Milanesa}'`)).toEqual([["2"]]);

    // La carta promete no guardar nada en el dispositivo: ni almacenamiento ni cookies.
    expect(await page.evaluate(() => [window.localStorage.length, window.sessionStorage.length])).toEqual([0, 0]);
    expect(await context.cookies()).toEqual([]);
    await context.close();
  });

  test("con el plan Básico no se guarda nada y la carta deja de intentarlo después de la primera respuesta", async ({ browser }) => {
    const l = await nuevoLocal("ana-basico", "basic");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const acciones = contarPedidos(page);
    await page.goto(`/m/${l.t.slug}/centro`);

    await abrirYCerrar(page, "Milanesa");
    await expect.poll(() => acciones.length).toBe(1);
    await abrirYCerrar(page, "Ensalada");
    await abrirYCerrar(page, "Flan");
    await page.waitForTimeout(800);
    expect(acciones).toHaveLength(1); // no insiste
    expect(filas(l.t.orgId)).toBe(0);
    // La carta se ve igual: el detalle sigue abriéndose y no aparece ningún aviso de error.
    await expect(page.getByText(/error|no pudimos/i)).toHaveCount(0);
    await context.close();
  });

  test("una carta con una sucursal desactivada no cuenta", async ({ browser }) => {
    const l = await nuevoLocal("ana-inactiva");
    sql(`update public.branches set is_active = false where id = '${l.branch2}'`);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(`/m/${l.t.slug}/norte`);
    await expect(page.getByText("no está disponible", { exact: false }).first()).toBeVisible();
    await context.close();
    expect(filas(l.t.orgId)).toBe(0);
  });
});

/** Siembra vistas y llamados con valores conocidos (la tabla de vistas solo la escribe la función; se prepara como dueño de la tabla). */
async function sembrarAnalitica(l: Local) {
  const dia = (dias: number) => `(now() at time zone 'America/Argentina/Buenos_Aires')::date - ${dias}`;
  const insertar = (producto: string, branch: string, dias: number, views: number) =>
    sql(
      `insert into public.dish_view_counts (organization_id, branch_id, product_id, day, views) values ('${l.t.orgId}', '${branch}', '${producto}', ${dia(dias)}, ${views}) ` +
        `on conflict (branch_id, product_id, day) do update set views = excluded.views`,
    );
  insertar(l.platos.Milanesa, l.branch, 0, 9);
  insertar(l.platos.Milanesa, l.branch2, 1, 3);
  insertar(l.platos.Ensalada, l.branch, 2, 5);
  insertar(l.platos.Flan, l.branch, 30, 100); // fuera de los 14 días

  const llamar = async (mesa: number, kind: "waiter" | "bill", horaAr: number, hace: number) => {
    const { error } = await service().rpc("create_waiter_call", { p_token: l.mesas[mesa].token, p_kind: kind });
    expect(error).toBeNull();
    sql(
      `update public.waiter_calls set created_at = (date_trunc('day', now() at time zone 'UTC') - interval '${hace} days' + interval '${horaAr + 3} hours' + interval '10 minutes') at time zone 'UTC', status = 'attended' ` +
        `where table_id = '${l.mesas[mesa].id}' and kind = '${kind}' and status = 'pending'`,
    );
  };
  await llamar(0, "waiter", 13, 1);
  await llamar(0, "bill", 13, 2);
  await llamar(1, "waiter", 21, 3);
}

test.describe("la pantalla de analítica del Dueño", () => {
  test("el Dueño ve los platos más vistos y los llamados por hora, filtra por sucursal y la página cabe en 390 px", async ({ browser }) => {
    const l = await nuevoLocal("ana-dueno");
    await sembrarAnalitica(l);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await login(page, l.t.owner.email, l.t.owner.password);
    await page.goto(`/panel/${l.t.slug}/analitica`);
    await expect(page.getByRole("heading", { name: "Analítica" })).toBeVisible();

    const filasPlatos = page.getByTestId("plato-fila");
    await expect(filasPlatos).toHaveCount(2); // el Flan es de hace 30 días
    await expect(filasPlatos.nth(0)).toContainText("Milanesa");
    await expect(filasPlatos.nth(0)).toContainText("12");
    await expect(filasPlatos.nth(1)).toContainText("Ensalada");
    await expect(page.getByTestId("platos-total")).toContainText("17 vistas");

    await expect(page.getByTestId("horas-total")).toContainText("3 llamados");
    await expect(page.getByTestId("hora-pico")).toContainText("13 a 14 h");
    await expect(page.getByTestId("hora-pico")).toContainText("2 llamados");
    await expect(page.getByTestId("grafico-horas").locator("[data-hora]")).toHaveCount(24);
    await expect(page.getByTestId("grafico-horas").locator('[data-hora="13"]')).toHaveAttribute("data-total", "2");
    await expect(page.getByTestId("grafico-horas").locator('[data-hora="21"]')).toHaveAttribute("data-total", "1");
    // La tabla equivalente para lectores de pantalla.
    await expect(page.getByTestId("tabla-horas").locator("tbody tr")).toHaveCount(24);
    await expectNoHorizontalOverflow(page);

    // Filtro por sucursal.
    await page.getByTestId("analitica-sucursales").getByRole("link", { name: "Norte" }).click();
    await expect(page).toHaveURL(/sucursal=norte/);
    await expect(page.getByTestId("plato-fila")).toHaveCount(1);
    await expect(page.getByTestId("plato-fila")).toContainText("Milanesa");
    await expect(page.getByTestId("plato-fila")).toContainText("3");
    await expect(page.getByTestId("hora-pico")).toContainText("21 a 22 h");
    await expect(page.getByTestId("horas-total")).toContainText("1 llamado");

    // Un filtro inventado se ignora.
    await page.goto(`/panel/${l.t.slug}/analitica?sucursal=no-existe`);
    await expect(page.getByTestId("plato-fila")).toHaveCount(2);
    await context.close();
  });

  test("al pasar el cursor por una barra del gráfico se ve la hora exacta y cuántos llamaron; al sacarlo se va", async ({ browser }) => {
    const l = await nuevoLocal("ana-hover");
    await sembrarAnalitica(l);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await login(page, l.t.owner.email, l.t.owner.password);
    await page.goto(`/panel/${l.t.slug}/analitica`);
    const grafico = page.getByTestId("grafico-horas");
    const tooltip = page.getByTestId("tooltip-hora");
    await expect(tooltip).toHaveCount(0);

    await grafico.locator('[data-hora="13"]').hover();
    await expect(tooltip).toContainText("13 a 14 h");
    await expect(tooltip).toContainText("1 llama al mozo");
    await expect(tooltip).toContainText("1 pide la cuenta");
    await expect(tooltip).toContainText("2 llamados en total");

    // Otra hora: cambia; una hora sin llamados lo dice (no una barra vacía muda).
    await grafico.locator('[data-hora="21"]').hover();
    await expect(tooltip).toContainText("21 a 22 h");
    await expect(tooltip).toContainText("1 llama al mozo");
    await expect(tooltip).toContainText("0 piden la cuenta");
    await grafico.locator('[data-hora="4"]').hover();
    await expect(tooltip).toContainText("4 a 5 h");
    await expect(tooltip).toContainText("Sin llamados");

    // Se puede señalar la columna entera (no solo la barra), aunque no tenga alto: la hora 4 no tiene barra y respondió.
    await page.getByRole("heading", { name: "Analítica" }).hover();
    await expect(tooltip).toHaveCount(0);
    await context.close();
  });

  test("en el teléfono, tocar una barra muestra la hora y la cantidad; se queda, se mueve al tocar otra y se va al tocar afuera; en los bordes no se corta", async ({ browser }) => {
    const l = await nuevoLocal("ana-tactil");
    await sembrarAnalitica(l);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await login(page, l.t.owner.email, l.t.owner.password);
    await page.goto(`/panel/${l.t.slug}/analitica`);
    const grafico = page.getByTestId("grafico-horas");
    const tooltip = page.getByTestId("tooltip-hora");

    await grafico.locator('[data-hora="13"]').tap();
    await expect(tooltip).toContainText("13 a 14 h");
    await expect(tooltip).toContainText("2 llamados en total");
    await page.waitForTimeout(400);
    await expect(tooltip).toBeVisible(); // al soltar el dedo se queda

    await grafico.locator('[data-hora="21"]').tap();
    await expect(tooltip).toContainText("21 a 22 h");

    // Los bordes (0 h y 23 h): el cartel queda dentro de la pantalla.
    for (const hora of [0, 23]) {
      await grafico.locator(`[data-hora="${hora}"]`).tap();
      await expect(tooltip).toContainText(`${hora} a ${hora + 1} h`);
      const caja = (await tooltip.boundingBox())!;
      expect(caja.x, `hora ${hora}`).toBeGreaterThanOrEqual(0);
      expect(caja.x + caja.width, `hora ${hora}`).toBeLessThanOrEqual(390);
    }
    await expectNoHorizontalOverflow(page);

    // Tocar afuera lo cierra.
    await page.getByRole("heading", { name: "Analítica" }).tap();
    await expect(tooltip).toHaveCount(0);
    await context.close();
  });

  test("con el teclado: se entra a una barra, las flechas recorren las horas y Escape cierra el cartel", async ({ browser }) => {
    const l = await nuevoLocal("ana-teclado");
    await sembrarAnalitica(l);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await login(page, l.t.owner.email, l.t.owner.password);
    await page.goto(`/panel/${l.t.slug}/analitica`);
    const grafico = page.getByTestId("grafico-horas");
    const tooltip = page.getByTestId("tooltip-hora");

    // Una sola barra entra con Tab (la hora pico, la 13); el resto, con las flechas.
    await expect(grafico.locator("button[tabindex='0']")).toHaveCount(1);
    await grafico.locator('[data-hora="13"]').focus();
    await expect(tooltip).toContainText("13 a 14 h");
    await page.keyboard.press("ArrowRight");
    await expect(grafico.locator('[data-hora="14"]')).toBeFocused();
    await expect(tooltip).toContainText("14 a 15 h");
    await page.keyboard.press("End");
    await expect(tooltip).toContainText("23 a 24 h");
    await page.keyboard.press("Home");
    await expect(tooltip).toContainText("0 a 1 h");
    await page.keyboard.press("ArrowLeft"); // en el borde no se sale
    await expect(grafico.locator('[data-hora="0"]')).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(tooltip).toHaveCount(0);
    // Cada columna se anuncia con su hora y su cantidad.
    await expect(grafico.locator('[data-hora="13"]')).toHaveAttribute("aria-label", "13 a 14 h: 1 llama al mozo, 1 pide la cuenta");
    await context.close();
  });

  test("la página no se estira por contenido oculto: al achicar y volver a agrandar la ventana no queda un espacio en blanco abajo", async ({ browser }) => {
    const l = await nuevoLocal("ana-espacio");
    await sembrarAnalitica(l);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await login(page, l.t.owner.email, l.t.owner.password);
    await page.goto(`/panel/${l.t.slug}/analitica`);
    await expect(page.getByTestId("grafico-horas")).toBeVisible();

    // Cuánto sobra por debajo del marco del panel (lo que se vería como un hueco en blanco al final de la página).
    const sobrante = () =>
      page.evaluate(() => {
        const marco = document.querySelector(".panel")!.getBoundingClientRect();
        return Math.round(document.documentElement.scrollHeight - (marco.bottom + window.scrollY));
      });
    expect(await sobrante()).toBeLessThanOrEqual(2);

    // «Achicar la página» (el zoom del navegador cambia el tamaño de la ventana en píxeles CSS) y volver.
    await page.setViewportSize({ width: 2560, height: 1800 });
    expect(await sobrante()).toBeLessThanOrEqual(2);
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await sobrante()).toBeLessThanOrEqual(2);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await sobrante()).toBeLessThanOrEqual(2);
    await context.close();
  });

  test("sin datos, cada sección lo explica", async ({ browser }) => {
    const l = await nuevoLocal("ana-vacia");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await login(page, l.t.owner.email, l.t.owner.password);
    await page.goto(`/panel/${l.t.slug}/analitica`);
    await expect(page.getByTestId("platos-vacio")).toBeVisible();
    await expect(page.getByTestId("horas-vacio")).toBeVisible();
    await context.close();
  });

  test("el plan Básico ve el aviso de que está incluida desde Pro, sin datos", async ({ browser }) => {
    const l = await nuevoLocal("ana-no-pro", "basic");
    sql(
      `insert into public.dish_view_counts (organization_id, branch_id, product_id, day, views) values ('${l.t.orgId}', '${l.branch}', '${l.platos.Flan}', current_date, 7)`,
    );
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await login(page, l.t.owner.email, l.t.owner.password);
    await page.goto(`/panel/${l.t.slug}/analitica`);
    await expect(page.getByTestId("analitica-no-incluida")).toContainText("desde el plan Pro");
    await expect(page.getByTestId("top-platos")).toHaveCount(0);
    await expect(page.getByTestId("plato-fila")).toHaveCount(0);
    await context.close();
  });

  test("el Staff no ve el enlace y la dirección lo devuelve al panel; el Dueño sí ve «Analítica» en el menú", async ({ browser }) => {
    const l = await nuevoLocal("ana-staff");
    await sembrarAnalitica(l);

    const staff = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const paginaStaff = await staff.newPage();
    await login(paginaStaff, l.t.staff.email, l.t.staff.password);
    await paginaStaff.goto(`/panel/${l.t.slug}`);
    await expect(paginaStaff.getByRole("link", { name: "Analítica" })).toHaveCount(0);
    await paginaStaff.goto(`/panel/${l.t.slug}/analitica`);
    await expect(paginaStaff).toHaveURL(new RegExp(`/panel/${l.t.slug}$`));
    await expect(paginaStaff.getByTestId("plato-fila")).toHaveCount(0);
    await staff.close();

    const dueno = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const paginaDueno = await dueno.newPage();
    await login(paginaDueno, l.t.owner.email, l.t.owner.password);
    await paginaDueno.goto(`/panel/${l.t.slug}`);
    await paginaDueno.getByRole("link", { name: "Analítica" }).click();
    await expect(paginaDueno).toHaveURL(new RegExp(`/panel/${l.t.slug}/analitica$`));
    await expect(paginaDueno.getByTestId("plato-fila")).toHaveCount(2);
    await dueno.close();
  });
});

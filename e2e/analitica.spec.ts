import { createClient } from "@supabase/supabase-js";
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

/** Cuenta los pedidos de acciones del servidor (el conteo de vistas) que hace la página. */
function contarAcciones(page: Page) {
  const pedidos: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"]) pedidos.push(request.url());
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

test.describe("la carta pública cuenta las vistas", () => {
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
    const acciones = contarAcciones(page);
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

  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const llamar = async (mesa: number, kind: "waiter" | "bill", horaAr: number, hace: number) => {
    const { error } = await anon.rpc("create_waiter_call", { p_token: l.mesas[mesa].token, p_kind: kind });
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

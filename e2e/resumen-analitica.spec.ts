import { expect, test } from "@playwright/test";
import { createTenant, expectNoHorizontalOverflow, login, service, type Tenant } from "./support";
import { sql } from "../tests/rls/helpers"; // después de ./support: este carga las variables de entorno
import { BA, loc, MAD, sembrarEscenario, sembrarPedido, type LocalAnalitica } from "../tests/rls/escenario-analitica-pedidos";

/**
 * Resumen de la analítica con IA (nivel C; ficha resumen-de-analitica-con-ia, ADR 0047) contra el build, el Supabase local y un
 * Gemini de mentira (`e2e/gemini-stub.ts`), a 390 px: el Dueño genera el resumen de un período, lo ve guardado al volver, no
 * puede regenerarlo enseguida, no lo ve un local sin pedidos suficientes ni uno sin el plan.
 */

const tenants: Tenant[] = [];

async function nuevoLocal(label: string, opciones: { plan?: "pro" | "basic"; pedidos?: boolean } = {}) {
  const { plan = "pro", pedidos = true } = opciones;
  const t = await createTenant(label, "active");
  tenants.push(t);
  const db = service();
  await db.from("subscriptions").update({ plan_code: plan }).eq("organization_id", t.orgId);
  const uno = (await db.from("branches").select("id").eq("organization_id", t.orgId).eq("slug", "centro").single()).data!.id as string;
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
  if (pedidos) {
    sembrarEscenario(local); // 4 pedidos cerrados en los últimos 30 días, 2 de ellos en la sucursal «norte»
    // Tres más en «centro»: suman 7 en total y bastan para que cada sucursal supere el mínimo de pedidos.
    for (const [abre, cierra] of [["12:00", "12:30"], ["12:20", "12:50"], ["13:00", "13:30"]]) {
      sembrarPedido(local.orgId, {
        branch: uno,
        estado: "closed",
        abre: loc(BA, 2, abre),
        cierra: loc(BA, 2, cierra),
        lineas: [{ producto: local.producto.Sopa, nombre: "Sopa", qty: 1, base: 4000 }],
      });
    }
  }
  return { t, local };
}

test.afterAll(async () => {
  for (const t of tenants) await t.cleanup();
});

test.describe("el resumen con IA de la analítica", () => {
  test("el Dueño lo genera, lo ve guardado al volver, no puede regenerarlo enseguida y cada período tiene el suyo; cabe en 390 px", async ({ browser }) => {
    const { t } = await nuevoLocal("rsm-flujo");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/panel/${t.slug}/analitica`);

    const seccion = page.getByTestId("resumen-ia");
    await expect(seccion.getByRole("heading", { name: "Resumen con IA" })).toBeVisible();
    await expect(page.getByTestId("resumen-ia-vacio")).toContainText("Todavía no generaste un resumen");
    await expect(seccion).toContainText("No se envían motivos de anulación ni datos de comensales");

    await page.getByTestId("resumen-ia-generar").click();
    await expect(page.getByTestId("resumen-ia-texto")).toContainText("Vendiste $");
    await expect(page.getByTestId("resumen-ia-texto")).toContainText("7 pedidos cerrados");
    await expect(page.getByTestId("resumen-ia-hallazgos")).toContainText("El día más fuerte fue");
    await expect(page.getByTestId("resumen-ia-acciones")).toContainText("Revisá los platos que no se piden");
    await expect(page.getByTestId("resumen-ia-pie")).toContainText("Generado por IA (Gemini)");
    await expect(page.getByTestId("resumen-ia-generar")).toHaveText("Actualizar resumen");
    await expectNoHorizontalOverflow(page);

    // No se regenera enseguida (acota el gasto).
    await page.getByTestId("resumen-ia-generar").click();
    await expect(page.getByTestId("resumen-ia-error")).toContainText("Ya generaste este resumen hace poco");

    // Queda guardado: al volver (o recargar) sigue ahí, sin pedir nada al servicio.
    await page.goto(`/panel/${t.slug}/analitica`);
    await expect(page.getByTestId("resumen-ia-texto")).toContainText("Vendiste $");

    // Otro período tiene su propio resumen (todavía sin generar).
    await page.goto(`/panel/${t.slug}/analitica?dias=7`);
    await expect(page.getByTestId("resumen-ia-vacio")).toBeVisible();
    await expect(page.getByTestId("resumen-ia-texto")).toHaveCount(0);
    await context.close();
  });

  test("con la sucursal elegida guarda un resumen aparte del de todas las sucursales", async ({ page }) => {
    const { t } = await nuevoLocal("rsm-sucursal");
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/panel/${t.slug}/analitica?sucursal=_todas`);
    await page.getByTestId("resumen-ia-generar").click();
    await expect(page.getByTestId("resumen-ia-texto")).toBeVisible();

    // La sucursal «centro» tiene menos pedidos que el total: su resumen es otro y todavía no existe.
    await page.goto(`/panel/${t.slug}/analitica?sucursal=centro`);
    await expect(page.getByTestId("resumen-ia-vacio")).toBeVisible();
    await page.getByTestId("resumen-ia-generar").click();
    await expect(page.getByTestId("resumen-ia-texto")).toContainText(/\d pedidos cerrados/);
    await expect(page.getByTestId("resumen-ia-texto")).not.toContainText("7 pedidos cerrados");
    await page.goto(`/panel/${t.slug}/analitica?sucursal=_todas`);
    await expect(page.getByTestId("resumen-ia-texto")).toContainText("7 pedidos cerrados");
  });

  test("un local con pocos pedidos no puede pedirlo y se le explica por qué", async ({ page }) => {
    const { t } = await nuevoLocal("rsm-pocos", { pedidos: false });
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/panel/${t.slug}/analitica`);
    await expect(page.getByTestId("resumen-ia-vacio")).toContainText("pocos pedidos");
    await expect(page.getByTestId("resumen-ia-generar")).toHaveCount(0);
  });

  test("el plan Básico no tiene la analítica ni, por lo tanto, el resumen", async ({ page }) => {
    const { t } = await nuevoLocal("rsm-basico", { plan: "basic" });
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/panel/${t.slug}/analitica`);
    await expect(page.getByTestId("analitica-no-incluida")).toBeVisible();
    await expect(page.getByTestId("resumen-ia")).toHaveCount(0);
  });

  test("el Staff no entra a la analítica", async ({ page }) => {
    const { t } = await nuevoLocal("rsm-staff");
    await login(page, t.staff.email, t.staff.password);
    await page.goto(`/panel/${t.slug}/analitica`);
    await expect(page).not.toHaveURL(/\/analitica/);
    await expect(page.getByTestId("resumen-ia")).toHaveCount(0);
  });
});

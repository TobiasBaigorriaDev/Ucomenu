import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { createTenant, expectNoHorizontalOverflow, login, service, type Person, type Tenant } from "./support";
import { BA, loc, sembrarPedido } from "../tests/rls/escenario-analitica-pedidos"; // después de ./support: carga las variables de entorno

/**
 * Resumen del panel (ficha resumen-del-panel) contra el build y el Supabase local, a 390 px: el Dueño con Pro ve el salón en vivo, las
 * ventas de hoy contra el mismo día de la semana anterior, los pendientes y su carta para compartir; el Personal ve el salón y los
 * pendientes pero ninguna cifra de ventas; el Dueño sin analítica ve que viene con Pro; y sin pedidos no hay ceros disfrazados de dato.
 */

const tenants: Tenant[] = [];

async function nuevoLocal(label: string, plan: "basic" | "pro" = "pro") {
  const t = await createTenant(label);
  tenants.push(t);
  const db = service();
  await db.from("subscriptions").update({ plan_code: plan }).eq("organization_id", t.orgId);
  const branch = (await db.from("branches").select("id").eq("organization_id", t.orgId).single()).data!.id as string;
  const mesas = await db
    .from("tables")
    .insert(["Mesa 1", "Mesa 2"].map((label) => ({ organization_id: t.orgId, branch_id: branch, label })))
    .select("id, label, qr_token")
    .order("label");
  if (mesas.error) throw new Error(mesas.error.message);
  const category = await db.from("categories").insert({ organization_id: t.orgId, name: "Platos" }).select("id").single();
  const product = await db.from("products").insert({ organization_id: t.orgId, category_id: category.data!.id, name: "Bife", price_cents: 10000 }).select("id").single();
  return { t, branch, mesas: mesas.data, product: product.data!.id as string };
}

/** El mozo anota con su sesión (la única puerta de escritura de los pedidos). */
async function anotar(persona: Person, l: { branch: string; product: string }, mesaId: string) {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const sesion = await db.auth.signInWithPassword({ email: persona.email, password: persona.password });
  expect(sesion.error).toBeNull();
  const r = await db.rpc("add_order_item", { p_branch: l.branch, p_table: mesaId, p_product: l.product, p_quantity: 1, p_client_key: randomUUID() });
  expect(r.error).toBeNull();
}

/** Un pedido cerrado de `qty` Bifes de $ 100, cerrado hoy menos `dias` días. */
function cerrado(l: { t: Tenant; branch: string; product: string }, dias: number, qty: number) {
  sembrarPedido(l.t.orgId, {
    branch: l.branch,
    estado: "closed",
    abre: dias === 0 ? "now() - interval '2 hours'" : loc(BA, dias, "13:00"),
    cierra: dias === 0 ? "now() - interval '1 hour'" : loc(BA, dias, "14:00"),
    lineas: [{ producto: l.product, nombre: "Bife", qty, base: 10000 }],
  });
}

test.afterAll(async () => {
  for (const t of tenants) await t.cleanup();
});

test.describe("Resumen del panel", () => {
  test("el Dueño con Pro ve salón, ventas de hoy, pendientes y su carta; cabe en 390 px", async ({ browser }) => {
    const l = await nuevoLocal("resumen-pro");
    cerrado(l, 0, 2); // hoy: $ 200
    cerrado(l, 7, 1); // mismo día de la semana anterior: $ 100 (+100 %)
    await anotar(l.t.staff, l, l.mesas[0].id); // Mesa 1 con un pedido abierto de $ 100
    await service().rpc("create_waiter_call", { p_token: l.mesas[1].qr_token, p_kind: "waiter" });
    await service().from("product_availability").insert({ organization_id: l.t.orgId, branch_id: l.branch, product_id: l.product, is_available: false });

    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["clipboard-read", "clipboard-write"] });
    const page = await context.newPage();
    await login(page, l.t.owner.email, l.t.owner.password);
    await page.goto(`/panel/${l.t.slug}`);
    await expect(page.getByRole("heading", { name: "Resumen", exact: true })).toBeVisible();
    await expect(page.getByTestId("resumen-fecha")).toBeVisible();

    // Ahora: un llamado pendiente (al mozo), una mesa con pedido, un plato anotado y $ 100 por cobrar.
    await expect(page.getByTestId("ahora-llamados-valor")).toHaveText("1");
    await expect(page.getByTestId("ahora-llamados")).toContainText("1 al mozo · 0 piden la cuenta");
    await expect(page.getByTestId("ahora-llamados")).toHaveAttribute("data-activo", "si");
    await expect(page.getByTestId("ahora-mesas-valor")).toHaveText("1");
    await expect(page.getByTestId("ahora-cocina-valor")).toHaveText("1");
    await expect(page.getByTestId("ahora-abierto-valor")).toContainText("100");

    // Hoy: $ 200 contra $ 100 del mismo día de la semana anterior; 7 barras con su texto; el plato más pedido.
    await expect(page.getByTestId("hoy-valor")).toContainText("200");
    await expect(page.getByTestId("hoy-cambio")).toContainText("+100 % frente al");
    await expect(page.getByTestId("hoy-cambio")).toContainText("pasado");
    await expect(page.getByTestId("semana-dia")).toHaveCount(7);
    await expect(page.getByTestId("semana-barras")).toContainText("sin ventas"); // los días sin pedidos lo dicen en texto
    await expect(page.getByTestId("hoy-platos")).toContainText("Bife");
    await expect(page.getByTestId("hoy-platos")).toContainText("2 pedidos");

    // Para atender: el plato agotado, con su enlace.
    const agotados = page.locator('[data-item="agotados"]');
    await expect(agotados).toContainText("1 plato figura agotado");
    await expect(agotados.getByRole("link")).toHaveAttribute("href", `/panel/${l.t.slug}/carta`);

    // Tu carta: ver, copiar y compartir por WhatsApp (el enlace ya lleva el texto y la dirección de la sucursal).
    const carta = page.getByTestId("carta-sucursal");
    await expect(carta.getByRole("link", { name: "Ver la carta de Centro" })).toHaveAttribute("href", `/m/${l.t.slug}/centro`);
    const whatsapp = carta.getByRole("link", { name: /WhatsApp/ });
    await expect(whatsapp).toHaveAttribute("href", /^https:\/\/wa\.me\/\?text=/);
    expect(decodeURIComponent((await whatsapp.getAttribute("href"))!)).toContain(`/m/${l.t.slug}/centro`);
    // `dispatchEvent` y no `click()`: en todo el panel el navegador agranda la ventana de diseño a 390 px (la lista de secciones mide más
    // que la pantalla y el desplazamiento de Playwright mide el botón en otra posición). Lo que se prueba es el copiado, no el puntero.
    await carta.getByTestId("carta-copiar").dispatchEvent("click");
    await expect(page.getByTestId("carta-copiar-estado")).toHaveText("Enlace copiado");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(new RegExp(`/m/${l.t.slug}/centro$`));

    // El uso del plan sigue siendo del Dueño.
    await expect(page.getByText("Uso del plan")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await context.close();
  });

  test("el Personal ve el salón y los pendientes, pero ninguna cifra de ventas ni el plan", async ({ page }) => {
    const l = await nuevoLocal("resumen-staff");
    cerrado(l, 0, 2);
    await anotar(l.t.staff, l, l.mesas[0].id);
    await login(page, l.t.staff.email, l.t.staff.password);
    await page.goto(`/panel/${l.t.slug}`);
    await expect(page.getByTestId("resumen-ahora")).toBeVisible();
    await expect(page.getByTestId("ahora-mesas-valor")).toHaveText("1");
    await expect(page.getByTestId("resumen-atencion")).toBeVisible();
    await expect(page.getByTestId("resumen-carta")).toBeVisible();
    await expect(page.getByTestId("resumen-hoy")).toHaveCount(0);
    await expect(page.getByTestId("resumen-hoy-no-incluida")).toHaveCount(0);
    await expect(page.getByText("Uso del plan")).toHaveCount(0);
    await expect(page.getByText("Ventas de hoy")).toHaveCount(0);
  });

  test("sin pedidos cerrados no hay ceros que parezcan un dato, y sin pendientes dice que está todo al día", async ({ page }) => {
    const l = await nuevoLocal("resumen-vacio");
    await login(page, l.t.owner.email, l.t.owner.password);
    await page.goto(`/panel/${l.t.slug}`);
    await expect(page.getByTestId("hoy-vacio")).toContainText("Todavía no hay pedidos cerrados");
    await expect(page.getByTestId("hoy-valor")).toHaveCount(0);
    await expect(page.getByTestId("atencion-vacio")).toContainText("Todo al día");
  });

  test("el Dueño sin analítica ve que las ventas vienen con Pro, sin cifras", async ({ page }) => {
    const l = await nuevoLocal("resumen-basico", "basic");
    cerrado(l, 0, 2);
    await login(page, l.t.owner.email, l.t.owner.password);
    await page.goto(`/panel/${l.t.slug}`);
    await expect(page.getByTestId("resumen-hoy-no-incluida")).toContainText("plan Pro");
    await expect(page.getByTestId("resumen-hoy")).toHaveCount(0);
    await expect(page.getByTestId("hoy-valor")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Ver tu plan" })).toHaveAttribute("href", `/panel/${l.t.slug}/suscripcion`);
  });
});

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createTenant, expectNoHorizontalOverflow, service, type Person, type Tenant } from "./support";

/**
 * Cuenta del comensal (ficha cuenta-del-comensal, ADR 0044), contra el build y el Supabase local, a 390 px: tras «Pedir la cuenta» aparece
 * «Ver mi cuenta» con lo anotado en la mesa, la leyenda y el total; cobrar la mesa (o reiniciar el QR) corta el acceso del celular.
 */

const tenants: Tenant[] = [];

async function nuevoLocal(label: string) {
  const t = await createTenant(label);
  tenants.push(t);
  const db = service();
  await db.from("subscriptions").update({ plan_code: "pro" }).eq("organization_id", t.orgId);
  const branch = await db.from("branches").select("id").eq("organization_id", t.orgId).single();
  const mesas = await db
    .from("tables")
    .insert([{ organization_id: t.orgId, branch_id: branch.data!.id, label: "Mesa 7" }])
    .select("id, qr_token");
  if (mesas.error) throw new Error(mesas.error.message);
  const category = await db.from("categories").insert({ organization_id: t.orgId, name: "Platos" }).select("id").single();
  const bife = await db.from("products").insert({ organization_id: t.orgId, category_id: category.data!.id, name: "Bife de chorizo", price_cents: 10000 }).select("id").single();
  const flan = await db.from("products").insert({ organization_id: t.orgId, category_id: category.data!.id, name: "Flan casero", price_cents: 3000 }).select("id").single();
  const grupo = await db.from("option_groups").insert({ organization_id: t.orgId, product_id: bife.data!.id, name: "Extras", min_choices: 0, max_choices: 2 }).select("id").single();
  const bacon = await db.from("options").insert({ organization_id: t.orgId, group_id: grupo.data!.id, name: "Bacon", price_delta_cents: 1500, sort_order: 0 }).select("id").single();
  return { t, branch: branch.data!.id as string, mesa: mesas.data[0] as { id: string; qr_token: string }, bife: bife.data!.id as string, flan: flan.data!.id as string, bacon: bacon.data!.id as string };
}
type Local = Awaited<ReturnType<typeof nuevoLocal>>;

async function sesion(persona: Person) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  expect((await db.auth.signInWithPassword({ email: persona.email, password: persona.password })).error).toBeNull();
  return db;
}

/** El mozo anota 2 bifes con bacon y una nota, un flan, y un flan cancelado. Devuelve su sesión y el pedido. */
async function pedido(l: Local) {
  const db = await sesion(l.t.staff);
  const base = { p_branch: l.branch, p_table: l.mesa.id };
  const a = await db.rpc("add_order_item", { ...base, p_product: l.bife, p_quantity: 2, p_client_key: randomUUID(), p_options: [l.bacon], p_note: "sin sal, alérgico a la nuez" });
  expect(a.error).toBeNull();
  expect((await db.rpc("add_order_item", { ...base, p_product: l.flan, p_quantity: 1, p_client_key: randomUUID() })).error).toBeNull();
  const c = await db.rpc("add_order_item", { ...base, p_product: l.flan, p_quantity: 5, p_client_key: randomUUID() });
  expect(c.error).toBeNull();
  expect((await db.rpc("set_order_item_status", { p_item: (c.data as { item_id: string }).item_id, p_status: "cancelled" })).error).toBeNull();
  return { db, order: (a.data as { order_id: string }).order_id };
}

const barra = (page: Page) => page.getByTestId("barra-llamado");
const pedirCuenta = (page: Page) => barra(page).getByRole("button", { name: "Pedir la cuenta" });

test.afterAll(async () => {
  for (const t of tenants) await t.cleanup();
});

test.describe("la cuenta del comensal", () => {
  test("no se ofrece hasta pedir la cuenta; después muestra lo anotado con total y leyenda, sin lo cancelado ni las observaciones", async ({ browser }) => {
    const l = await nuevoLocal("cuenta-vista");
    await pedido(l);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(`/t/${l.mesa.qr_token}`);
    await expect(barra(page)).toBeVisible();
    await expect(page.getByTestId("ver-cuenta")).toHaveCount(0);

    await pedirCuenta(page).click();
    await expect(page.getByTestId("mensaje-llamado")).toContainText("Pedimos tu cuenta");
    await page.getByTestId("ver-cuenta").click();

    const hoja = page.getByTestId("hoja-cuenta");
    await expect(page.getByTestId("cuenta")).toBeVisible();
    await expect(page.getByTestId("cuenta-mesa")).toHaveText("Mesa 7");
    await expect(page.getByTestId("cuenta-linea")).toHaveCount(2);
    const bife = page.getByTestId("cuenta-linea").filter({ hasText: "Bife" });
    await expect(bife).toContainText("2 × Bife de chorizo");
    await expect(bife).toContainText("Bacon");
    await expect(bife).toContainText("$ 115 c/u");
    await expect(bife).toContainText("$ 230");
    // 2 × (100 + 15) + 30 = 260; el flan cancelado (5 × 30) no suma ni sale.
    await expect(page.getByTestId("cuenta-total")).toHaveAttribute("data-centavos", "26000");
    await expect(page.getByTestId("cuenta-leyenda")).toHaveText("No válida como factura");
    await expect(hoja).not.toContainText("sin sal");
    await expect(hoja).not.toContainText("cancel");
    await expectNoHorizontalOverflow(page);

    await hoja.getByRole("button", { name: "Cerrar" }).first().click();
    await expect(hoja).toHaveCount(0);
    await ctx.close();
  });

  test("con la cuenta pedida pero sin platos anotados lo dice", async ({ browser }) => {
    const l = await nuevoLocal("cuenta-vacia");
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(`/t/${l.mesa.qr_token}`);
    await pedirCuenta(page).click();
    await page.getByTestId("ver-cuenta").click();
    await expect(page.getByTestId("cuenta-vacia")).toContainText("Todavía no hay platos anotados");
    await ctx.close();
  });

  test("al cobrar la mesa el celular deja de ver la cuenta y pide escanear de nuevo", async ({ browser }) => {
    const l = await nuevoLocal("cuenta-cobro");
    const p = await pedido(l);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(`/t/${l.mesa.qr_token}`);
    await pedirCuenta(page).click();
    await page.getByTestId("ver-cuenta").click();
    await expect(page.getByTestId("cuenta-total")).toHaveAttribute("data-centavos", "26000");

    // El mozo cobra: cierra el pedido. «Actualizar» ya no devuelve ni un importe.
    expect((await p.db.rpc("close_order", { p_order: p.order })).error).toBeNull();
    await page.getByTestId("cuenta-actualizar").click();
    await expect(page.getByTestId("cuenta-vencida")).toContainText("Esta sesión venció");
    await expect(page.getByTestId("cuenta")).toHaveCount(0);
    await expect(page.getByTestId("hoja-cuenta")).not.toContainText("230");

    // Al cerrar la hoja, la barra también pide escanear de nuevo y ya no ofrece la cuenta.
    await page.getByTestId("hoja-cuenta").getByRole("button", { name: "Cerrar" }).first().click();
    await expect(page.getByTestId("sesion-vencida")).toBeVisible();
    await expect(page.getByTestId("ver-cuenta")).toHaveCount(0);

    // Escanear de nuevo: el ticket es nuevo, pero sin «Pedir la cuenta» en el turno nuevo no hay cuenta.
    await page.goto(`/t/${l.mesa.qr_token}`);
    await expect(barra(page)).toBeVisible();
    await expect(page.getByTestId("ver-cuenta")).toHaveCount(0);
    await ctx.close();
  });

  test("reiniciar el QR de la mesa también corta el acceso de quien tenía la cuenta abierta", async ({ browser }) => {
    const l = await nuevoLocal("cuenta-reinicio");
    const p = await pedido(l);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(`/t/${l.mesa.qr_token}`);
    await pedirCuenta(page).click();
    await page.getByTestId("ver-cuenta").click();
    await expect(page.getByTestId("cuenta-total")).toBeVisible();

    expect((await p.db.rpc("reset_table_turn", { p_table: l.mesa.id })).error).toBeNull();
    await page.getByTestId("cuenta-actualizar").click();
    await expect(page.getByTestId("cuenta-vencida")).toBeVisible();
    await expect(page.getByTestId("cuenta")).toHaveCount(0);
    await ctx.close();
  });
});

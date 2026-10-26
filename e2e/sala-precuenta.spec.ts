import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createTenant, expectNoHorizontalOverflow, login, service, type Person, type Tenant } from "./support";

/**
 * Precuenta de un pedido (ficha sala-precuenta, ADR 0041), contra el build y el Supabase local, a 390 px: lo que el mozo le muestra o
 * imprime al cliente antes de cerrar, con la leyenda «No válida como factura».
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
    .insert(["Mesa 1", "Mesa 2"].map((l) => ({ organization_id: t.orgId, branch_id: branch.data!.id, label: l })))
    .select("id, label")
    .order("label");
  if (mesas.error) throw new Error(mesas.error.message);
  const category = await db.from("categories").insert({ organization_id: t.orgId, name: "Platos" }).select("id").single();
  const bife = await db.from("products").insert({ organization_id: t.orgId, category_id: category.data!.id, name: "Bife de chorizo", price_cents: 10000 }).select("id").single();
  const flan = await db.from("products").insert({ organization_id: t.orgId, category_id: category.data!.id, name: "Flan casero", price_cents: 3000 }).select("id").single();
  const grupo = await db.from("option_groups").insert({ organization_id: t.orgId, product_id: bife.data!.id, name: "Extras", min_choices: 0, max_choices: 2 }).select("id").single();
  const opciones = await db
    .from("options")
    .insert([{ organization_id: t.orgId, group_id: grupo.data!.id, name: "Bacon", price_delta_cents: 1500, sort_order: 0 }])
    .select("id");
  return { t, branch: branch.data!.id as string, mesas: mesas.data as { id: string; label: string }[], bife: bife.data!.id as string, flan: flan.data!.id as string, bacon: opciones.data![0].id as string };
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

/** Un pedido en la mesa 1: 2 bifes con bacon y una nota, un flan, y un flan cancelado. Devuelve el id del pedido. */
async function pedido(l: Local) {
  const db = await sesion(l.t.owner);
  const base = { p_branch: l.branch, p_table: l.mesas[0].id };
  const a = await db.rpc("add_order_item", { ...base, p_product: l.bife, p_quantity: 2, p_client_key: randomUUID(), p_options: [l.bacon], p_note: "sin sal, alérgico a la nuez" });
  expect(a.error).toBeNull();
  const b = await db.rpc("add_order_item", { ...base, p_product: l.flan, p_quantity: 1, p_client_key: randomUUID() });
  expect(b.error).toBeNull();
  const c = await db.rpc("add_order_item", { ...base, p_product: l.flan, p_quantity: 5, p_client_key: randomUUID() });
  expect(c.error).toBeNull();
  expect((await db.rpc("set_order_item_status", { p_item: (c.data as { item_id: string }).item_id, p_status: "cancelled" })).error).toBeNull();
  return { db, order: (a.data as { order_id: string }).order_id };
}

test.afterAll(async () => {
  for (const t of tenants) await t.cleanup();
});

test.describe("precuenta", () => {
  test("desde la mesa se ve la precuenta: platos con opciones e importes, sin lo cancelado ni las observaciones, total y leyenda", async ({ browser }) => {
    const l = await nuevoLocal("precuenta-vista");
    await pedido(l);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await login(page, l.t.staff.email, l.t.staff.password);
    await page.goto(`/sala/${l.t.slug}/mesas/${l.mesas[0].id}/anotar`);
    await page.getByTestId("ver-precuenta").click();
    await expect(page).toHaveURL(new RegExp(`/sala/${l.t.slug}/cuenta/[0-9a-f-]{36}$`));

    const cuenta = page.getByTestId("precuenta");
    await expect(cuenta).toContainText("Precuenta");
    await expect(page.getByTestId("precuenta-mesa")).toHaveText("Mesa 1");
    await expect(page.getByTestId("precuenta-fecha")).toHaveText(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
    await expect(page.getByTestId("precuenta-linea")).toHaveCount(2);
    const bife = page.getByTestId("precuenta-linea").filter({ hasText: "Bife" });
    await expect(bife).toContainText("2 × Bife de chorizo");
    await expect(bife).toContainText("Bacon");
    await expect(bife).toContainText("$ 115 c/u");
    await expect(bife).toContainText("$ 230");
    // 2 × (100 + 15) + 30 = 260; el flan cancelado (5 × 30) no suma ni sale.
    await expect(page.getByTestId("precuenta-total")).toHaveAttribute("data-centavos", "26000");
    await expect(page.getByTestId("precuenta-leyenda")).toHaveText("No válida como factura");
    await expect(cuenta).not.toContainText("sin sal");
    await expect(page.getByTestId("precuenta-estado")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    // Volver lleva al pedido de la mesa.
    await page.getByRole("link", { name: "← Volver al pedido" }).click();
    await expect(page).toHaveURL(new RegExp(`/sala/${l.t.slug}/mesas/${l.mesas[0].id}/anotar$`));
    await ctx.close();
  });

  test("al imprimir quedan solo la precuenta y su leyenda: sin botones ni navegación", async ({ browser }) => {
    const l = await nuevoLocal("precuenta-imprimir");
    const p = await pedido(l);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await login(page, l.t.owner.email, l.t.owner.password);
    await page.goto(`/sala/${l.t.slug}/cuenta/${p.order}`);
    await expect(page.getByTestId("imprimir")).toBeVisible();
    await page.emulateMedia({ media: "print" });
    await expect(page.getByTestId("imprimir")).toBeHidden();
    await expect(page.getByRole("link", { name: "← Volver al pedido" })).toBeHidden();
    await expect(page.getByRole("link", { name: "Mesas en vivo", exact: true })).toBeHidden();
    await expect(page.getByTestId("precuenta-leyenda")).toBeVisible();
    await expect(page.getByTestId("precuenta-total")).toBeVisible();
    await ctx.close();
  });

  test("un pedido cerrado o anulado se avisa como tal; sin platos vigentes lo dice y el total es cero", async ({ browser }) => {
    const l = await nuevoLocal("precuenta-estados");
    const a = await pedido(l);
    const db = a.db;
    const otro = await db.rpc("add_order_item", { p_branch: l.branch, p_table: l.mesas[1].id, p_product: l.flan, p_quantity: 1, p_client_key: randomUUID() });
    expect(otro.error).toBeNull();
    const o = otro.data as { order_id: string; item_id: string };
    expect((await db.rpc("set_order_item_status", { p_item: o.item_id, p_status: "cancelled" })).error).toBeNull();
    expect((await db.rpc("close_order", { p_order: a.order })).error).toBeNull();
    expect((await db.rpc("void_order", { p_order: o.order_id, p_reason: "Error de mesa" })).error).toBeNull();

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await login(page, l.t.staff.email, l.t.staff.password);
    await page.goto(`/sala/${l.t.slug}/cuenta/${a.order}`);
    await expect(page.getByTestId("precuenta-estado")).toHaveText("Pedido cerrado");
    await expect(page.getByTestId("precuenta-total")).toHaveAttribute("data-centavos", "26000");
    await page.goto(`/sala/${l.t.slug}/cuenta/${o.order_id}`);
    await expect(page.getByTestId("precuenta-estado")).toContainText("anulado");
    await expect(page.getByTestId("precuenta-vacia")).toBeVisible();
    await expect(page.getByTestId("precuenta-total")).toHaveAttribute("data-centavos", "0");
    await expect(page.getByTestId("precuenta-leyenda")).toBeVisible();
    await ctx.close();
  });

  test("de otro local o con un id inválido da 404; sin sesión manda al login", async ({ browser, page }) => {
    const l = await nuevoLocal("precuenta-acceso");
    const otro = await nuevoLocal("precuenta-ajena");
    const p = await pedido(l);

    await page.goto(`/sala/${l.t.slug}/cuenta/${p.order}`);
    await expect(page).toHaveURL(/\/login/);

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const ajeno = await ctx.newPage();
    await login(ajeno, otro.t.staff.email, otro.t.staff.password);
    expect((await ajeno.goto(`/sala/${otro.t.slug}/cuenta/${p.order}`))?.status()).toBe(404);
    expect((await ajeno.goto(`/sala/${l.t.slug}/cuenta/${p.order}`))?.status()).toBe(404);
    expect((await ajeno.goto(`/sala/${otro.t.slug}/cuenta/no-es-un-uuid`))?.status()).toBe(404);
    expect((await ajeno.goto(`/sala/${otro.t.slug}/cuenta/${randomUUID()}`))?.status()).toBe(404);
    await ctx.close();
  });
});

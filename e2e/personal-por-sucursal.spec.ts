import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPerson, createTenant, deleteAccountsByEmail, expectNoHorizontalOverflow, login, service, type Tenant } from "./support";

/**
 * Personal por sucursal, SOLO PANTALLA (ficha personal-por-sucursal), contra el build y el Supabase local, a 390 px: el Dueño asigna
 * una sucursal a un mozo desde Personal y el mozo solo ve las mesas, los pedidos y los llamados de esa; el cocinero asignado solo
 * ve los pedidos de la suya. No es un permiso: la restricción real es otro cambio.
 */

const tenants: Tenant[] = [];
const extras: string[] = [];

async function nuevoLocal(label: string) {
  const t = await createTenant(label);
  tenants.push(t);
  const db = service();
  await db.from("subscriptions").update({ plan_code: "pro" }).eq("organization_id", t.orgId);
  const centro = await db.from("branches").select("id, name").eq("organization_id", t.orgId).single();
  const norte = await db.from("branches").insert({ organization_id: t.orgId, slug: "norte", name: "Norte" }).select("id, name").single();
  if (norte.error) throw new Error(norte.error.message);
  const mesas = await db
    .from("tables")
    .insert([
      { organization_id: t.orgId, branch_id: centro.data!.id, label: "Mesa del centro" },
      { organization_id: t.orgId, branch_id: norte.data.id, label: "Mesa del norte" },
    ])
    .select("id, label, branch_id");
  if (mesas.error) throw new Error(mesas.error.message);
  const category = await db.from("categories").insert({ organization_id: t.orgId, name: "Platos" }).select("id").single();
  const plato = await db.from("products").insert({ organization_id: t.orgId, category_id: category.data!.id, name: "Bife", price_cents: 10000 }).select("id").single();
  if (plato.error) throw new Error(plato.error.message);
  const cook = await createPerson(`${label}-c`, t.orgId, "cook");
  extras.push(cook.email);
  const mesa = (label: string) => mesas.data.find((m) => m.label === label)!;
  const l = {
    t,
    centro: { id: centro.data!.id as string, name: centro.data!.name as string, mesa: mesa("Mesa del centro").id as string },
    norte: { id: norte.data.id as string, name: norte.data.name as string, mesa: mesa("Mesa del norte").id as string },
    plato: plato.data.id as string,
    cook,
  };
  // Un pedido en cada sucursal, anotado por el Staff.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  const sesion = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const entrada = await sesion.auth.signInWithPassword({ email: t.staff.email, password: t.staff.password });
  expect(entrada.error).toBeNull();
  for (const rama of [l.centro, l.norte]) {
    const r = await sesion.rpc("add_order_item", { p_branch: rama.id, p_table: rama.mesa, p_product: l.plato, p_quantity: 1, p_client_key: randomUUID() });
    expect(r.error).toBeNull();
  }
  return l;
}

const asignar = async (userId: string, orgId: string, branches: string[]) => {
  const r = await service().from("memberships").update({ assigned_branch_ids: branches }).eq("organization_id", orgId).eq("user_id", userId);
  expect(r.error).toBeNull();
};

test.afterAll(async () => {
  for (const t of tenants) await t.cleanup();
  await deleteAccountsByEmail(extras);
});

test.describe("personal por sucursal", () => {
  test("el Dueño asigna una sucursal al mozo desde Personal y el mozo solo ve esa", async ({ browser }) => {
    const l = await nuevoLocal("personal-sucursal");

    // El Dueño asigna.
    const ctxDueno = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const dueno = await ctxDueno.newPage();
    await login(dueno, l.t.owner.email, l.t.owner.password);
    await dueno.goto(`/panel/${l.t.slug}/personal`);
    const fila = dueno.locator(`[data-testid="member-row"][data-email="${l.t.staff.email}"]`);
    await expect(fila.getByTestId("member-sucursales")).toHaveText("Ve todas las sucursales.");
    await expectNoHorizontalOverflow(dueno);
    await fila.getByText("Sucursales", { exact: true }).click();
    await fila.getByLabel(l.centro.name).check();
    await fila.getByRole("button", { name: "Guardar sucursales" }).click();
    await expect(fila.getByTestId("member-sucursales")).toHaveText(`Solo ve: ${l.centro.name}.`);
    // El Dueño no tiene selector propio de personal asignado: sigue viendo todo.
    await dueno.goto(`/sala/${l.t.slug}/mesas`);
    await expect(dueno.getByTestId("mesa")).toHaveCount(2);
    await ctxDueno.close();

    // El mozo ve solo lo de su sucursal.
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mozo = await ctx.newPage();
    await login(mozo, l.t.staff.email, l.t.staff.password);
    await mozo.goto(`/sala/${l.t.slug}/mesas`);
    await expect(mozo.getByTestId("mesa")).toHaveCount(1);
    await expect(mozo.getByTestId("mesa").first()).toContainText("Mesa del centro");
    await expect(mozo.locator("main")).not.toContainText("Mesa del norte");
    await expect(mozo.locator("main")).not.toContainText(l.norte.name);
    await expect(mozo.getByTestId("selector-sucursal")).toHaveCount(0);
    await expectNoHorizontalOverflow(mozo);

    // Por URL, la mesa de la otra sucursal no existe; la propia sí.
    expect((await mozo.goto(`/sala/${l.t.slug}/mesas/${l.norte.mesa}/anotar`))?.status()).toBe(404);
    expect((await mozo.goto(`/sala/${l.t.slug}/mesas/${l.centro.mesa}/anotar`))?.status()).toBe(200);

    // Sin restricción vuelve a ver todo.
    await asignar(l.t.staff.id, l.t.orgId, []);
    await mozo.goto(`/sala/${l.t.slug}/mesas`);
    await expect(mozo.getByTestId("mesa")).toHaveCount(2);
    await ctx.close();
  });

  test("el cocinero asignado solo ve los pedidos y la carta de su sucursal", async ({ browser }) => {
    const l = await nuevoLocal("personal-cocina");
    await asignar(l.cook.id, l.t.orgId, [l.norte.id]);

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await login(page, l.cook.email, l.cook.password);
    await expect(page.getByTestId("pedido-cocina")).toHaveCount(1);
    await expect(page.getByTestId("pedido-cocina")).toHaveAttribute("data-mesa", "Mesa del norte");
    await expectNoHorizontalOverflow(page);

    const estado = await page.request.get(`/cocina/${l.t.slug}/estado`);
    expect(estado.status()).toBe(200);
    expect(JSON.stringify(await estado.json())).not.toContain("Mesa del centro");

    await page.goto(`/cocina/${l.t.slug}/carta`);
    await expect(page.getByTestId("plato-cocina")).toHaveCount(1);
    await expect(page.getByRole("link", { name: l.centro.name })).toHaveCount(0);
    await ctx.close();
  });

  test("si la única sucursal asignada se desactiva, el mozo no ve nada (nunca todas)", async ({ browser }) => {
    const l = await nuevoLocal("personal-desactivada");
    await asignar(l.t.staff.id, l.t.orgId, [l.norte.id]);
    const off = await service().from("branches").update({ is_active: false }).eq("id", l.norte.id);
    expect(off.error).toBeNull();

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await login(page, l.t.staff.email, l.t.staff.password);
    await page.goto(`/sala/${l.t.slug}/mesas`);
    await expect(page.getByTestId("mesa")).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText("Mesa del centro");
    await ctx.close();
  });
});

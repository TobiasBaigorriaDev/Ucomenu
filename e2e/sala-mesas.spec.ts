import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createTenant, expectNoHorizontalOverflow, login, service, type Person, type Tenant } from "./support";

/**
 * Vista «Mesas» de la Sala y total en «Pide la cuenta» (ficha sala-mesas-y-total, ADR 0041), contra el build y el Supabase local, a
 * 390 px: qué ve el personal de cada mesa, que se actualiza sola, que respeta el plan y que el acceso es el de la Sala.
 */

const tenants: Tenant[] = [];

type Mesa = { id: string; label: string; qr_token: string };

async function nuevoLocal(label: string, plan: "basic" | "pro" = "pro") {
  const t = await createTenant(label);
  tenants.push(t);
  const db = service();
  if (plan === "pro") await db.from("subscriptions").update({ plan_code: "pro" }).eq("organization_id", t.orgId);
  const branch = await db.from("branches").select("id").eq("organization_id", t.orgId).single();
  const mesas = await db
    .from("tables")
    .insert(["Mesa 1", "Mesa 2", "Mesa 3"].map((l) => ({ organization_id: t.orgId, branch_id: branch.data!.id, label: l })))
    .select("id, label, qr_token")
    .order("label");
  if (mesas.error) throw new Error(mesas.error.message);
  const category = await db.from("categories").insert({ organization_id: t.orgId, name: "Platos" }).select("id").single();
  const product = await db.from("products").insert({ organization_id: t.orgId, category_id: category.data!.id, name: "Bife", price_cents: 10000 }).select("id").single();
  return { t, branch: branch.data!.id as string, mesas: mesas.data as Mesa[], product: product.data!.id as string };
}

/** El mozo anota con su sesión (la única puerta de escritura de los pedidos). */
async function anotar(persona: Person, l: { branch: string; product: string }, mesa: Mesa, cantidad = 1) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const sesion = await db.auth.signInWithPassword({ email: persona.email, password: persona.password });
  expect(sesion.error).toBeNull();
  const r = await db.rpc("add_order_item", { p_branch: l.branch, p_table: mesa.id, p_product: l.product, p_quantity: cantidad, p_client_key: randomUUID() });
  expect(r.error).toBeNull();
}

async function llamar(token: string, kind: "waiter" | "bill") {
  const { error } = await service().rpc("create_waiter_call", { p_token: token, p_kind: kind });
  expect(error).toBeNull();
}

async function abrir(page: Page, persona: Person, t: Tenant, ruta: "" | "/mesas") {
  await login(page, persona.email, persona.password);
  await page.goto(`/sala/${t.slug}${ruta}`);
}

const mesaCard = (page: Page, mesa: string) => page.locator(`[data-testid="mesa"][data-mesa="${mesa}"]`);

test.afterAll(async () => {
  for (const t of tenants) await t.cleanup();
});

test.describe("vista Mesas", () => {
  test("el Staff ve las mesas con su pedido y el total, el enlace está en la Sala y la página se actualiza sola", async ({ browser }) => {
    const l = await nuevoLocal("mesas-vista");
    await anotar(l.t.owner, l, l.mesas[0], 2);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await abrir(page, l.t.staff, l.t, "");
    await expect(page.getByRole("heading", { name: "Sala en vivo" })).toBeVisible();
    await page.getByRole("link", { name: "Mesas", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/sala/${l.t.slug}/mesas$`));
    await expect(page.getByRole("heading", { name: "Mesas" })).toBeVisible();

    const m1 = mesaCard(page, "Mesa 1");
    await expect(m1).toHaveAttribute("data-estado", "pedido");
    await expect(m1.getByTestId("pedido-estado")).toHaveText("2 platos · 2 anotados");
    await expect(m1.getByTestId("pedido-total")).toHaveAttribute("data-centavos", "20000");
    await expect(m1.getByTestId("pedido-total")).toContainText("200");
    await expect(mesaCard(page, "Mesa 2")).toHaveAttribute("data-estado", "libre");
    await expect(mesaCard(page, "Mesa 2")).toContainText("Libre");
    await expectNoHorizontalOverflow(page);

    // Se actualiza sola: otra línea en la misma mesa suma al total; una mesa que pide la cuenta sube primero.
    await anotar(l.t.owner, l, l.mesas[0], 1);
    await expect(m1.getByTestId("pedido-total")).toHaveAttribute("data-centavos", "30000", { timeout: 12_000 });
    await llamar(l.mesas[2].qr_token, "bill");
    await expect(mesaCard(page, "Mesa 3")).toHaveAttribute("data-estado", "cuenta", { timeout: 12_000 });
    await expect(page.locator('[data-testid="mesa"]').first()).toHaveAttribute("data-mesa", "Mesa 3");
    await expect(mesaCard(page, "Mesa 3")).toContainText("Pide la cuenta");
    await ctx.close();
  });

  test("«Pide la cuenta» en la Sala de llamados muestra el total del pedido; atender el llamado no cierra el pedido", async ({ browser }) => {
    const l = await nuevoLocal("mesas-cuenta");
    await anotar(l.t.owner, l, l.mesas[1], 3);
    await llamar(l.mesas[1].qr_token, "bill");
    await llamar(l.mesas[0].qr_token, "bill"); // sin pedido
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await abrir(page, l.t.staff, l.t, "");

    const conPedido = page.locator('[data-testid="llamado"][data-mesa="Mesa 2"]');
    await expect(conPedido.getByTestId("cuenta")).toContainText("Cuenta: $ 300 · 3 platos");
    await expect(conPedido.getByTestId("cuenta")).toHaveAttribute("data-centavos", "30000");
    await expect(page.locator('[data-testid="llamado"][data-mesa="Mesa 1"]').getByTestId("cuenta")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    await conPedido.getByRole("button", { name: /Marcar como atendido/ }).click();
    await expect(conPedido).toHaveCount(0);
    const abierto = await service().from("orders").select("status").eq("organization_id", l.t.orgId).eq("table_id", l.mesas[1].id).single();
    expect(abierto.data?.status).toBe("open");
    await page.goto(`/sala/${l.t.slug}/mesas`);
    await expect(mesaCard(page, "Mesa 2")).toHaveAttribute("data-estado", "pedido");
    await expect(mesaCard(page, "Mesa 2").getByTestId("pedido-total")).toHaveAttribute("data-centavos", "30000");
    await ctx.close();
  });

  test("sin la función de pedidos (plan Básico) la página lo explica y no lista nada", async ({ browser }) => {
    const l = await nuevoLocal("mesas-basico", "basic");
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await abrir(page, l.t.staff, l.t, "/mesas");
    await expect(page.getByTestId("mesas-deshabilitada")).toContainText("Los pedidos no están disponibles");
    await expect(page.getByTestId("mesas-deshabilitada")).toContainText("Avisale al dueño");
    await expect(page.getByTestId("mesa")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await ctx.close();

    const ctxDueno = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const dueno = await ctxDueno.newPage();
    await abrir(dueno, l.t.owner, l.t, "/mesas");
    await expect(dueno.getByTestId("mesas-deshabilitada")).toContainText("plan Pro");
    await ctxDueno.close();
  });

  test("la ruta de consulta responde como la de la Sala: sin sesión 401, de otro local 404, del local 200 sin caché", async ({ browser, request }) => {
    const l = await nuevoLocal("mesas-ruta");
    const otro = await nuevoLocal("mesas-ruta-otro");
    const sinSesion = await request.get(`/sala/${l.t.slug}/mesas/estado`, { maxRedirects: 0 });
    expect([401, 307, 308]).toContain(sinSesion.status());

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, otro.t.staff.email, otro.t.staff.password);
    const ajeno = await page.request.get(`/sala/${l.t.slug}/mesas/estado`);
    expect(ajeno.status()).toBe(404);
    const propio = await page.request.get(`/sala/${otro.t.slug}/mesas/estado`);
    expect(propio.status()).toBe(200);
    expect(propio.headers()["cache-control"]).toContain("no-store");
    const cuerpo = await propio.json();
    expect(cuerpo).toMatchObject({ enabled: true });
    expect(cuerpo.mesas).toHaveLength(3);
    await ctx.close();
  });
});

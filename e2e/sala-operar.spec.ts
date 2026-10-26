import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createTenant, expectNoHorizontalOverflow, login, service, type Person, type Tenant } from "./support";

/**
 * Operar el pedido desde la Sala (ficha sala-operar-pedido, ADR 0041), contra el build y el Supabase local, a 390 px: pasar líneas a
 * «en cocina» y «entregado», modificar, cancelar (con motivo si ya se entregó), cerrar y anular, y lo que pasa si otra persona cambió
 * algo o si el plan ya no incluye los pedidos.
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
  const plato = async (name: string, price_cents: number) => {
    const p = await db.from("products").insert({ organization_id: t.orgId, category_id: category.data!.id, name, price_cents }).select("id").single();
    if (p.error) throw new Error(p.error.message);
    return p.data.id as string;
  };
  const bife = await plato("Bife de chorizo", 10000);
  const flan = await plato("Flan casero", 3000);
  return { t, branch: branch.data!.id as string, mesas: mesas.data as { id: string; label: string }[], bife, flan };
}
type Local = Awaited<ReturnType<typeof nuevoLocal>>;

/** El mozo anota con su sesión (la única puerta de escritura de los pedidos). Devuelve los ids de la línea y del pedido. */
async function anotar(persona: Person, l: Local, producto: string, cantidad = 1, nota?: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const sesion = await db.auth.signInWithPassword({ email: persona.email, password: persona.password });
  expect(sesion.error).toBeNull();
  const r = await db.rpc("add_order_item", { p_branch: l.branch, p_table: l.mesas[0].id, p_product: producto, p_quantity: cantidad, p_client_key: randomUUID(), p_note: nota as string });
  expect(r.error).toBeNull();
  const d = r.data as { item_id: string; order_id: string };
  return { db, item: d.item_id, order: d.order_id };
}

async function abrir(page: Page, l: Local, quien: "owner" | "staff" = "staff") {
  await login(page, l.t[quien].email, l.t[quien].password);
  await page.goto(`/sala/${l.t.slug}/mesas/${l.mesas[0].id}/anotar`);
  await expect(page.getByTestId("anotar-mesa")).toHaveText("Mesa 1");
}

const linea = (page: Page, plato: string) => page.locator('[data-testid="linea"]').filter({ hasText: plato });
const estados = async (l: Local) => {
  const r = await service().from("order_items").select("product_name, status, quantity, note, cancel_reason").eq("organization_id", l.t.orgId).order("created_at");
  return r.data!;
};

test.afterAll(async () => {
  for (const t of tenants) await t.cleanup();
});

test.describe("operar el pedido", () => {
  test("una línea avanza anotado → listo (lo marca la cocina) → entregado, o directo a entregado; la entregada solo se puede cancelar", async ({ browser }) => {
    const l = await nuevoLocal("operar-estados");
    const pedidoBife = await anotar(l.t.owner, l, l.bife, 2);
    await anotar(l.t.owner, l, l.flan, 1);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await abrir(page, l);
    await expectNoHorizontalOverflow(page);

    const bife = linea(page, "Bife");
    await expect(bife).toHaveAttribute("data-estado", "noted");
    // «En cocina» ya no se ofrece: la cocina marca «listo».
    await expect(bife.getByRole("button")).toHaveText(["Entregado", "Modificar", "Cancelar"]);
    const listo = await pedidoBife.db.rpc("set_order_item_status", { p_item: pedidoBife.item, p_status: "ready" });
    expect(listo.error).toBeNull();
    await page.reload();
    await expect(bife).toHaveAttribute("data-estado", "ready");
    await expect(bife.getByTestId("linea-estado")).toHaveText("Listo para entregar");
    // Lista ya no se modifica, y sigue pudiendo entregarse o cancelarse.
    await expect(bife.getByRole("button")).toHaveText(["Entregado", "Cancelar"]);
    await bife.getByRole("button", { name: /Marcar entregado/ }).click();
    await expect(bife).toHaveAttribute("data-estado", "delivered");
    await expect(bife.getByRole("button")).toHaveText(["Cancelar"]);

    // Sin pasar por la cocina.
    const flan = linea(page, "Flan");
    await flan.getByRole("button", { name: /Marcar entregado/ }).click();
    await expect(flan).toHaveAttribute("data-estado", "delivered");
    await expect(page.getByTestId("pedido-resumen")).toHaveText("3 platos · 3 entregados");

    expect((await estados(l)).map((x) => [x.product_name, x.status])).toEqual([["Bife de chorizo", "delivered"], ["Flan casero", "delivered"]]);
    await expectNoHorizontalOverflow(page);
    await ctx.close();
  });

  test("modificar cantidad y observación de una línea anotada actualiza la línea y el total", async ({ browser }) => {
    const l = await nuevoLocal("operar-modificar");
    await anotar(l.t.owner, l, l.bife, 1, "sin sal");
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await abrir(page, l);
    await expect(page.getByTestId("pedido-total")).toHaveAttribute("data-centavos", "10000");

    await linea(page, "Bife").getByRole("button", { name: /Modificar/ }).click();
    const hoja = page.getByTestId("hoja-editar");
    await expect(hoja).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expect(page.getByTestId("editar-guardar")).toBeDisabled(); // sin cambios
    await hoja.getByLabel("Una más").click();
    await hoja.getByLabel("Una más").click();
    await expect(page.getByTestId("editar-cantidad")).toHaveText("3");
    await hoja.getByLabel("Observación").fill("  bien cocido ");
    await page.getByTestId("editar-guardar").click();

    await expect(hoja).toHaveCount(0);
    await expect(linea(page, "Bife")).toContainText("3 × Bife de chorizo");
    await expect(linea(page, "Bife")).toContainText("«bien cocido»");
    await expect(page.getByTestId("pedido-total")).toHaveAttribute("data-centavos", "30000");
    expect((await estados(l))[0]).toMatchObject({ quantity: 3, note: "bien cocido" });

    // Vaciar la observación la quita.
    await linea(page, "Bife").getByRole("button", { name: /Modificar/ }).click();
    await page.getByTestId("hoja-editar").getByLabel("Observación").fill("");
    await page.getByTestId("editar-guardar").click();
    await expect(page.getByTestId("hoja-editar")).toHaveCount(0);
    await expect(linea(page, "Bife")).not.toContainText("bien cocido");
    expect((await estados(l))[0].note).toBeNull();
    await ctx.close();
  });

  test("cancelar una línea pide confirmación; la entregada exige motivo y queda a la vista; lo cancelado no suma", async ({ browser }) => {
    const l = await nuevoLocal("operar-cancelar");
    await anotar(l.t.owner, l, l.bife, 1);
    const entregada = await anotar(l.t.owner, l, l.flan, 2);
    expect((await entregada.db.rpc("set_order_item_status", { p_item: entregada.item, p_status: "delivered" })).error).toBeNull();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await abrir(page, l);
    await expect(page.getByTestId("pedido-total")).toHaveAttribute("data-centavos", "16000");

    // Una anotada: confirmación, motivo opcional.
    await linea(page, "Bife").getByRole("button", { name: /Cancelar línea/ }).click();
    let hoja = page.getByTestId("hoja-cancelar");
    await expect(hoja).toBeVisible();
    await expect(page.getByTestId("cancelar-confirmar")).toBeEnabled();
    await expectNoHorizontalOverflow(page);
    await page.getByTestId("cancelar-confirmar").click();
    await expect(hoja).toHaveCount(0);
    await expect(linea(page, "Bife")).toHaveAttribute("data-estado", "cancelled");
    await expect(linea(page, "Bife").getByRole("button")).toHaveCount(0);
    await expect(page.getByTestId("pedido-total")).toHaveAttribute("data-centavos", "6000");

    // Una entregada: sin motivo no se puede.
    await linea(page, "Flan").getByRole("button", { name: /Cancelar línea/ }).click();
    hoja = page.getByTestId("hoja-cancelar");
    await expect(hoja).toContainText("el motivo es obligatorio");
    await expect(page.getByTestId("cancelar-confirmar")).toBeDisabled();
    await hoja.getByLabel(/Motivo/).fill("Llegó frío");
    await page.getByTestId("cancelar-confirmar").click();
    await expect(hoja).toHaveCount(0);
    await expect(linea(page, "Flan")).toHaveAttribute("data-estado", "cancelled");
    await expect(linea(page, "Flan").getByTestId("linea-estado")).toHaveText("Cancelado · Llegó frío");
    await expect(page.getByTestId("pedido-total")).toHaveAttribute("data-centavos", "0");

    const filas = await estados(l);
    expect(filas.map((x) => [x.product_name, x.status, x.cancel_reason])).toEqual([["Bife de chorizo", "cancelled", null], ["Flan casero", "cancelled", "Llegó frío"]]);
    await ctx.close();
  });

  test("cerrar el pedido avisa si hay platos sin entregar, libera la mesa y vuelve a «Mesas»", async ({ browser }) => {
    const l = await nuevoLocal("operar-cerrar");
    await anotar(l.t.owner, l, l.bife, 2);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await abrir(page, l);
    await page.getByTestId("abrir-cierre").click();
    const hoja = page.getByTestId("hoja-cierre");
    await expect(hoja).toBeVisible();
    await expect(page.getByTestId("cierre-resumen")).toContainText("2 platos");
    await expect(page.getByTestId("cierre-resumen")).toContainText("200");
    await expect(page.getByTestId("sin-entregar")).toContainText("Hay 2 platos sin entregar");
    await expectNoHorizontalOverflow(page);
    await page.getByTestId("cerrar-pedido").click();

    await expect(page).toHaveURL(new RegExp(`/sala/${l.t.slug}/mesas$`));
    await expect(page.locator('[data-testid="mesa"][data-mesa="Mesa 1"]')).toHaveAttribute("data-estado", "libre");
    const pedido = await service().from("orders").select("status, closed_at").eq("organization_id", l.t.orgId).single();
    expect(pedido.data?.status).toBe("closed");
    expect(pedido.data?.closed_at).not.toBeNull();

    // La mesa admite un pedido nuevo, y el viejo no aparece.
    await page.goto(`/sala/${l.t.slug}/mesas/${l.mesas[0].id}/anotar`);
    await expect(page.getByTestId("sin-lineas")).toBeVisible();
    await expect(page.getByTestId("abrir-cierre")).toHaveCount(0);
    await ctx.close();
  });

  test("anular exige un motivo y deja la mesa libre", async ({ browser }) => {
    const l = await nuevoLocal("operar-anular");
    const a = await anotar(l.t.owner, l, l.bife, 1);
    expect((await a.db.rpc("set_order_item_status", { p_item: a.item, p_status: "delivered" })).error).toBeNull();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await abrir(page, l, "owner");
    await page.getByTestId("abrir-cierre").click();
    await expect(page.getByTestId("sin-entregar")).toHaveCount(0); // todo entregado: nada que avisar
    await page.getByTestId("ir-a-anular").click();
    await expect(page.getByTestId("anular-pedido")).toBeDisabled();
    await expectNoHorizontalOverflow(page);
    await page.getByLabel("Motivo de la anulación").fill("Se fueron sin pedir");
    await page.getByTestId("anular-pedido").click();

    await expect(page).toHaveURL(new RegExp(`/sala/${l.t.slug}/mesas$`));
    await expect(page.locator('[data-testid="mesa"][data-mesa="Mesa 1"]')).toHaveAttribute("data-estado", "libre");
    const pedido = await service().from("orders").select("status, void_reason").eq("organization_id", l.t.orgId).single();
    expect(pedido.data).toMatchObject({ status: "void", void_reason: "Se fueron sin pedir" });
    await ctx.close();
  });

  test("si otra persona ya cambió la línea, lo dice y muestra el estado vigente sin pisarlo", async ({ browser }) => {
    const l = await nuevoLocal("operar-concurrente");
    const a = await anotar(l.t.owner, l, l.bife, 1);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await abrir(page, l);
    await expect(linea(page, "Bife")).toHaveAttribute("data-estado", "noted");

    // Otro mozo la cancela mientras esta pantalla sigue mostrándola como anotada.
    expect((await a.db.rpc("set_order_item_status", { p_item: a.item, p_status: "cancelled" })).error).toBeNull();
    await linea(page, "Bife").getByRole("button", { name: /Marcar entregado/ }).click();
    await expect(linea(page, "Bife").getByTestId("linea-error")).toContainText("Otra persona ya cambió esta línea");
    await expect(linea(page, "Bife")).toHaveAttribute("data-estado", "cancelled");
    expect((await estados(l))[0].status).toBe("cancelled");
    await ctx.close();
  });

  test("con el plan sin pedidos se ve el pedido abierto, no se puede anotar ni cambiar líneas, pero sí cerrarlo", async ({ browser }) => {
    const l = await nuevoLocal("operar-sinplan");
    await anotar(l.t.owner, l, l.bife, 1);
    await service().from("subscriptions").update({ plan_code: "basic" }).eq("organization_id", l.t.orgId);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await abrir(page, l, "owner");
    await expect(page.getByTestId("anotar-deshabilitada")).toContainText("Los pedidos no están disponibles");
    await expect(page.getByTestId("anotar-deshabilitada")).toContainText("cerrar o anular");
    await expect(linea(page, "Bife")).toHaveCount(1);
    await expect(linea(page, "Bife").getByRole("button")).toHaveCount(0);
    await expect(page.getByTestId("abrir-carta")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    await page.getByTestId("abrir-cierre").click();
    await page.getByTestId("cerrar-pedido").click();
    await expect(page).toHaveURL(new RegExp(`/sala/${l.t.slug}/mesas$`));
    const pedido = await service().from("orders").select("status").eq("organization_id", l.t.orgId).single();
    expect(pedido.data?.status).toBe("closed");
    await ctx.close();
  });
});

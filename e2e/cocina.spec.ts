import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { conDobles, sonidos } from "./audio-doble";
import { createPerson, createTenant, deleteAccountsByEmail, expectNoHorizontalOverflow, login, service, TEST_PASSWORD, type Person, type Tenant } from "./support";

/**
 * Rol de cocinero (ficha rol-cocinero, ADR 0048), contra el build y el Supabase local, a 390 px: el cocinero entra a su pantalla, ve
 * los pedidos sin precios, marca «listo» y agota platos; no entra a la Sala ni al panel; el mozo se entera de lo que está listo; y el
 * Dueño lo suma desde Personal (solo con pedidos en el plan).
 */

type Local = Awaited<ReturnType<typeof nuevoLocal>>;
const tenants: Tenant[] = [];
const extras: string[] = [];

async function nuevoLocal(label: string, plan: "basic" | "pro" = "pro") {
  const t = await createTenant(label);
  tenants.push(t);
  const db = service();
  await db.from("subscriptions").update({ plan_code: plan }).eq("organization_id", t.orgId);
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
  const cook = await createPerson(`${label}-c`, t.orgId, "cook");
  extras.push(cook.email);
  return { t, branch: branch.data!.id as string, mesas: mesas.data as { id: string; label: string }[], bife, flan, cook };
}

/** Un cliente con la sesión de la persona (la única puerta de escritura de los pedidos). */
async function sesion(persona: Person) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const s = await db.auth.signInWithPassword({ email: persona.email, password: persona.password });
  expect(s.error).toBeNull();
  return db;
}

async function anotar(l: Local, producto: string, cantidad = 1, nota?: string) {
  const db = await sesion(l.t.staff);
  const r = await db.rpc("add_order_item", { p_branch: l.branch, p_table: l.mesas[0].id, p_product: producto, p_quantity: cantidad, p_client_key: randomUUID(), p_note: nota as string });
  expect(r.error).toBeNull();
  return (r.data as { item_id: string; order_id: string }).item_id;
}

const estadoDe = async (item: string) => (await service().from("order_items").select("status").eq("id", item).single()).data?.status;
const linea = (page: Page, plato: string) => page.locator('[data-testid="linea-cocina"]').filter({ hasText: plato });

test.afterAll(async () => {
  for (const t of tenants) await t.cleanup();
  await deleteAccountsByEmail(extras);
});

test.describe("pantalla de cocina", () => {
  test("el cocinero entra a su pantalla, ve el pedido sin precios, marca listo y lo deshace", async ({ browser }) => {
    const l = await nuevoLocal("cocina-pedidos");
    const item = await anotar(l, l.bife, 2, "sin sal");
    await anotar(l, l.flan, 1);

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await login(page, l.cook.email, l.cook.password);
    await expect(page).toHaveURL(new RegExp(`/cocina/${l.t.slug}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Pedidos en cocina" })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const pedido = page.getByTestId("pedido-cocina");
    await expect(pedido).toHaveCount(1);
    await expect(pedido).toHaveAttribute("data-mesa", "Mesa 1");
    const bife = linea(page, "Bife");
    await expect(bife).toContainText("2 × Bife de chorizo");
    await expect(bife.getByTestId("observacion")).toHaveText("Observación: sin sal");
    // Sin precios ni totales en ningún lado.
    await expect(page.locator("main")).not.toContainText("$");
    await expect(page.locator("main")).not.toContainText(/total/i);

    // Los botones miden al menos 44 px.
    const boton = bife.getByRole("button", { name: /Marcar listo/ });
    expect((await boton.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await boton.click();
    await expect(bife).toHaveAttribute("data-estado", "ready");
    await expect(bife.getByTestId("plato-listo")).toHaveText("Listo");
    expect(await estadoDe(item)).toBe("ready");

    await bife.getByRole("button", { name: /Deshacer listo/ }).click();
    await expect(bife).toHaveAttribute("data-estado", "pending");
    expect(await estadoDe(item)).toBe("noted");

    // Todo listo: el pedido queda al final avisando que espera al mozo.
    await bife.getByRole("button", { name: /Marcar listo/ }).click();
    await linea(page, "Flan").getByRole("button", { name: /Marcar listo/ }).click();
    await expect(pedido.getByTestId("todo-listo")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await ctx.close();
  });

  test("lo que anota el mozo aparece solo y suena como plato nuevo; lo cerrado desaparece", async ({ browser }) => {
    const l = await nuevoLocal("cocina-vivo");
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await conDobles(ctx);
    const page = await ctx.newPage();
    await login(page, l.cook.email, l.cook.password);
    await expect(page.getByTestId("sin-pedidos")).toBeVisible();
    await page.getByTestId("activar-sonido-cocina").click();
    await expect.poll(() => sonidos(page)).toEqual(["notification"]);

    const item = await anotar(l, l.bife, 1);
    await expect(linea(page, "Bife")).toBeVisible({ timeout: 15_000 });
    await expect(linea(page, "Bife")).toHaveAttribute("data-nuevo", "true");
    await expect(page.getByTestId("anuncio-cocina")).toContainText("Plato nuevo en cocina");
    await expect.poll(() => sonidos(page)).toEqual(["notification", "notification"]);

    const staff = await sesion(l.t.staff);
    const cerrado = await staff.rpc("set_order_item_status", { p_item: item, p_status: "delivered" });
    expect(cerrado.error).toBeNull();
    await expect(page.getByTestId("sin-pedidos")).toBeVisible({ timeout: 15_000 });
    await ctx.close();
  });

  test("el mozo se entera en Mesas de que un plato está listo", async ({ browser }) => {
    const l = await nuevoLocal("cocina-mozo");
    const item = await anotar(l, l.bife, 1);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await login(page, l.t.staff.email, l.t.staff.password);
    await page.goto(`/sala/${l.t.slug}/mesas`);
    const mesa = page.getByTestId("mesa").filter({ hasText: "Mesa 1" });
    await expect(mesa).toHaveAttribute("data-estado", "pedido");

    const cocina = await sesion(l.cook);
    const listo = await cocina.rpc("set_order_item_status", { p_item: item, p_status: "ready" });
    expect(listo.error).toBeNull();

    await expect(mesa).toHaveAttribute("data-estado", "listo", { timeout: 15_000 });
    await expect(mesa.getByTestId("pedido-listo")).toContainText("Listo para entregar");
    await expect(page.getByTestId("anuncio")).toContainText("Listo para entregar: Mesa 1");
    await expectNoHorizontalOverflow(page);

    // Si la cocina se equivoca, lo deshace y lo vuelve a marcar, el mozo se entera otra vez (el aviso no se pierde).
    await expect(page.getByTestId("aviso-nuevo")).toBeVisible();
    await expect(page.getByTestId("aviso-nuevo")).toBeHidden({ timeout: 15_000 });
    expect((await cocina.rpc("set_order_item_status", { p_item: item, p_status: "noted" })).error).toBeNull();
    await expect(mesa).toHaveAttribute("data-estado", "pedido", { timeout: 15_000 });
    expect((await cocina.rpc("set_order_item_status", { p_item: item, p_status: "ready" })).error).toBeNull();
    await expect(mesa).toHaveAttribute("data-estado", "listo", { timeout: 15_000 });
    await expect(page.getByTestId("aviso-nuevo")).toBeVisible();

    // El mozo lo entrega desde el pedido de la mesa (ya no hay «En cocina»).
    await page.goto(`/sala/${l.t.slug}/mesas/${l.mesas[0].id}/anotar`);
    const fila = page.locator('[data-testid="linea"]').filter({ hasText: "Bife" });
    await expect(fila.getByTestId("linea-estado")).toHaveText("Listo para entregar");
    await expect(fila.getByRole("button", { name: /Pasar a cocina/ })).toHaveCount(0);
    await fila.getByRole("button", { name: /Marcar entregado/ }).click();
    await expect(fila).toHaveAttribute("data-estado", "delivered");
    expect(await estadoDe(item)).toBe("delivered");
    await ctx.close();
  });

  test("agota un plato y lo vuelve a habilitar; solo cambia is_available", async ({ browser }) => {
    const l = await nuevoLocal("cocina-agotados");
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await login(page, l.cook.email, l.cook.password);
    await page.goto(`/cocina/${l.t.slug}/carta`);
    await expect(page.getByRole("heading", { level: 1, name: "Platos agotados" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expect(page.locator("main")).not.toContainText("$");

    const flan = page.getByTestId("plato-cocina").filter({ hasText: "Flan casero" });
    await expect(flan).toHaveAttribute("data-disponible", "true");
    await flan.getByRole("button", { name: /Marcar agotado/ }).click();
    await expect(flan).toHaveAttribute("data-disponible", "false");
    await expect(page.getByTestId("resumen-agotados")).toHaveText("1 plato agotado en esta sucursal.");
    const ajuste = async () => (await service().from("product_availability").select("is_available, is_visible, price_cents").eq("product_id", l.flan).eq("branch_id", l.branch).single()).data;
    expect(await ajuste()).toEqual({ is_available: false, is_visible: true, price_cents: null });

    await page.reload();
    await expect(page.getByTestId("plato-cocina").filter({ hasText: "Flan casero" })).toHaveAttribute("data-disponible", "false");

    await page.getByTestId("plato-cocina").filter({ hasText: "Flan casero" }).getByRole("button", { name: /Volver a disponible/ }).click();
    await expect(page.getByTestId("plato-cocina").filter({ hasText: "Flan casero" })).toHaveAttribute("data-disponible", "true");
    expect((await ajuste())?.is_available).toBe(true);

    // Buscar un plato.
    await page.getByLabel("Buscar un plato").fill("bife");
    await expect(page.getByTestId("plato-cocina")).toHaveCount(1);
    await ctx.close();
  });
});

test("los MP3 aportados se sirven y decodifican en el navegador", async ({ page }) => {
  await page.goto("/login");
  const durations = await page.evaluate(async () => {
    const audio = new AudioContext();
    try {
      return await Promise.all(["/notificacion.mp3", "/notificacion-plato-listo.mp3"].map(async (url) => {
        const response = await fetch(url);
        if (!response.ok || !response.headers.get("content-type")?.includes("audio/mpeg")) throw new Error(`Audio no disponible: ${url}`);
        return (await audio.decodeAudioData(await response.arrayBuffer())).duration;
      }));
    } finally { await audio.close(); }
  });
  expect(durations).toHaveLength(2);
  for (const duration of durations) expect(duration).toBeGreaterThan(0);
});

test("el mozo oye plato listo solo cuando cocina completa todo el pedido, sin repetir en cada sondeo", async ({ browser }) => {
  const l = await nuevoLocal("cocina-audio-completo");
  const bife = await anotar(l, l.bife);
  const flan = await anotar(l, l.flan);
  const ctx = await browser.newContext();
  await conDobles(ctx);
  const page = await ctx.newPage();
  await login(page, l.t.staff.email, l.t.staff.password);
  await page.goto(`/sala/${l.t.slug}/mesas`);
  await page.getByRole("button", { name: "Activar alertas", exact: true }).click();
  await expect.poll(() => sonidos(page)).toEqual(["notification"]);
  const cocina = await sesion(l.cook);
  expect((await cocina.rpc("set_order_item_status", { p_item: bife, p_status: "ready" })).error).toBeNull();
  await expect(page.getByTestId("anuncio")).toContainText("Listo para entregar: Mesa 1", { timeout: 15_000 });
  expect(await sonidos(page)).toEqual(["notification"]);
  expect((await cocina.rpc("set_order_item_status", { p_item: flan, p_status: "ready" })).error).toBeNull();
  await expect.poll(() => sonidos(page), { timeout: 15_000 }).toEqual(["notification", "ready"]);
  await page.waitForResponse((response) => response.url().endsWith("/mesas/estado") && response.ok());
  expect(await sonidos(page)).toEqual(["notification", "ready"]);
  await page.reload();
  await page.getByRole("button", { name: "Activar alertas", exact: true }).click();
  await page.waitForResponse((response) => response.url().endsWith("/mesas/estado") && response.ok());
  expect(await sonidos(page)).toEqual(["notification"]); // Solo la confirmación; el pedido ya estaba listo al cargar.
  await ctx.close();
});

test.describe("el cocinero no sale de su pantalla", () => {
  test("ni la Sala ni el panel le muestran nada: lo mandan a la cocina y sus consultas dan 404", async ({ browser }) => {
    const l = await nuevoLocal("cocina-limites");
    await anotar(l, l.bife, 1);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await login(page, l.cook.email, l.cook.password);

    for (const ruta of [`/panel/${l.t.slug}`, `/panel/${l.t.slug}/carta`, `/panel/${l.t.slug}/personal`, `/sala/${l.t.slug}/mesas`, `/sala/${l.t.slug}/mesas/${l.mesas[0].id}/anotar`, "/panel", "/sala"]) {
      await page.goto(ruta);
      await expect(page, ruta).toHaveURL(new RegExp(`/cocina/${l.t.slug}$`));
    }
    for (const ruta of [`/sala/${l.t.slug}/estado`, `/sala/${l.t.slug}/mesas/estado`]) {
      expect((await page.request.get(ruta)).status(), ruta).toBe(404);
    }
    const estado = await page.request.get(`/cocina/${l.t.slug}/estado`);
    expect(estado.status()).toBe(200);
    expect(JSON.stringify(await estado.json())).not.toMatch(/price|cents|total/i);

    // Su navegación es solo la de cocina.
    const nav = page.getByRole("navigation", { name: "Secciones de la cocina" });
    await expect(nav.getByRole("link")).toHaveText(["Pedidos", "Platos agotados"]);
    await expect(page.getByText("Cocina", { exact: true }).first()).toBeVisible();

    // Otro local: 404 idéntico al de uno inexistente.
    const otro = await nuevoLocal("cocina-limites-otro");
    expect((await page.request.get(`/cocina/${otro.t.slug}/estado`)).status()).toBe(404);
    const respuesta = await page.goto(`/cocina/${otro.t.slug}`);
    expect(respuesta?.status()).toBe(404);
    await ctx.close();
  });

  test("sin sesión, la cocina pide ingresar y su consulta responde 401", async ({ browser }) => {
    const l = await nuevoLocal("cocina-sinsesion");
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`/cocina/${l.t.slug}`);
    await expect(page).toHaveURL(/\/login\?next=/);
    expect((await ctx.request.get(`/cocina/${l.t.slug}/estado`)).status()).toBe(401);
    await ctx.close();
  });

  test("con un plan sin pedidos (Básico) la pantalla avisa que no está disponible", async ({ browser }) => {
    const l = await nuevoLocal("cocina-basico", "basic");
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await login(page, l.cook.email, l.cook.password);
    await expect(page.getByTestId("cocina-deshabilitada")).toBeVisible();
    await page.goto(`/cocina/${l.t.slug}/carta`);
    await expect(page.getByTestId("cocina-deshabilitada")).toBeVisible();
    await ctx.close();
  });
});

test.describe("el Dueño gestiona al cocinero desde Personal", () => {
  test("suma un cocinero, que ingresa a su pantalla; pasa al Staff a cocina; con plan Básico no se puede", async ({ browser }) => {
    const l = await nuevoLocal("cocina-personal");
    const email = `e2e-cocinero-${Date.now()}@example.test`;
    extras.push(email);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await login(page, l.t.owner.email, l.t.owner.password);
    await page.goto(`/panel/${l.t.slug}/personal`);

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Contraseña inicial").fill(TEST_PASSWORD);
    await page.getByLabel("Rol").selectOption("cook");
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page.getByRole("status").filter({ hasText: "ya puede ingresar" })).toBeVisible();
    const fila = page.getByTestId("member-row").filter({ hasText: email });
    await expect(fila).toContainText("Cocina");
    await expect(fila.getByRole("button", { name: "Pasar a personal" })).toBeVisible();
    await expect(fila.getByRole("button", { name: "Hacer dueño" })).toBeVisible();
    await expect(fila.getByText("Cambiar contraseña")).toBeVisible();

    const ctxNuevo = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const paginaNueva = await ctxNuevo.newPage();
    await login(paginaNueva, email, TEST_PASSWORD);
    await expect(paginaNueva).toHaveURL(new RegExp(`/cocina/${l.t.slug}$`));
    await ctxNuevo.close();

    // Pasar al Staff a cocina.
    const filaStaff = page.getByTestId("member-row").filter({ hasText: l.t.staff.email });
    await filaStaff.getByRole("button", { name: "Pasar a cocina" }).click();
    await expect(filaStaff).toContainText("Cocina");
    expect((await service().from("memberships").select("role").eq("user_id", l.t.staff.id).single()).data?.role).toBe("cook");

    // Sin pedidos en el plan no se da el rol.
    await service().from("subscriptions").update({ plan_code: "basic" }).eq("organization_id", l.t.orgId);
    await page.reload();
    await page.getByLabel("Email").fill(`e2e-cocinero-b-${Date.now()}@example.test`);
    await page.getByLabel("Contraseña inicial").fill(TEST_PASSWORD);
    await page.getByLabel("Rol").selectOption("cook");
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page.locator("form").getByRole("alert")).toContainText("plan con pedidos");
    await ctx.close();
  });
});

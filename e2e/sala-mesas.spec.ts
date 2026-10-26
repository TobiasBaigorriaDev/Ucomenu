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
  test("el Staff ve las mesas con su pedido y el total, la Sala entra directo en Mesas y la página se actualiza sola", async ({ browser }) => {
    const l = await nuevoLocal("mesas-vista");
    await anotar(l.t.owner, l, l.mesas[0], 2);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await abrir(page, l.t.staff, l.t, "");
    // /sala/{slug} (el manifiesto, las notificaciones y los favoritos) entra directo en Mesas, que es la única pantalla de servicio.
    await expect(page).toHaveURL(new RegExp(`/sala/${l.t.slug}/mesas$`));
    await expect(page.getByRole("heading", { name: "Mesas en vivo", level: 1 })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Secciones de la sala" });
    await expect(nav.getByRole("link")).toHaveText(["Mesas en vivo", "Volver al panel principal"]);

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

  test("«Pide la cuenta» se atiende en la tarjeta de la mesa, junto al total del pedido; atender el llamado no cierra el pedido", async ({ browser }) => {
    const l = await nuevoLocal("mesas-cuenta");
    await anotar(l.t.owner, l, l.mesas[1], 3);
    await llamar(l.mesas[1].qr_token, "bill");
    await llamar(l.mesas[0].qr_token, "bill"); // sin pedido
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await abrir(page, l.t.staff, l.t, "/mesas");

    const conPedido = page.locator('[data-testid="llamado"][data-mesa="Mesa 2"]');
    await expect(conPedido).toContainText("Pide la cuenta");
    await expect(mesaCard(page, "Mesa 2").getByTestId("pedido-estado")).toHaveText("3 platos · 3 anotados");
    await expect(mesaCard(page, "Mesa 2").getByTestId("pedido-total")).toHaveAttribute("data-centavos", "30000");
    // Sin pedido, la mesa que pide la cuenta lo dice y no inventa un total.
    await expect(mesaCard(page, "Mesa 1")).toHaveAttribute("data-estado", "cuenta");
    await expect(mesaCard(page, "Mesa 1").getByTestId("sin-pedido")).toBeVisible();
    await expect(mesaCard(page, "Mesa 1").getByTestId("pedido-total")).toHaveCount(0);
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
    await expect(page.getByTestId("mesas-deshabilitada")).toContainText("Las mesas y los pedidos no están disponibles");
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

  test("«Filas» muestra las mismas mesas con los mismos datos, se atiende desde la fila y la elección se recuerda", async ({ browser }) => {
    const l = await nuevoLocal("mesas-filas");
    await anotar(l.t.owner, l, l.mesas[0], 2);
    await llamar(l.mesas[1].qr_token, "waiter");
    await llamar(l.mesas[2].qr_token, "bill");
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await abrir(page, l.t.staff, l.t, "/mesas");
    const lista = page.getByTestId("mesas");
    const vista = (nombre: string) => page.getByTestId("vista-mesas").getByRole("button", { name: nombre, exact: true });
    await expect(lista).toHaveAttribute("data-vista", "tarjetas");
    await expect(vista("Tarjetas")).toHaveAttribute("aria-pressed", "true");

    // Lo que se ve de cada mesa: estado, llamados, pedido y total (en centavos). Las dos vistas tienen que decir lo mismo.
    const datos = () =>
      page.locator('[data-testid="mesa"]').evaluateAll((mesas) =>
        mesas.map((m) => ({
          mesa: m.getAttribute("data-mesa"),
          estado: m.getAttribute("data-estado"),
          llamados: [...m.querySelectorAll('[data-testid="llamado"]')].map((c) => c.getAttribute("data-kind")),
          pedido: m.querySelector('[data-testid="pedido-estado"]')?.textContent ?? null,
          total: m.querySelector('[data-testid="pedido-total"]')?.getAttribute("data-centavos") ?? null,
          sinPedido: m.querySelector('[data-testid="sin-pedido"]') !== null,
          anotar: m.querySelector('[data-testid="anotar"]')?.getAttribute("href") ?? null,
        })),
      );
    const enTarjetas = await datos();
    expect(enTarjetas.map((m) => m.mesa)).toEqual(["Mesa 3", "Mesa 2", "Mesa 1"]);

    await vista("Filas").click();
    await expect(lista).toHaveAttribute("data-vista", "filas");
    await expect(vista("Filas")).toHaveAttribute("aria-pressed", "true");
    expect(await datos()).toEqual(enTarjetas);
    await expectNoHorizontalOverflow(page);
    const fila = mesaCard(page, "Mesa 1");
    await expect(fila).toContainText("Con pedido");
    await expect(fila.getByTestId("pedido-estado")).toHaveText("2 platos · 2 anotados");
    await expect(fila.getByTestId("anotar")).toBeVisible();
    for (const control of [vista("Tarjetas"), vista("Filas"), page.getByRole("button", { name: /Marcar como atendido/ }).first(), fila.getByTestId("anotar")]) {
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }

    // Atender desde la fila, y la elección sobrevive a una recarga (queda en el dispositivo).
    await mesaCard(page, "Mesa 2").getByRole("button", { name: /Marcar como atendido/ }).click();
    await expect(page.getByTestId("nota-sala")).toContainText("Mesa 2: marcado como atendido");
    await expect(page.locator('[data-testid="llamado"][data-mesa="Mesa 2"]')).toHaveCount(0);
    await page.reload();
    await expect(lista).toHaveAttribute("data-vista", "filas");
    await vista("Tarjetas").click();
    await expect(lista).toHaveAttribute("data-vista", "tarjetas");
    await page.reload();
    await expect(lista).toHaveAttribute("data-vista", "tarjetas");
    await ctx.close();
  });

  test("una mesa dada de baja con un llamado pendiente sigue a la vista hasta que el llamado venza", async ({ browser }) => {
    const l = await nuevoLocal("mesas-baja");
    await llamar(l.mesas[0].qr_token, "waiter");
    const baja = await service().from("tables").update({ is_active: false }).eq("id", l.mesas[0].id);
    expect(baja.error).toBeNull();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await abrir(page, l.t.staff, l.t, "/mesas");
    await expect(mesaCard(page, "Mesa 1")).toHaveAttribute("data-estado", "llama");
    await expect(mesaCard(page, "Mesa 1").getByRole("button", { name: /Marcar como atendido/ })).toBeVisible();
    await mesaCard(page, "Mesa 1").getByRole("button", { name: /Marcar como atendido/ }).click();
    await expect(page.getByTestId("nota-sala")).toContainText("marcado como atendido");
    // Sin llamado y de baja, sale en el siguiente ciclo.
    await expect(mesaCard(page, "Mesa 1")).toHaveCount(0, { timeout: 12_000 });
    await ctx.close();
  });

  test("la ruta de consulta responde como la de la Sala: sin sesión 401, de otro local 404, del local 200 sin caché", async ({ browser, request }) => {
    const l = await nuevoLocal("mesas-ruta");
    const otro = await nuevoLocal("mesas-ruta-otro");
    const sinSesion = await request.get(`/sala/${l.t.slug}/mesas/estado`, { maxRedirects: 0 });
    expect(sinSesion.status()).toBe(401);
    expect(await sinSesion.json()).toEqual({ error: "no_session" });
    expect(sinSesion.headers()["cache-control"]).toContain("no-store");

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, otro.t.staff.email, otro.t.staff.password);
    const ajeno = await page.request.get(`/sala/${l.t.slug}/mesas/estado`);
    expect(ajeno.status()).toBe(404);
    await llamar(otro.mesas[0].qr_token, "bill");
    const propio = await page.request.get(`/sala/${otro.t.slug}/mesas/estado`);
    expect(propio.status()).toBe(200);
    expect(propio.headers()["cache-control"]).toContain("no-store");
    const cuerpo = await propio.json();
    expect(cuerpo).toMatchObject({ enabled: true });
    expect(cuerpo.mesas).toHaveLength(3);
    // Cada mesa lleva sus llamados (id, tipo, hora y escaneo del QR) y se informa cuántos hay en las sucursales que no se miran.
    expect(Object.keys(cuerpo).sort()).toEqual(["branches", "enabled", "mesas", "multiBranch", "othersPending", "serverNow", "view"]);
    expect(cuerpo.othersPending).toBe(0);
    expect(cuerpo.mesas[0].calls).toHaveLength(1);
    expect(Object.keys(cuerpo.mesas[0].calls[0]).sort()).toEqual(["createdAt", "id", "kind", "visitStartedAt"]);
    expect(JSON.stringify(cuerpo)).not.toContain(otro.mesas[0].qr_token);
    await ctx.close();
  });
});

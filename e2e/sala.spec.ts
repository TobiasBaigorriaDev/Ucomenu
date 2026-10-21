import { createClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { conDobles, pitidos, wakeLocks } from "./audio-doble";
import { createTenant, expectNoHorizontalOverflow, login, service, type Estado, type Person, type Tenant } from "./support";

/**
 * Panel de sala (ficha panel-de-sala): llamados pendientes en vivo por sondeo (~3 s), alerta sonora y visual, atender,
 * recuperación al reconectar y límites de acceso, contra el build y el Supabase local, a 390 px.
 */

const MIN = 60_000;
const tenants: Tenant[] = [];

type Mesa = { id: string; label: string; qr_token: string };

async function nuevoLocal(label: string, opciones: { estado?: Estado; plan?: "basic" | "pro"; sucursales?: number } = {}) {
  const t = await createTenant(label, opciones.estado ?? "active");
  tenants.push(t);
  const db = service();
  if ((opciones.plan ?? "pro") === "pro") await db.from("subscriptions").update({ plan_code: "pro" }).eq("organization_id", t.orgId);
  const branch = await db.from("branches").select("id").eq("organization_id", t.orgId).single();
  const branchIds = [branch.data!.id as string];
  if ((opciones.sucursales ?? 1) > 1) {
    const extra = await db.from("branches").insert({ organization_id: t.orgId, slug: "norte", name: "Norte" }).select("id").single();
    branchIds.push(extra.data!.id);
  }
  const filas = branchIds.flatMap((b) => ["Mesa 1", "Mesa 2", "Mesa 3"].map((l) => ({ organization_id: t.orgId, branch_id: b, label: l })));
  const mesas = await db.from("tables").insert(filas).select("id, label, qr_token, branch_id").order("label");
  if (mesas.error) throw new Error(mesas.error.message);
  return { t, branchIds, mesas: mesas.data as (Mesa & { branch_id: string })[] };
}

test.afterAll(async () => {
  for (const t of tenants) await t.cleanup();
});

/** El comensal llama por la puerta pública (rol anon), como en producción. */
async function llamar(token: string, kind: "waiter" | "bill" = "waiter") {
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data, error } = await anon.rpc("create_waiter_call", { p_token: token, p_kind: kind });
  expect(error).toBeNull();
  expect(data).toEqual({ status: "created" });
}

const filasDe = async (orgId: string) => (await service().from("waiter_calls").select("*").eq("organization_id", orgId).order("created_at")).data ?? [];

async function abrirSala(context: BrowserContext, persona: Person, t: Tenant) {
  const page = await context.newPage();
  await login(page, persona.email, persona.password);
  await page.goto(`/sala/${t.slug}`);
  await expect(page.getByRole("heading", { name: "Sala en vivo" })).toBeVisible();
  return page;
}

const tarjeta = (page: Page, mesa: string) => page.locator(`[data-testid="llamado"][data-mesa="${mesa}"]`);

test.describe("llamados en vivo", () => {
  test("un llamado aparece solo, en pocos segundos, en la sala del Staff y del Dueño; el de otro local no", async ({ browser }) => {
    const { t, mesas } = await nuevoLocal("sala-vivo");
    const otro = await nuevoLocal("sala-vivo-otro");
    const ctxDueno = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const ctxStaff = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const dueno = await abrirSala(ctxDueno, t.owner, t);
    const staff = await abrirSala(ctxStaff, t.staff, t);
    await expect(staff.getByTestId("sala-vacia")).toBeVisible();
    await expectNoHorizontalOverflow(staff);

    await llamar(otro.mesas[0].qr_token);
    await llamar(mesas[1].qr_token, "bill"); // Mesa 2
    for (const page of [dueno, staff]) {
      const c = tarjeta(page, "Mesa 2");
      await expect(c).toBeVisible({ timeout: 12_000 });
      await expect(c).toContainText("Pide la cuenta");
      await expect(c).toContainText(/hace \d+ s/);
      await expect(c).toHaveAttribute("data-nuevo", "true");
      await expect(page.getByTestId("aviso-nuevo")).toContainText("Nuevo llamado: Mesa 2");
      await expect(page).toHaveTitle("(1) Sala en vivo");
    }
    await expect(staff.locator('[data-testid="llamado"]')).toHaveCount(1); // el de otro local no llega
    await ctxDueno.close();
    await ctxStaff.close();
  });

  test("los pendientes que ya había al cargar no suenan ni se marcan como nuevos; los de después, sí (con las alertas activadas)", async ({ browser }) => {
    const { t, mesas } = await nuevoLocal("sala-suena");
    await llamar(mesas[0].qr_token); // ya pendiente antes de abrir la sala
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await conDobles(ctx);
    const page = await abrirSala(ctx, t.staff, t);
    const sondeo = () => page.waitForResponse((r) => r.url().includes("/estado") && r.ok());

    // Se activan las alertas ANTES del primer sondeo: confirma con un pitido y pide mantener la pantalla encendida.
    await expect(tarjeta(page, "Mesa 1")).toBeVisible();
    await page.getByRole("button", { name: "Activar alertas" }).click();
    await expect(page.getByTestId("alertas-activas")).toBeVisible();
    expect(await pitidos(page)).toBe(1);
    expect(await wakeLocks(page)).toBe(1);

    // Tras un ciclo de sondeo completo, lo que ya estaba NO es nuevo y no suena (sigue habiendo un solo pitido).
    await sondeo();
    await page.waitForTimeout(500);
    await expect(tarjeta(page, "Mesa 1")).toHaveAttribute("data-nuevo", "false");
    await expect(page.getByTestId("aviso-nuevo")).toHaveCount(0);
    expect(await pitidos(page)).toBe(1);

    // Llamados nuevos: resaltan, suman al título y suenan.
    await llamar(mesas[1].qr_token);
    await expect(tarjeta(page, "Mesa 2")).toBeVisible({ timeout: 12_000 });
    await expect(page).toHaveTitle("(2) Sala en vivo");
    await expect.poll(() => pitidos(page)).toBe(2);
    await llamar(mesas[2].qr_token, "bill");
    await expect(tarjeta(page, "Mesa 3")).toBeVisible({ timeout: 12_000 });
    await expect.poll(() => pitidos(page)).toBe(3);

    // Silenciadas, un llamado nuevo resalta pero ya no suena.
    await page.getByRole("button", { name: "Silenciar alertas" }).click();
    await expect(page.getByRole("button", { name: "Activar alertas" })).toBeVisible();
    await service().from("waiter_calls").update({ status: "attended" }).eq("organization_id", t.orgId);
    await expect(page.getByTestId("sala-vacia")).toBeVisible({ timeout: 12_000 });
    await llamar(mesas[0].qr_token, "bill");
    await expect(tarjeta(page, "Mesa 1")).toBeVisible({ timeout: 12_000 });
    await expect(tarjeta(page, "Mesa 1")).toHaveAttribute("data-nuevo", "true");
    await page.waitForTimeout(500);
    expect(await pitidos(page)).toBe(3);
    await ctx.close();
  });

  test("antigüedad: uno de 29 minutos se ve, uno de 31 no; desde 5 minutos se marca como urgente con texto", async ({ browser }) => {
    const { t, mesas } = await nuevoLocal("sala-edad");
    for (const m of mesas) await llamar(m.qr_token);
    const db = service();
    await db.from("waiter_calls").update({ created_at: new Date(Date.now() - 31 * MIN).toISOString() }).eq("table_id", mesas[0].id);
    await db.from("waiter_calls").update({ created_at: new Date(Date.now() - 29 * MIN).toISOString() }).eq("table_id", mesas[1].id);

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await abrirSala(ctx, t.owner, t);
    await expect(tarjeta(page, "Mesa 1")).toHaveCount(0);
    await expect(tarjeta(page, "Mesa 2")).toBeVisible();
    await expect(tarjeta(page, "Mesa 2")).toHaveAttribute("data-urgente", "true");
    await expect(tarjeta(page, "Mesa 2")).toContainText("Espera hace rato");
    await expect(tarjeta(page, "Mesa 2")).toContainText(/hace 29 min/);
    await expect(tarjeta(page, "Mesa 3")).toHaveAttribute("data-urgente", "false");
    await expect(tarjeta(page, "Mesa 3")).not.toContainText("Espera hace rato");
    // El más viejo primero.
    expect(await page.locator('[data-testid="llamado"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-mesa")))).toEqual(["Mesa 2", "Mesa 3"]);
    await ctx.close();
  });

  test("con dos sucursales, cada tarjeta dice cuál", async ({ browser }) => {
    const { t, mesas, branchIds } = await nuevoLocal("sala-sucursales", { sucursales: 2 });
    const centro = mesas.find((m) => m.branch_id === branchIds[0])!;
    const norte = mesas.find((m) => m.branch_id === branchIds[1])!;
    await llamar(centro.qr_token);
    await llamar(norte.qr_token, "bill");
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await abrirSala(ctx, t.owner, t);
    await expect(page.locator('[data-testid="llamado"]')).toHaveCount(2);
    await expect(page.getByText("Sucursal Norte")).toBeVisible();
    await expect(page.getByText("Sucursal Centro", { exact: false })).toBeVisible();
    await ctx.close();
  });
});

test.describe("anuncios con varias sucursales", () => {
  test("el llamado se anuncia con su sucursal, «Atendido» distingue mesas iguales y no hay dos regiones vivas con lo mismo", async ({ browser }) => {
    // «Mesa 1» existe en Centro y en Norte: sin la sucursal, ni el anuncio ni el botón dirían cuál es.
    const { t, mesas, branchIds } = await nuevoLocal("sala-anuncios", { sucursales: 2 });
    const mesa1 = (branch: string) => mesas.find((m) => m.branch_id === branch && m.label === "Mesa 1")!;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await abrirSala(ctx, t.owner, t);
    await expect(page.getByTestId("sala-vacia")).toBeVisible();
    const anuncio = page.getByTestId("anuncio");

    await llamar(mesa1(branchIds[0]).qr_token);
    await expect(anuncio).toHaveText("Nuevo llamado: Mesa 1, sucursal Centro, llama al mozo.", { timeout: 12_000 });
    await llamar(mesa1(branchIds[1]).qr_token, "bill");
    await expect(anuncio).toHaveText("Nuevo llamado: Mesa 1, sucursal Norte, pide la cuenta.", { timeout: 12_000 });

    // Una sola región viva dice la novedad: el aviso visible es el mismo texto, pero fuera del árbol de accesibilidad.
    await expect(page.getByTestId("aviso-nuevo")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator('[aria-live], [role="status"], [role="alert"]').filter({ hasText: "Nuevo llamado" })).toHaveCount(1);

    // El botón de cada tarjeta se distingue por su nombre accesible.
    const centro = page.getByRole("button", { name: "Marcar como atendido: Mesa 1, sucursal Centro, llama al mozo" });
    const norte = page.getByRole("button", { name: "Marcar como atendido: Mesa 1, sucursal Norte, pide la cuenta" });
    await expect(centro).toBeVisible();
    await expect(norte).toBeVisible();
    await expect(norte).toHaveText("Atendido");

    // Atender uno no toca el otro, y el resultado también dice la sucursal.
    await norte.click();
    await expect(page.getByTestId("nota-sala")).toHaveText("Mesa 1, sucursal Norte: marcado como atendido.");
    await expect(page.locator('[data-testid="llamado"]')).toHaveCount(1);
    await expect(centro).toBeVisible();
    await ctx.close();
  });

  test("con una sola sucursal el anuncio no agrega la sucursal", async ({ browser }) => {
    const { t, mesas } = await nuevoLocal("sala-anuncio-simple");
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await abrirSala(ctx, t.owner, t);
    await llamar(mesas[1].qr_token);
    await expect(page.getByTestId("anuncio")).toHaveText("Nuevo llamado: Mesa 2, llama al mozo.", { timeout: 12_000 });
    await expect(page.getByRole("button", { name: "Marcar como atendido: Mesa 2, llama al mozo" })).toBeVisible();
    await ctx.close();
  });
});

test.describe("vista por sucursal", () => {
  const selector = (page: Page) => page.getByTestId("selector-sucursal");
  const chip = (page: Page, nombre: string) => selector(page).getByRole("button", { name: nombre, exact: true });
  const mesa1 = (mesas: { branch_id: string; label: string; qr_token: string }[], branch: string) => mesas.find((m) => m.branch_id === branch && m.label === "Mesa 1")!;
  const elegir = async (page: Page, nombre: string) => {
    await chip(page, nombre).click();
    // La elección se ve al instante (optimista) y los botones quedan inactivos mientras se guarda: se espera a que termine.
    await expect(chip(page, nombre)).toHaveAttribute("aria-pressed", "true");
    await expect(chip(page, nombre)).toBeEnabled();
  };

  test("el Dueño y el Personal eligen sus sucursales por separado; la sala, el aviso y el título siguen a cada uno y la elección persiste", async ({ browser }) => {
    const { t, mesas, branchIds } = await nuevoLocal("sala-vista", { sucursales: 2 });
    const ctxDueno = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const ctxStaff = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const dueno = await abrirSala(ctxDueno, t.owner, t);
    const staff = await abrirSala(ctxStaff, t.staff, t);
    await expectNoHorizontalOverflow(staff);

    // Por defecto se ve todo; el Personal elige solo Norte.
    await expect(chip(staff, "Todas")).toHaveAttribute("aria-pressed", "true");
    await elegir(staff, "Norte");
    await expect(chip(staff, "Todas")).toHaveAttribute("aria-pressed", "false");
    await expectNoHorizontalOverflow(staff);

    await llamar(mesa1(mesas, branchIds[0]).qr_token); // Centro
    await llamar(mesa1(mesas, branchIds[1]).qr_token, "bill"); // Norte
    await expect(dueno.locator('[data-testid="llamado"]')).toHaveCount(2, { timeout: 12_000 });
    await expect(staff.locator('[data-testid="llamado"]')).toHaveCount(1, { timeout: 12_000 });
    await expect(staff.locator('[data-testid="llamado"]')).toContainText("Norte");
    await expect(dueno).toHaveTitle("(2) Sala en vivo");
    await expect(staff).toHaveTitle("(1) Sala en vivo");
    // El anuncio del Personal es solo de Norte; no se entera de lo de Centro (pero sabe que existe).
    await expect(staff.getByTestId("anuncio")).toHaveText("Nuevo llamado: Mesa 1, sucursal Norte, pide la cuenta.");
    await expect(staff.getByTestId("otras-sucursales")).toContainText("Hay 1 llamado pendiente en otra sucursal");
    await expect(dueno.getByTestId("otras-sucursales")).toHaveCount(0);

    // La elección es de la persona y persiste: al recargar y desde otro dispositivo (otra sesión de la misma persona).
    await staff.reload();
    await expect(chip(staff, "Norte")).toHaveAttribute("aria-pressed", "true");
    await expect(staff.locator('[data-testid="llamado"]')).toHaveCount(1);
    const ctxOtro = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const otroDispositivo = await abrirSala(ctxOtro, t.staff, t);
    await expect(chip(otroDispositivo, "Norte")).toHaveAttribute("aria-pressed", "true");
    await expect(dueno.getByTestId("selector-sucursal").getByRole("button", { name: "Todas", exact: true })).toHaveAttribute("aria-pressed", "true");

    // «Ver todas» desde el aviso vuelve a mostrar todo.
    await staff.getByTestId("otras-sucursales").getByRole("button", { name: "Ver todas" }).click();
    await expect(staff.locator('[data-testid="llamado"]')).toHaveCount(2);
    await expect(chip(staff, "Todas")).toHaveAttribute("aria-pressed", "true");
    await expect(staff.getByTestId("otras-sucursales")).toHaveCount(0);
    await ctxDueno.close();
    await ctxStaff.close();
    await ctxOtro.close();
  });

  test("cambiar de sucursales no hace sonar ni anuncia lo que ya estaba pendiente; un llamado nuevo de lo que se mira sí suena", async ({ browser }) => {
    const { t, mesas, branchIds } = await nuevoLocal("sala-vista-sonido", { sucursales: 2 });
    await llamar(mesa1(mesas, branchIds[0]).qr_token);
    await llamar(mesa1(mesas, branchIds[1]).qr_token);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await conDobles(ctx);
    const page = await abrirSala(ctx, t.staff, t);
    // Se empieza mirando solo Norte (el llamado de Centro NO se vio nunca en esta pantalla) y se recarga con esa vista.
    await elegir(page, "Norte");
    await page.reload();
    await expect(page.locator('[data-testid="llamado"]')).toHaveCount(1);
    await page.getByRole("button", { name: "Activar alertas" }).click();
    await expect(page.getByTestId("alertas-activas")).toBeVisible();
    expect(await pitidos(page)).toBe(1); // el de confirmación

    // Pasar a «Todas» muestra de golpe un llamado que ya estaba: no suena ni se anuncia.
    await elegir(page, "Todas");
    await expect(page.locator('[data-testid="llamado"]')).toHaveCount(2);
    await page.waitForTimeout(1_500);
    expect(await pitidos(page)).toBe(1);
    await expect(page.getByTestId("anuncio")).toHaveText("");
    await elegir(page, "Norte");
    await expect(page.locator('[data-testid="llamado"]')).toHaveCount(1);
    await page.waitForTimeout(1_500);
    expect(await pitidos(page)).toBe(1);

    // Con dos sucursales, elegir la otra estando en una suma las dos (= «Todas»): para mirar solo Centro se parte de «Todas».
    await elegir(page, "Todas");
    await elegir(page, "Centro");
    await expect(page.locator('[data-testid="llamado"]')).toHaveCount(1);
    await llamar(mesa1(mesas, branchIds[0]).qr_token, "bill"); // nuevo, en lo que mira
    await expect(page.getByTestId("anuncio")).toHaveText("Nuevo llamado: Mesa 1, sucursal Centro, pide la cuenta.", { timeout: 12_000 });
    await expect.poll(() => pitidos(page)).toBe(2);
    await ctx.close();
  });

  test("el cartel del panel y la analítica siguen la elección", async ({ browser }) => {
    const { t, mesas, branchIds } = await nuevoLocal("sala-vista-panel", { sucursales: 2 });
    await llamar(mesa1(mesas, branchIds[0]).qr_token); // Centro
    await llamar(mesa1(mesas, branchIds[1]).qr_token, "bill"); // Norte
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const sala = await abrirSala(ctx, t.owner, t);
    await elegir(sala, "Norte");

    await sala.goto(`/panel/${t.slug}`);
    const aviso = sala.getByTestId("llamados-aviso");
    await expect(aviso.getByTestId("llamados-aviso-titulo")).toHaveText("Una mesa necesita atención", { timeout: 12_000 });
    await expect(aviso.getByTestId("llamados-aviso-lista")).toContainText("Norte");
    await expect(aviso.getByTestId("llamados-aviso-lista")).not.toContainText("Centro");
    await expect(aviso.getByTestId("llamados-aviso-vista")).toContainText("Mostrando: Norte");

    // La analítica del Dueño abre en la sucursal elegida; «Todas las sucursales» la quita explícitamente.
    await sala.goto(`/panel/${t.slug}/analitica`);
    const filtro = sala.getByTestId("analitica-sucursales");
    await expect(filtro.getByRole("link", { name: "Norte" })).toHaveAttribute("aria-current", "page");
    await filtro.getByRole("link", { name: "Todas las sucursales" }).click();
    await expect(sala).toHaveURL(/sucursal=_todas/);
    await expect(filtro.getByRole("link", { name: "Todas las sucursales" })).toHaveAttribute("aria-current", "page");
    await ctx.close();
  });

  test("dos toques seguidos con el sondeo lento no pisan la primera elección (se suman)", async ({ browser }) => {
    const { t } = await nuevoLocal("sala-vista-rapido", { sucursales: 2 });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await abrirSala(ctx, t.owner, t);
    // El sondeo tarda: entre guardar la primera elección y que el servidor la devuelva, la pantalla todavía trae la vista vieja.
    await page.route("**/sala/*/estado", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      await route.continue();
    });

    await chip(page, "Centro").click();
    await expect(chip(page, "Centro")).toBeEnabled(); // el guardado terminó
    await chip(page, "Norte").click(); // Centro + Norte = todas las del local

    await expect(chip(page, "Todas")).toHaveAttribute("aria-pressed", "true");
    await page.unroute("**/sala/*/estado");
    await page.reload();
    await expect(chip(page, "Todas")).toHaveAttribute("aria-pressed", "true"); // lo guardado también es «Todas», no solo Norte
    await ctx.close();
  });

  test("«Todas las sucursales» de la analítica no se confunde con una sucursal que se llame «todas»", async ({ browser }) => {
    const { t, branchIds } = await nuevoLocal("sala-vista-slug", { sucursales: 2 });
    expect((await service().from("branches").update({ slug: "todas" }).eq("id", branchIds[1]).select("slug")).data).toEqual([{ slug: "todas" }]);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await abrirSala(ctx, t.owner, t);
    await page.goto(`/panel/${t.slug}/analitica`);
    const filtro = page.getByTestId("analitica-sucursales");
    await expect(filtro.getByRole("link", { name: "Norte" })).toHaveAttribute("href", /sucursal=todas$/); // la sucursal sí se llama «todas»

    // Se espera la navegación (el estado de antes de navegar también tiene «Todas» activa).
    await filtro.getByRole("link", { name: "Norte" }).click();
    await expect(page).toHaveURL(/sucursal=todas$/);
    await expect(filtro.getByRole("link", { name: "Norte" })).toHaveAttribute("aria-current", "page"); // elegible por su propio nombre

    await filtro.getByRole("link", { name: "Todas las sucursales" }).click();
    await expect(page).toHaveURL(/sucursal=_todas$/); // el valor reservado, que no puede ser un slug
    await expect(filtro.getByRole("link", { name: "Todas las sucursales" })).toHaveAttribute("aria-current", "page");
    await expect(filtro.getByRole("link", { name: "Norte" })).not.toHaveAttribute("aria-current", "page");
    await ctx.close();
  });

  test("al cambiar de sucursales desde otra pestaña, el cartel del panel vuelve a montar su región viva (lo que aparece ya estaba pendiente y no se anuncia)", async ({ browser }) => {
    const { t, mesas, branchIds } = await nuevoLocal("sala-vista-cartel", { sucursales: 2 });
    await llamar(mesa1(mesas, branchIds[0]).qr_token); // Centro
    await llamar(mesa1(mesas, branchIds[1]).qr_token, "bill"); // Norte
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const sala = await abrirSala(ctx, t.owner, t);
    await elegir(sala, "Norte");
    const panel = await ctx.newPage();
    await panel.goto(`/panel/${t.slug}`);
    const aviso = panel.getByTestId("llamados-aviso");
    await expect(aviso.getByTestId("llamados-aviso-lista")).toContainText("Norte", { timeout: 12_000 });
    await expect(aviso.getByTestId("llamados-aviso-lista")).not.toContainText("Centro");
    // Se marca el nodo de la región viva: si se vuelve a montar con la nueva vista, la marca desaparece.
    await aviso.evaluate((el) => ((el as HTMLElement & { __marca?: boolean }).__marca = true));

    await sala.bringToFront();
    await elegir(sala, "Todas"); // ahora Centro (que ya estaba pendiente) también aparece en el cartel
    await expect(panel.getByTestId("llamados-aviso").getByTestId("llamados-aviso-lista")).toContainText("Centro", { timeout: 12_000 });
    expect(await panel.getByTestId("llamados-aviso").evaluate((el) => (el as HTMLElement & { __marca?: boolean }).__marca === true)).toBe(false);
    await ctx.close();
  });

  test("con una sola sucursal no hay selector", async ({ browser }) => {
    const { t } = await nuevoLocal("sala-vista-una");
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await abrirSala(ctx, t.staff, t);
    await expect(page.getByTestId("sala-vacia")).toBeVisible();
    await expect(page.getByTestId("selector-sucursal")).toHaveCount(0);
    await ctx.close();
  });
});

test.describe("atender", () => {
  test("«Atendido» lo saca de la lista, lo registra con la hora y la persona, y otra pantalla lo ve desaparecer", async ({ browser }) => {
    const { t, mesas } = await nuevoLocal("sala-atiende");
    await llamar(mesas[0].qr_token);
    await llamar(mesas[1].qr_token, "bill");
    const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const staff = await abrirSala(ctxA, t.staff, t);
    const dueno = await abrirSala(ctxB, t.owner, t);

    const boton = staff.getByRole("button", { name: /Marcar como atendido: Mesa 1/ });
    expect((await boton.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await boton.click();
    await expect(tarjeta(staff, "Mesa 1")).toHaveCount(0);
    await expect(staff.getByTestId("nota-sala")).toContainText("Mesa 1: marcado como atendido");

    const fila = (await filasDe(t.orgId)).find((f) => f.table_id === mesas[0].id)!;
    expect(fila.status).toBe("attended");
    expect(fila.attended_by).toBe(t.staff.id);
    expect(Math.abs(Date.parse(fila.attended_at!) - Date.now())).toBeLessThan(30_000);

    // La otra pantalla lo ve desaparecer en el siguiente ciclo, y el otro llamado sigue.
    await expect(tarjeta(dueno, "Mesa 1")).toHaveCount(0, { timeout: 12_000 });
    await expect(tarjeta(dueno, "Mesa 2")).toBeVisible();
    await ctxA.close();
    await ctxB.close();
  });

  test("dos personas que tocan «Atendido» a la vez: una atiende y la otra se entera de que ya estaba atendido", async ({ browser }) => {
    const { t, mesas } = await nuevoLocal("sala-carrera");
    await llamar(mesas[0].qr_token);
    const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const a = await abrirSala(ctxA, t.staff, t);
    const b = await abrirSala(ctxB, t.owner, t);
    await expect(tarjeta(a, "Mesa 1")).toBeVisible();
    await expect(tarjeta(b, "Mesa 1")).toBeVisible();

    await Promise.all([
      a.getByRole("button", { name: /Marcar como atendido: Mesa 1/ }).click(),
      b.getByRole("button", { name: /Marcar como atendido: Mesa 1/ }).click(),
    ]);
    const notas = await Promise.all([a.getByTestId("nota-sala").innerText(), b.getByTestId("nota-sala").innerText()]);
    expect(notas.filter((n) => n.includes("marcado como atendido"))).toHaveLength(1);
    expect(notas.filter((n) => n.includes("ya lo atendió otra persona"))).toHaveLength(1);

    const atendidos = (await filasDe(t.orgId)).filter((f) => f.status === "attended");
    expect(atendidos).toHaveLength(1);
    expect([t.staff.id, t.owner.id]).toContain(atendidos[0].attended_by);
    await ctxA.close();
    await ctxB.close();
  });

  test("si el plan cambia con la pantalla abierta, «Atendido» avisa y no registra nada", async ({ browser }) => {
    const { t, mesas } = await nuevoLocal("sala-plan-cambia");
    await llamar(mesas[0].qr_token);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await abrirSala(ctx, t.staff, t);
    await expect(tarjeta(page, "Mesa 1")).toBeVisible();

    await service().from("subscriptions").update({ plan_code: "basic" }).eq("organization_id", t.orgId);
    await page.getByRole("button", { name: /Marcar como atendido: Mesa 1/ }).click();
    await expect(tarjeta(page, "Mesa 1").getByRole("alert")).toContainText("la cuenta o el plan no lo permiten");
    expect((await filasDe(t.orgId))[0].status).toBe("pending");
    await ctx.close();
  });
});

test.describe("consultas en vuelo", () => {
  test("una respuesta lenta que salió antes de atender no vuelve a mostrar la tarjeta ya atendida", async ({ browser }) => {
    const { t, mesas } = await nuevoLocal("sala-respuesta-vieja");
    await llamar(mesas[0].qr_token, "waiter");
    await llamar(mesas[1].qr_token, "bill");
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await abrirSala(ctx, t.staff, t);
    await expect(tarjeta(page, "Mesa 1")).toBeVisible();
    await expect(tarjeta(page, "Mesa 2")).toBeVisible();

    // La próxima consulta se lee ya (con Mesa 1 pendiente) pero se entrega recién después de atender.
    let capturada!: () => void;
    const seCapturo = new Promise<void>((resolve) => (capturada = resolve));
    let liberar!: () => void;
    const liberada = new Promise<void>((resolve) => (liberar = resolve));
    let armada = true;
    await page.route("**/sala/*/estado", async (route) => {
      if (!armada) return route.continue();
      armada = false;
      const respuesta = await route.fetch();
      capturada();
      await liberada;
      await route.fulfill({ response: respuesta });
    });
    await seCapturo;

    await page.getByRole("button", { name: /Marcar como atendido: Mesa 1/ }).click();
    await expect(page.getByTestId("nota-sala")).toContainText("Mesa 1: marcado como atendido");
    await expect(tarjeta(page, "Mesa 1")).toHaveCount(0);

    liberar();
    // Se mira SIN reintentos durante menos que un ciclo de 3 s: si la respuesta vieja se aplicara, la tarjeta
    // reaparecería unos instantes (hasta que la consulta siguiente la volviera a sacar) y un `expect` con espera no lo vería.
    for (let i = 0; i < 8; i++) {
      expect(await tarjeta(page, "Mesa 1").count(), `a los ${i * 250} ms`).toBe(0);
      await page.waitForTimeout(250);
    }
    await expect(tarjeta(page, "Mesa 2")).toBeVisible();
    await ctx.close();
  });
});

test.describe("conexión", () => {
  test("sin conexión muestra un aviso con la última lista y, al volver, se recupera sola (incluido lo creado durante el corte)", async ({ browser }) => {
    const { t, mesas } = await nuevoLocal("sala-offline");
    await llamar(mesas[0].qr_token);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await conDobles(ctx);
    const page = await abrirSala(ctx, t.staff, t);
    await page.getByRole("button", { name: "Activar alertas" }).click();
    await expect(tarjeta(page, "Mesa 1")).toBeVisible();
    const antes = await pitidos(page);

    await ctx.setOffline(true);
    await expect(page.getByTestId("sin-conexion")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("sin-conexion")).toContainText("Reintentando");
    await expect(tarjeta(page, "Mesa 1")).toBeVisible(); // la última lista sigue a la vista

    await llamar(mesas[1].qr_token, "bill"); // se crea durante el corte
    await ctx.setOffline(false);
    // Al volver la red se consulta de inmediato (evento «online»): sin él habría que esperar el siguiente ciclo espaciado.
    await expect(page.getByTestId("sin-conexion")).toHaveCount(0, { timeout: 4_000 });
    await expect(tarjeta(page, "Mesa 2")).toBeVisible({ timeout: 4_000 });
    await expect(tarjeta(page, "Mesa 2")).toHaveAttribute("data-nuevo", "true");
    await expect.poll(() => pitidos(page)).toBe(antes + 1);
    await ctx.close();
  });

  test("con la sesión vencida avisa y deja de consultar, con un enlace para ingresar", async ({ browser }) => {
    const { t } = await nuevoLocal("sala-sesion");
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await abrirSala(ctx, t.staff, t);
    await ctx.clearCookies();
    await expect(page.getByTestId("sesion-vencida")).toBeVisible({ timeout: 12_000 });
    await expect(page.getByRole("link", { name: "Ingresar de nuevo" })).toHaveAttribute("href", `/login?next=${encodeURIComponent(`/sala/${t.slug}`)}`);

    let consultas = 0;
    page.on("request", (r) => r.url().includes("/estado") && consultas++);
    await page.waitForTimeout(6_000);
    expect(consultas).toBe(0);
    await ctx.close();
  });
});

test.describe("plan y cuenta", () => {
  test("si el plan se baja con la pantalla abierta, aparece el aviso y se deja de consultar", async ({ browser }) => {
    const { t, mesas } = await nuevoLocal("sala-plan-baja");
    await llamar(mesas[0].qr_token);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await abrirSala(ctx, t.staff, t);
    await expect(tarjeta(page, "Mesa 1")).toBeVisible();

    await service().from("subscriptions").update({ plan_code: "basic" }).eq("organization_id", t.orgId);
    await expect(page.getByTestId("sala-deshabilitada")).toBeVisible({ timeout: 8_000 });

    let consultas = 0;
    page.on("request", (r) => r.url().includes("/estado") && consultas++);
    await page.waitForTimeout(7_000);
    expect(consultas).toBe(0);
    await ctx.close();
  });

  test("plan Básico: aviso en lugar de la lista, sin sondeo; el Dueño ve el motivo y el Staff no", async ({ browser }) => {
    const { t, mesas } = await nuevoLocal("sala-basico", { plan: "basic" });
    // Un pendiente creado cuando el plan todavía era Pro: con Básico la sala no lo muestra.
    await service().from("waiter_calls").insert({ organization_id: t.orgId, branch_id: mesas[0].branch_id, table_id: mesas[0].id, kind: "waiter" });

    const ctxD = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const dueno = await abrirSala(ctxD, t.owner, t);
    await expect(dueno.getByTestId("sala-deshabilitada")).toContainText("plan Pro");
    await expect(dueno.getByTestId("llamados")).toHaveCount(0);

    const ctxS = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const staff = await abrirSala(ctxS, t.staff, t);
    await expect(staff.getByTestId("sala-deshabilitada")).toContainText("Avisale al dueño");
    await expect(staff.getByTestId("sala-deshabilitada")).not.toContainText(/plan|pro\b/i);

    let consultas = 0;
    staff.on("request", (r) => r.url().includes("/estado") && consultas++);
    await staff.waitForTimeout(6_000);
    expect(consultas).toBe(0);
    await ctxD.close();
    await ctxS.close();
  });

  for (const estado of ["read_only", "suspended"] as const) {
    test(`${estado === "read_only" ? "solo lectura" : "suspendida"}: aviso en lugar de la lista`, async ({ browser }) => {
      const { t, mesas } = await nuevoLocal(`sala-${estado.replace("_", "")}`, { estado });
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await abrirSala(ctx, t.staff, t);
      await expect(page.getByTestId("sala-deshabilitada")).toBeVisible();
      await expect(page.locator('[data-testid="llamado"]')).toHaveCount(0);
      expect(mesas.length).toBeGreaterThan(0);
      await ctx.close();
    });
  }
});

test.describe("acceso", () => {
  test("la ruta de consulta: 401 sin sesión, 404 idéntico para otro local o uno inexistente, 200 sin datos sobrantes para un miembro", async ({ browser, playwright }) => {
    const a = await nuevoLocal("sala-ruta-a");
    const b = await nuevoLocal("sala-ruta-b");
    await llamar(a.mesas[0].qr_token);

    const anonimo = await playwright.request.newContext({ baseURL: `http://localhost:${process.env.E2E_PORT ?? 3100}` });
    const sinSesion = await anonimo.get(`/sala/${a.t.slug}/estado`, { maxRedirects: 0 });
    expect(sinSesion.status()).toBe(401);
    expect(await sinSesion.json()).toEqual({ error: "no_session" });
    expect(sinSesion.headers()["cache-control"]).toContain("no-store");
    await anonimo.dispose();

    const ctx = await browser.newContext();
    const page = await abrirSala(ctx, a.t.staff, a.t);

    const propio = await ctx.request.get(`/sala/${a.t.slug}/estado`);
    expect(propio.status()).toBe(200);
    expect(propio.headers()["cache-control"]).toContain("no-store");
    const cuerpo = await propio.json();
    // La vista por sucursal agrega las sucursales activas del local (id y nombre), lo que mira esta persona y cuántos pendientes hay en las otras.
    expect(Object.keys(cuerpo).sort()).toEqual(["branches", "calls", "enabled", "multiBranch", "othersPending", "serverNow", "view"]);
    expect(Object.keys(cuerpo.branches[0]).sort()).toEqual(["id", "name"]);
    expect(cuerpo.view).toEqual([]);
    expect(cuerpo.othersPending).toBe(0);
    expect(Object.keys(cuerpo.calls[0]).sort()).toEqual(["branchName", "createdAt", "id", "kind", "tableLabel", "visitStartedAt"]);
    // visitStartedAt (cuándo escaneó el comensal) es lo único agregado por el ticket de visita: un instante o null, nunca un id ni la IP.
    expect(cuerpo.calls[0].visitStartedAt === null || !Number.isNaN(Date.parse(cuerpo.calls[0].visitStartedAt))).toBe(true);
    expect(JSON.stringify(cuerpo)).not.toContain(a.mesas[0].qr_token);

    const ajeno = await ctx.request.get(`/sala/${b.t.slug}/estado`);
    const inexistente = await ctx.request.get(`/sala/no-existe-este-local/estado`);
    expect(ajeno.status()).toBe(404);
    expect(inexistente.status()).toBe(404);
    expect(await ajeno.json()).toEqual(await inexistente.json());
    await expect(page.getByRole("heading", { name: "Sala en vivo" })).toBeVisible();
    await ctx.close();
  });

  test("la sala de otro local es un 404 y no muestra nada", async ({ page }) => {
    const a = await nuevoLocal("sala-aislada-a");
    const b = await nuevoLocal("sala-aislada-b");
    await llamar(b.mesas[0].qr_token);
    await login(page, a.t.staff.email, a.t.staff.password);
    const respuesta = await page.goto(`/sala/${b.t.slug}`);
    expect(respuesta?.status()).toBe(404);
    await expect(page.getByText("Mesa 1")).toHaveCount(0);
  });

  test("a 390 px con varios llamados no hay desborde y los botones son de 44 px", async ({ browser }) => {
    const { t, mesas } = await nuevoLocal("sala-layout");
    for (const m of mesas) await llamar(m.qr_token);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await abrirSala(ctx, t.owner, t);
    await expect(page.locator('[data-testid="llamado"]')).toHaveCount(3);
    await expectNoHorizontalOverflow(page);
    for (const boton of await page.getByRole("button", { name: /Marcar como atendido/ }).all()) {
      expect((await boton.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect((await page.getByRole("button", { name: "Activar alertas" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await ctx.close();
  });
});

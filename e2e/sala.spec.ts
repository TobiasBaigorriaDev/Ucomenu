import { createClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
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

/** Sustituye Web Audio y Wake Lock por dobles que cuentan: el sonido real no se puede oír en una prueba. */
async function conDobles(context: BrowserContext) {
  await context.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__osciladores = 0;
    w.__wake = 0;
    class FakeContext {
      state = "running";
      currentTime = 0;
      destination = {};
      resume() {
        return Promise.resolve();
      }
      close() {
        return Promise.resolve();
      }
      createGain() {
        return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (n: unknown) => n };
      }
      createOscillator() {
        return {
          frequency: { value: 0 },
          type: "",
          connect: (n: unknown) => n,
          start() {
            (window as unknown as { __osciladores: number }).__osciladores += 1;
          },
          stop() {},
        };
      }
    }
    w.AudioContext = FakeContext;
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        request: async () => {
          (window as unknown as { __wake: number }).__wake += 1;
          return { release: async () => {} };
        },
      },
    });
  });
}

/** Cada pitido son dos osciladores. */
const pitidos = async (page: Page) => (await page.evaluate(() => (window as unknown as { __osciladores: number }).__osciladores)) / 2;
const wakeLocks = (page: Page) => page.evaluate(() => (window as unknown as { __wake: number }).__wake);

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

    const anonimo = await playwright.request.newContext({ baseURL: "http://localhost:3100" });
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
    expect(Object.keys(cuerpo).sort()).toEqual(["calls", "enabled", "multiBranch", "serverNow"]);
    expect(Object.keys(cuerpo.calls[0]).sort()).toEqual(["branchName", "createdAt", "id", "kind", "tableLabel"]);
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

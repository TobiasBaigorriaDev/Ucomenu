import { expect, test, type Page } from "@playwright/test";
import { createTenant, expectNoHorizontalOverflow, service, type Estado, type Tenant } from "./support";

/**
 * Llamado desde la mesa (nivel C; ficha llamado-desde-la-mesa): los botones del comensal en `/t/{token}`, contra el
 * build y el Supabase local, a 390 px. Cada prueba usa un local propio con plan Pro (salvo la que prueba Básico).
 */

const tenants: Tenant[] = [];
const MENSAJE_NO_DISPONIBLE = "Por ahora no se puede avisar desde acá";

async function nuevoLocal(label: string, opciones: { estado?: Estado; plan?: "basic" | "pro" } = {}) {
  const t = await createTenant(label, opciones.estado ?? "active");
  tenants.push(t);
  const db = service();
  if ((opciones.plan ?? "pro") === "pro") {
    const r = await db.from("subscriptions").update({ plan_code: "pro" }).eq("organization_id", t.orgId);
    if (r.error) throw new Error(r.error.message);
  }
  const branch = await db.from("branches").select("id").eq("organization_id", t.orgId).single();
  await db.from("categories").insert({ organization_id: t.orgId, name: "Platos" });
  const mesas = await db
    .from("tables")
    .insert([
      { organization_id: t.orgId, branch_id: branch.data!.id, label: "Mesa 1" },
      { organization_id: t.orgId, branch_id: branch.data!.id, label: "Mesa 2" },
    ])
    .select("id, label, qr_token")
    .order("label");
  if (mesas.error) throw new Error(mesas.error.message);
  return { t, branch: branch.data!.id, mesa1: mesas.data[0], mesa2: mesas.data[1] };
}

test.afterAll(async () => {
  for (const t of tenants) await t.cleanup();
});

const llamadosDe = async (orgId: string) =>
  (await service().from("waiter_calls").select("*").eq("organization_id", orgId).order("created_at")).data ?? [];

const barra = (page: Page) => page.getByTestId("barra-llamado");
const mensaje = (page: Page) => page.getByTestId("mensaje-llamado");
const llamarAlMozo = (page: Page) => barra(page).getByRole("button", { name: "Llamar al mozo" });
const pedirCuenta = (page: Page) => barra(page).getByRole("button", { name: "Pedir la cuenta" });

test("un corte de conexión conserva la carta y permite reintentar el llamado", async ({ page }) => {
  const { t, mesa1 } = await nuevoLocal("llamado-sin-red");
  await page.goto(`/t/${mesa1.qr_token}`);
  await expect(llamarAlMozo(page)).toBeVisible();
  const ruta = `**/t/${mesa1.qr_token}*`;
  await page.route(ruta, (route) => route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue());
  await llamarAlMozo(page).click();
  await expect(mensaje(page)).toContainText(MENSAJE_NO_DISPONIBLE);
  await expect(mensaje(page)).toHaveAttribute("role", "alert");
  await expect(llamarAlMozo(page)).toBeEnabled();
  await expect(page.getByTestId("mesa")).toHaveText("Mesa 1");
  expect(await llamadosDe(t.orgId)).toHaveLength(0);
  await page.unroute(ruta);
  await llamarAlMozo(page).click();
  await expect(mensaje(page)).toContainText("Avisamos al personal");
  expect(await llamadosDe(t.orgId)).toHaveLength(1);
});

test("la barra ampliada con cuenta y reseña no tapa el pie a 320 px", async ({ page }) => {
  const { t, branch, mesa1 } = await nuevoLocal("llamado-barra-ampliada");
  await service().from("branches").update({ google_review_url: "https://g.page/r/CabcdEFGH1234/review" }).eq("id", branch);
  const categoria = await service().from("categories").select("id").eq("organization_id", t.orgId).single();
  await service().from("products").insert(Array.from({ length: 15 }, (_, i) => ({ organization_id: t.orgId, category_id: categoria.data!.id, name: `Plato ${i}`, price_cents: 10000, sort_order: i })));
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`/t/${mesa1.qr_token}`);
  await pedirCuenta(page).click();
  await expect(page.getByTestId("invitacion-resenas")).toBeVisible();
  await expect(page.getByTestId("ver-cuenta")).toBeVisible();
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
  await expect.poll(async () => {
    const pie = await page.locator("footer").boundingBox();
    const dock = await barra(page).boundingBox();
    return pie!.y + pie!.height - dock!.y;
  }).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "output/ux/barra-despues.png" });
});

test.describe("el comensal llama desde su mesa", () => {
  test("los botones aparecen, avisan al personal, confirman y no duplican", async ({ page }) => {
    const { t, mesa1 } = await nuevoLocal("llamado-flujo");
    await page.goto(`/t/${mesa1.qr_token}`);
    await expect(page.getByTestId("mesa")).toHaveText("Mesa 1");
    await expect(barra(page)).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // Objetivos táctiles de 44 px o más y accesibles por nombre.
    for (const boton of [llamarAlMozo(page), pedirCuenta(page)]) {
      const caja = await boton.boundingBox();
      expect(caja!.height).toBeGreaterThanOrEqual(44);
      expect(caja!.width).toBeGreaterThanOrEqual(44);
    }

    await llamarAlMozo(page).click();
    await expect(mensaje(page)).toContainText("Avisamos al personal");
    await expect(mensaje(page)).toHaveAttribute("role", "status");
    let filas = await llamadosDe(t.orgId);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ table_id: mesa1.id, kind: "waiter", status: "pending", organization_id: t.orgId });

    // Repetir: ya avisamos, y no se inserta nada.
    await llamarAlMozo(page).click();
    await expect(mensaje(page)).toContainText("Ya avisamos al personal");
    expect(await llamadosDe(t.orgId)).toHaveLength(1);

    // La cuenta es independiente.
    await pedirCuenta(page).click();
    await expect(mensaje(page)).toContainText("Pedimos tu cuenta");
    filas = await llamadosDe(t.orgId);
    expect(filas.map((f) => f.kind).sort()).toEqual(["bill", "waiter"]);
    await pedirCuenta(page).click();
    await expect(mensaje(page)).toContainText("Ya pedimos tu cuenta");
    expect(await llamadosDe(t.orgId)).toHaveLength(2);
  });

  test("la barra no tapa el final de la carta", async ({ page }) => {
    const { t, mesa1 } = await nuevoLocal("llamado-barra");
    // Una carta larga (que hace scroll): con la carta corta el pie queda sobre la barra aunque no haya margen.
    const categoria = await service().from("categories").select("id").eq("organization_id", t.orgId).single();
    await service().from("products").insert(
      Array.from({ length: 25 }, (_, i) => ({ organization_id: t.orgId, category_id: categoria.data!.id, name: `Plato ${i + 1}`, price_cents: 100000, sort_order: i, is_active: true })),
    );
    await page.goto(`/t/${mesa1.qr_token}`);
    await expect(barra(page)).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const pie = await page.locator("footer").boundingBox();
    const barraCaja = await barra(page).boundingBox();
    expect(pie!.y + pie!.height).toBeLessThanOrEqual(barraCaja!.y + 1);
  });

  test("con un llamado atendido, volver a llamar antes del cooldown da los segundos que faltan; después se crea", async ({ page }) => {
    const { t, mesa1 } = await nuevoLocal("llamado-cooldown");
    await page.goto(`/t/${mesa1.qr_token}`);
    await llamarAlMozo(page).click();
    await expect(mensaje(page)).toContainText("Avisamos al personal");
    await service().from("waiter_calls").update({ status: "attended" }).eq("organization_id", t.orgId);

    await llamarAlMozo(page).click();
    await expect(mensaje(page)).toContainText(/Podés volver a avisar en \d+ segundos?\./);
    expect(await llamadosDe(t.orgId)).toHaveLength(1);

    await service()
      .from("waiter_calls")
      .update({ created_at: new Date(Date.now() - 61_000).toISOString() })
      .eq("organization_id", t.orgId);
    await llamarAlMozo(page).click();
    await expect(mensaje(page)).toContainText("Avisamos al personal");
    expect(await llamadosDe(t.orgId)).toHaveLength(2);
  });

  test("un doble clic deja un solo pendiente y no muestra error", async ({ page }) => {
    const { t, mesa1 } = await nuevoLocal("llamado-doble");
    await page.goto(`/t/${mesa1.qr_token}`);
    await llamarAlMozo(page).dblclick();
    await expect(mensaje(page)).toBeVisible();
    await expect(mensaje(page)).not.toHaveAttribute("data-tone", "error");
    expect((await llamadosDe(t.orgId)).filter((f) => f.status === "pending")).toHaveLength(1);
  });

  test("dos celulares de la misma mesa a la vez: un solo pendiente", async ({ browser }) => {
    const { t, mesa1 } = await nuevoLocal("llamado-simultaneo");
    const [a, b] = await Promise.all([browser.newContext({ viewport: { width: 390, height: 844 } }), browser.newContext({ viewport: { width: 390, height: 844 } })]);
    const [p1, p2] = await Promise.all([a.newPage(), b.newPage()]);
    await Promise.all([p1.goto(`/t/${mesa1.qr_token}`), p2.goto(`/t/${mesa1.qr_token}`)]);
    await Promise.all([llamarAlMozo(p1).click(), llamarAlMozo(p2).click()]);
    await expect(mensaje(p1)).toBeVisible();
    await expect(mensaje(p2)).toBeVisible();
    expect((await llamadosDe(t.orgId)).filter((f) => f.status === "pending")).toHaveLength(1);
    await Promise.all([a.close(), b.close()]);
  });
});

test.describe("cuándo no hay botones", () => {
  test("plan Básico: no se ofrece el llamado", async ({ page }) => {
    const { t, mesa1 } = await nuevoLocal("llamado-basico", { plan: "basic" });
    await page.goto(`/t/${mesa1.qr_token}`);
    await expect(page.getByTestId("mesa")).toHaveText("Mesa 1");
    await expect(barra(page)).toHaveCount(0);
    await expect(page.getByText("Llamar al mozo")).toHaveCount(0);
    expect(await llamadosDe(t.orgId)).toHaveLength(0);
  });

  test("solo lectura: no se ofrece; suspendida: la carta no está disponible", async ({ page }) => {
    const lectura = await nuevoLocal("llamado-lectura", { estado: "read_only" });
    await page.goto(`/t/${lectura.mesa1.qr_token}`);
    await expect(page.getByTestId("mesa")).toHaveText("Mesa 1"); // la carta sigue visible
    await expect(barra(page)).toHaveCount(0);

    const suspendida = await nuevoLocal("llamado-suspendida", { estado: "suspended" });
    await page.goto(`/t/${suspendida.mesa1.qr_token}`);
    await expect(page.getByText("Carta temporalmente no disponible")).toBeVisible();
    await expect(barra(page)).toHaveCount(0);
  });

  test("mesa inactiva o silenciada: carta sin botones", async ({ page }) => {
    const { mesa1, mesa2 } = await nuevoLocal("llamado-mesa-fuera");
    const db = service();
    await db.from("tables").update({ is_active: false }).eq("id", mesa1.id);
    await db.from("tables").update({ muted_until: new Date(Date.now() + 600_000).toISOString() }).eq("id", mesa2.id);

    await page.goto(`/t/${mesa1.qr_token}`);
    await expect(page.getByTestId("mesa")).toHaveCount(0);
    await expect(barra(page)).toHaveCount(0);

    await page.goto(`/t/${mesa2.qr_token}`);
    await expect(barra(page)).toHaveCount(0);
  });

  test("un QR regenerado da 404 y no ofrece nada", async ({ page }) => {
    const { mesa1 } = await nuevoLocal("llamado-regenerado");
    await service().from("tables").update({ qr_token: "regenerar" }).eq("id", mesa1.id);
    const respuesta = await page.goto(`/t/${mesa1.qr_token}`);
    expect(respuesta?.status()).toBe(404);
    await expect(barra(page)).toHaveCount(0);
  });
});

test.describe("pantalla ya abierta cuando cambia el estado: la base manda", () => {
  const cambios: [string, (orgId: string, mesaId: string) => PromiseLike<unknown>][] = [
    ["el plan pasa a Básico", (orgId) => service().from("subscriptions").update({ plan_code: "basic" }).eq("organization_id", orgId)],
    [
      "la cuenta pasa a solo lectura",
      (orgId) => service().from("subscriptions").update({ current_period_end: new Date(Date.now() - 10 * 864e5).toISOString(), trial_ends_at: null }).eq("organization_id", orgId),
    ],
    [
      "la cuenta se suspende",
      (orgId) => service().from("subscriptions").update({ current_period_end: new Date(Date.now() - 20 * 864e5).toISOString(), trial_ends_at: null }).eq("organization_id", orgId),
    ],
    ["la mesa se desactiva", (_orgId, mesaId) => service().from("tables").update({ is_active: false }).eq("id", mesaId)],
    [
      "la mesa se silencia",
      (_orgId, mesaId) => service().from("tables").update({ muted_until: new Date(Date.now() + 600_000).toISOString() }).eq("id", mesaId),
    ],
    ["la organización se desactiva", (orgId) => service().from("organizations").update({ is_active: false }).eq("id", orgId)],
  ];

  for (const [indice, [descripcion, cambiar]] of cambios.entries()) {
    test(`${descripcion}: el botón que ya estaba en pantalla responde «no disponible» y no crea nada`, async ({ page }) => {
      const { t, mesa1 } = await nuevoLocal(`llamado-forzado-${indice}`);
      await page.goto(`/t/${mesa1.qr_token}`);
      await expect(barra(page)).toBeVisible();

      await cambiar(t.orgId, mesa1.id);
      await llamarAlMozo(page).click();
      await expect(mensaje(page)).toContainText(MENSAJE_NO_DISPONIBLE);
      await expect(mensaje(page)).toHaveAttribute("role", "alert");
      // El mensaje es el mismo sea cual sea la causa: no revela plan, mora ni silencio.
      await expect(mensaje(page)).not.toContainText(/plan|pago|mora|silenci|suscrip/i);
      expect(await llamadosDe(t.orgId)).toHaveLength(0);
    });
  }
});

test.describe("identificador de cliente y límite", () => {
  test("se guarda un identificador derivado de la IP, estable por IP, y nunca la IP", async ({ browser }) => {
    const { t, mesa1, mesa2 } = await nuevoLocal("llamado-ip");
    const desde = async (ip: string, token: string) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "x-forwarded-for": `${ip}, 10.0.0.1` } });
      const p = await ctx.newPage();
      await p.goto(`/t/${token}`);
      await llamarAlMozo(p).click();
      await expect(mensaje(p)).toContainText("Avisamos al personal");
      await ctx.close();
    };
    await desde("203.0.113.50", mesa1.qr_token);
    await desde("203.0.113.50", mesa2.qr_token);
    const otra = await nuevoLocal("llamado-ip-otro");
    await desde("203.0.113.51", otra.mesa1.qr_token);

    const filas = await llamadosDe(t.orgId);
    expect(filas).toHaveLength(2);
    expect(filas[0].client_key).toMatch(/^[0-9a-f]{32}$/);
    expect(filas[0].client_key).toBe(filas[1].client_key);
    const deOtra = await llamadosDe(otra.t.orgId);
    expect(deOtra[0].client_key).toMatch(/^[0-9a-f]{32}$/);
    expect(deOtra[0].client_key).not.toBe(filas[0].client_key);

    // La IP no aparece en ninguna columna de ninguna fila.
    for (const fila of [...filas, ...deOtra]) expect(JSON.stringify(fila)).not.toContain("203.0.113");
  });

  test("sin una IP válida no se guarda identificador (rigen el cooldown y el pendiente único)", async ({ browser }) => {
    const { t, mesa1 } = await nuevoLocal("llamado-sin-ip");
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "x-forwarded-for": "' or 1=1 --" } });
    const p = await ctx.newPage();
    await p.goto(`/t/${mesa1.qr_token}`);
    await llamarAlMozo(p).click();
    await expect(mensaje(p)).toContainText("Avisamos al personal");
    await ctx.close();
    expect((await llamadosDe(t.orgId))[0].client_key).toBeNull();
  });

  test("al superar 30 avisos en 10 minutos desde la misma conexión, el siguiente se rechaza con un mensaje claro", async ({ browser }) => {
    const { t, branch, mesa1, mesa2 } = await nuevoLocal("llamado-limite");
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "x-forwarded-for": "198.51.100.77" } });
    const p = await ctx.newPage();
    await p.goto(`/t/${mesa1.qr_token}`);
    await llamarAlMozo(p).click();
    await expect(mensaje(p)).toContainText("Avisamos al personal");
    const clave = (await llamadosDe(t.orgId))[0].client_key!;

    // 29 más del mismo identificador (ya atendidos, en otra mesa) completan los 30 de la ventana.
    const ruido = Array.from({ length: 29 }, (_, i) => ({
      organization_id: t.orgId,
      branch_id: branch,
      table_id: mesa2.id,
      kind: i % 2 === 0 ? "waiter" : "bill",
      status: "attended",
      client_key: clave,
      created_at: new Date(Date.now() - 60_000 - i * 1000).toISOString(),
    }));
    expect((await service().from("waiter_calls").insert(ruido)).error).toBeNull();

    await pedirCuenta(p).click();
    await expect(mensaje(p)).toContainText(/Se hicieron demasiados avisos desde tu conexión\. Probá de nuevo en \d+ minutos?\./);
    await expect(mensaje(p)).toHaveAttribute("role", "alert");
    expect((await llamadosDe(t.orgId)).filter((f) => f.kind === "bill" && f.table_id === mesa1.id)).toHaveLength(0);
    await ctx.close();

    // Otra conexión no se ve afectada.
    const otro = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "x-forwarded-for": "198.51.100.78" } });
    const q = await otro.newPage();
    await q.goto(`/t/${mesa1.qr_token}`);
    await pedirCuenta(q).click();
    await expect(mensaje(q)).toContainText("Pedimos tu cuenta");
    await otro.close();
  });
});

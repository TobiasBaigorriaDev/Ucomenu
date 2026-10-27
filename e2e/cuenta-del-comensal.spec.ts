import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { PALETTE_KEYS } from "../src/lib/identidad/palettes";
import { createTenant, expectNoHorizontalOverflow, login, service, type Person, type Tenant } from "./support";

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
  // El ticket de visita guarda segundos enteros y debe ser ESTRICTAMENTE posterior al inicio del turno: una mesa recién creada rechazaría
  // un escaneo del mismo segundo (pide escanear de nuevo; una persona real nunca escanea en el segundo en que el mozo cobra). La mesa de
  // la prueba arranca con un turno de hace un minuto, como una mesa de verdad.
  await db.from("tables").update({ turn_started_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", mesas.data[0].id);
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

test("propina opcional coincide con la precuenta impresa y se actualiza al desactivarla", async ({ browser }) => {
  const l = await nuevoLocal("cuenta-propina");
  const { order } = await pedido(l);
  expect((await service().from("branches").update({ tip_percent: 10 }).eq("id", l.branch)).error).toBeNull();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(`/t/${l.mesa.qr_token}`);
  await pedirCuenta(page).click();
  await page.getByTestId("ver-cuenta").click();
  await expect(page.getByTestId("propina-importe")).toContainText("Propina sugerida (10 %)");
  await expect(page.getByTestId("propina-importe")).toHaveAttribute("data-centavos", "2600");
  await expect(page.getByTestId("propina-total")).toHaveAttribute("data-centavos", "28600");
  await expect(page.getByTestId("cuenta-total")).toContainText("Total consumido");
  await expect(page.getByTestId("cuenta-total")).toHaveAttribute("data-centavos", "26000");
  await expect(page.getByTestId("propina-sugerida")).toContainText("La propina es opcional");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: "output/propina-cliente-mobile.png", fullPage: true });

  const staffCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const staffPage = await staffCtx.newPage();
  await login(staffPage, l.t.staff.email, l.t.staff.password);
  await staffPage.goto(`/sala/${l.t.slug}/cuenta/${order}`);
  await expect(staffPage.getByTestId("propina-total")).toHaveAttribute("data-centavos", "28600");
  await expect(staffPage.getByTestId("precuenta-total")).toHaveAttribute("data-centavos", "26000");
  await staffPage.emulateMedia({ media: "print" });
  await expect(staffPage.getByTestId("propina-sugerida")).toBeVisible();
  await expect(staffPage.getByTestId("propina-sugerida")).toContainText("La propina es opcional");
  await staffPage.screenshot({ path: "output/propina-precuenta-impresion.png", fullPage: true });

  expect((await service().from("branches").update({ tip_percent: null }).eq("id", l.branch)).error).toBeNull();
  await page.getByTestId("cuenta-actualizar").click();
  await expect(page.getByTestId("propina-sugerida")).toHaveCount(0);
  await expect(page.getByTestId("cuenta-total")).toHaveAttribute("data-centavos", "26000");
  await staffPage.reload();
  await expect(staffPage.getByTestId("propina-sugerida")).toHaveCount(0);
  await staffCtx.close();
  await ctx.close();
});
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

    // Llamar al mozo después no hace desaparecer «Ver mi cuenta» (cada envío reemplaza el mensaje del anterior).
    await barra(page).getByRole("button", { name: "Llamar al mozo" }).click();
    await expect(page.getByTestId("mensaje-llamado")).toContainText("Avisamos al personal");
    await expect(page.getByTestId("ver-cuenta")).toBeVisible();
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

test.describe("los llamados terminan con el turno de la mesa (feedback del usuario en staging)", () => {
  const llamadosDe = async (orgId: string) => (await service().from("waiter_calls").select("kind, status").eq("organization_id", orgId)).data ?? [];

  for (const cierre of ["reiniciar el QR", "cobrar la mesa"] as const) {
    test(`tras ${cierre}, el celular que ya estaba en la mesa no puede llamar al mozo hasta escanear de nuevo`, async ({ browser }) => {
      const l = await nuevoLocal(`llamados-turno-${cierre === "cobrar la mesa" ? "cobro" : "reinicio"}`);
      const p = await pedido(l);
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      await page.goto(`/t/${l.mesa.qr_token}`);
      await expect(barra(page)).toBeVisible();
      // El ticket guarda segundos enteros y el corte tolera 1 s: hay que dejar pasar el segundo para que el turno sea claramente posterior.
      await page.waitForTimeout(1300);

      if (cierre === "reiniciar el QR") expect((await p.db.rpc("reset_table_turn", { p_table: l.mesa.id })).error).toBeNull();
      else expect((await p.db.rpc("close_order", { p_order: p.order })).error).toBeNull();

      await barra(page).getByRole("button", { name: "Llamar al mozo" }).click();
      await expect(page.getByTestId("sesion-vencida")).toContainText("Esta sesión venció");
      expect(await llamadosDe(l.t.orgId)).toEqual([]);

      // Escanear de nuevo (un ticket posterior al turno) permite llamar con normalidad.
      await page.goto(`/t/${l.mesa.qr_token}`);
      await barra(page).getByRole("button", { name: "Llamar al mozo" }).click();
      await expect(page.getByTestId("mensaje-llamado")).toContainText("Avisamos al personal");
      expect(await llamadosDe(l.t.orgId)).toEqual([{ kind: "waiter", status: "pending" }]);
      await ctx.close();
    });
  }
});

/**
 * Contraste real (WCAG) de cada texto de la hoja contra su fondo efectivo. La hoja vive dentro de `.carta`, así que hereda la paleta del
 * local: en las oscuras la tinta es CLARA y un fondo fijo claro dejaba «letras clarititas» (feedback del usuario en staging).
 */
async function peoresContrastes(page: Page) {
  return page.getByTestId("hoja-cuenta").evaluate((dialog) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const rgba = (css: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const luminance = ([r, g, b]: number[]) => {
      const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const background = (element: Element): number[] => {
      // De abajo hacia arriba: se compone cada fondo semitransparente sobre lo que hay detrás (blanco si no queda nada opaco).
      const layers: [number, number, number, number][] = [];
      for (let node: Element | null = element; node; node = node.parentElement) {
        const color = rgba(getComputedStyle(node).backgroundColor);
        if (color[3] > 0) layers.push(color);
        if (color[3] >= 1) break;
      }
      let base: number[] = [255, 255, 255];
      for (const [r, g, b, a] of layers.reverse()) base = [r * a + base[0] * (1 - a), g * a + base[1] * (1 - a), b * a + base[2] * (1 - a)];
      return base;
    };
    const resultados: { texto: string; ratio: number }[] = [];
    const walker = document.createTreeWalker(dialog, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const texto = (node.textContent ?? "").trim();
      const element = node.parentElement;
      if (!texto || !element) continue;
      const foreground = rgba(getComputedStyle(element).color);
      const back = background(element);
      const fg = [0, 1, 2].map((i) => foreground[i] * foreground[3] + back[i] * (1 - foreground[3]));
      const l1 = luminance(fg);
      const l2 = luminance(back);
      resultados.push({ texto: texto.slice(0, 40), ratio: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) });
    }
    return resultados.sort((a, b) => a.ratio - b.ratio).slice(0, 3);
  });
}

test.describe("legibilidad de la cuenta con las paletas del local", () => {
  test("todos los textos de la hoja pasan 4,5:1 en cada paleta, clara u oscura, y en el estilo afiche", async ({ browser }) => {
    test.setTimeout(240_000);
    const l = await nuevoLocal("cuenta-paletas");
    await pedido(l);
    const db = service();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const casos: { palette: string; layout: string }[] = [
      ...PALETTE_KEYS.map((palette) => ({ palette, layout: "bento" })),
      { palette: "carbon", layout: "afiche" },
      { palette: "oliva", layout: "afiche" },
    ];
    const fallas: string[] = [];
    for (const { palette, layout } of casos) {
      expect((await db.from("organizations").update({ menu_palette: palette, menu_layout: layout }).eq("id", l.t.orgId)).error).toBeNull();
      await page.goto(`/t/${l.mesa.qr_token}`);
      await expect(barra(page)).toBeVisible();
      // Un solo pedido de cuenta por mesa: la primera vez se crea; después queda pendiente (o en espera) y el botón sigue ofreciéndose.
      await pedirCuenta(page).click();
      await page.getByTestId("ver-cuenta").click();
      await expect(page.getByTestId("cuenta-total")).toBeVisible();
      for (const peor of await peoresContrastes(page)) {
        if (peor.ratio < 4.5) fallas.push(`${palette}/${layout}: «${peor.texto}» ${peor.ratio.toFixed(2)}:1`);
      }
      await page.getByTestId("hoja-cuenta").getByRole("button", { name: "Cerrar" }).first().click();
    }
    expect(fallas).toEqual([]);
    await ctx.close();
  });
});

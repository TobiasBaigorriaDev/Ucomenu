import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { conDobles, sintetizados, sonidos, vibraciones } from "./audio-doble";
import { createTenant, expectNoHorizontalOverflow, login, service, type Person, type Tenant } from "./support";

/**
 * Tonos y vibración de aviso (fichas tonos-de-aviso y vibracion-de-aviso): el Dueño elige en `/panel/{slug}/llamados` qué suena ante un llamado de mesa y ante un
 * pedido listo, y la sala usa ese tono. Contra el build y el Supabase local, a 390 px. Cada prueba usa un local propio.
 */

const tenants: Tenant[] = [];
const HZ_CAMPANA = 659;
const HZ_MARIMBA = 523;

async function nuevoLocal(label: string) {
  const t = await createTenant(label, "active");
  tenants.push(t);
  const db = service();
  await db.from("subscriptions").update({ plan_code: "pro" }).eq("organization_id", t.orgId);
  const branch = await db.from("branches").select("id").eq("organization_id", t.orgId).single();
  const mesa = await db.from("tables").insert({ organization_id: t.orgId, branch_id: branch.data!.id, label: "Mesa 1" }).select("qr_token").single();
  return { t, token: mesa.data!.qr_token as string };
}

test.afterAll(async () => {
  for (const t of tenants) await t.cleanup();
});

const tonosDe = async (orgId: string) => (await service().from("organizations").select("call_tone, ready_tone").eq("id", orgId).single()).data;
const vibracionDe = async (orgId: string) => (await service().from("organizations").select("vibration").eq("id", orgId).single()).data?.vibration;

async function abrir(context: BrowserContext, persona: Person, ruta: string) {
  const page = await context.newPage();
  await login(page, persona.email, persona.password);
  await page.goto(ruta);
  return page;
}

test.describe("tonos de aviso", () => {
  test("el Dueño escucha, elige y guarda un tono para cada aviso, y la elección sobrevive a la recarga", async ({ browser }) => {
    const { t } = await nuevoLocal("tonos-elegir");
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await conDobles(ctx);
    const page = await abrir(ctx, t.owner, `/panel/${t.slug}/llamados`);

    await expect(page.getByTestId("tonos-de-aviso")).toBeVisible();
    await expect(page.getByTestId("tonos-call").getByRole("radio", { name: /Clásico/ })).toBeChecked();
    await expect(page.getByTestId("tonos-ready").getByRole("radio", { name: /Plato listo/ })).toBeChecked();
    await expectNoHorizontalOverflow(page);

    // Escuchar no activa las alertas ni guarda nada.
    await page.getByTestId("escuchar-call-campana").click();
    await expect(page.getByTestId("tono-escuchado")).toContainText("Campana");
    await expect.poll(() => sintetizados(page)).toContain(HZ_CAMPANA);
    expect(await sonidos(page)).toEqual([]);
    expect(await tonosDe(t.orgId)).toEqual({ call_tone: "llamado", ready_tone: "plato-listo" });

    // Un tono de archivo también se escucha (es el MP3 de siempre).
    await page.getByTestId("escuchar-ready-plato-listo").click();
    await expect.poll(() => sonidos(page)).toEqual(["ready"]);

    await page.getByTestId("tonos-call").getByRole("radio", { name: /Campana/ }).check();
    await page.getByTestId("tonos-ready").getByRole("radio", { name: /Marimba/ }).check();

    // La vibración: por defecto «Fuerte»; «Probar» vibra con el patrón del llamado sin guardar nada.
    await expect(page.getByTestId("vibracion").getByRole("radio", { name: /Fuerte/ })).toBeChecked();
    await page.getByTestId("probar-vibracion-muy_fuerte").click();
    await expect(page.getByTestId("tono-escuchado")).toContainText("Vibrando: Muy fuerte");
    expect(await vibraciones(page)).toEqual([[700, 200, 700, 200, 700, 200, 700]]);
    await page.getByTestId("probar-vibracion-ninguna").click();
    await expect(page.getByTestId("tono-escuchado")).toContainText("Sin vibración");
    expect(await vibraciones(page)).toHaveLength(1);
    expect(await vibracionDe(t.orgId)).toBe("fuerte");
    await page.getByTestId("vibracion").getByRole("radio", { name: /Muy fuerte/ }).check();

    await page.getByRole("button", { name: "Guardar tonos y vibración" }).click();
    await expect(page.locator("form").getByRole("status")).toContainText("Guardado");
    expect(await tonosDe(t.orgId)).toEqual({ call_tone: "campana", ready_tone: "marimba" });
    expect(await vibracionDe(t.orgId)).toBe("muy_fuerte");

    await page.reload();
    await expect(page.getByTestId("tonos-call").getByRole("radio", { name: /Campana/ })).toBeChecked();
    await expect(page.getByTestId("tonos-ready").getByRole("radio", { name: /Marimba/ })).toBeChecked();
    await expect(page.getByTestId("vibracion").getByRole("radio", { name: /Muy fuerte/ })).toBeChecked();
    await ctx.close();
  });

  test("el Staff ve los tonos elegidos pero no puede cambiarlos", async ({ browser }) => {
    const { t } = await nuevoLocal("tonos-staff");
    await service().from("organizations").update({ call_tone: "timbre", ready_tone: "digital", vibration: "suave" }).eq("id", t.orgId);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await abrir(ctx, t.staff, `/panel/${t.slug}/llamados`);

    await expect(page.getByTestId("tonos-lectura")).toContainText("Cuando una mesa llama: Timbre");
    await expect(page.getByTestId("tonos-lectura")).toContainText("Cuando un pedido está listo: Digital");
    await expect(page.getByTestId("tonos-lectura")).toContainText("Vibración del celular: Suave");
    await expect(page.getByRole("button", { name: "Guardar tonos y vibración" })).toHaveCount(0);
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await ctx.close();
  });

  test("la sala suena con el tono elegido ante un llamado, no con el MP3", async ({ browser }) => {
    const { t, token } = await nuevoLocal("tonos-sala");
    await service().from("organizations").update({ call_tone: "campana", ready_tone: "marimba", vibration: "muy_fuerte" }).eq("id", t.orgId);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await conDobles(ctx);
    const page: Page = await abrir(ctx, t.staff, `/sala/${t.slug}`);
    await expect(page.getByRole("heading", { name: "Mesas en vivo", level: 1 })).toBeVisible();

    await page.getByRole("button", { name: "Activar alertas" }).click();
    await expect(page.getByTestId("alertas-activas")).toBeVisible();
    const alConfirmar = (await sintetizados(page)).length;
    expect(alConfirmar).toBeGreaterThan(0); // la confirmación ya usa el tono de llamado

    const { error } = await service().rpc("create_waiter_call", { p_token: token, p_kind: "waiter" });
    expect(error).toBeNull();
    await expect.poll(async () => (await sintetizados(page)).length, { timeout: 12_000 }).toBeGreaterThan(alConfirmar);
    expect(new Set(await sintetizados(page))).toEqual(new Set([HZ_CAMPANA, HZ_CAMPANA * 2.76, 880, 880 * 2.76]));
    expect(await sonidos(page)).toEqual([]);
    expect(await sintetizados(page)).not.toContain(HZ_MARIMBA); // el de pedido listo no suena ante un llamado
    // El celular vibra con la intensidad del local: el llamado al mozo, y «Pedir la cuenta» con otro patrón.
    await expect.poll(() => vibraciones(page)).toEqual([[700, 200, 700, 200, 700, 200, 700]]);
    const mesa2 = await service().from("tables").insert({ organization_id: t.orgId, branch_id: (await service().from("branches").select("id").eq("organization_id", t.orgId).single()).data!.id, label: "Mesa 2" }).select("qr_token").single();
    const cuenta = await service().rpc("create_waiter_call", { p_token: mesa2.data!.qr_token, p_kind: "bill" });
    expect(cuenta.error).toBeNull();
    await expect.poll(() => vibraciones(page), { timeout: 12_000 }).toEqual([[700, 200, 700, 200, 700, 200, 700], [1500, 300, 1500, 300, 1500]]);
    await ctx.close();
  });
});

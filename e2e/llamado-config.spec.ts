import { expect, test, type Page } from "@playwright/test";
import { alerta, createTenant, expectNoHorizontalOverflow, login, service, type Estado, type Person, type Tenant } from "./support";

/**
 * Configuración del llamado (ficha configuracion-del-llamado): `/panel/{slug}/llamados`, donde se silencian mesas y se
 * ajusta el cooldown de la sucursal, contra el build y el Supabase local, a 390 px. Cada prueba usa un local propio.
 */

const tenants: Tenant[] = [];

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
      { organization_id: t.orgId, branch_id: branch.data!.id, label: "Mesa 1", is_active: true },
      { organization_id: t.orgId, branch_id: branch.data!.id, label: "Mesa 2", is_active: true },
      { organization_id: t.orgId, branch_id: branch.data!.id, label: "Mesa 3", is_active: false },
    ])
    .select("id, label, qr_token")
    .order("label");
  if (mesas.error) throw new Error(mesas.error.message);
  return { t, branch: branch.data!.id, mesa1: mesas.data[0], mesa2: mesas.data[1], mesa3: mesas.data[2] };
}

test.afterAll(async () => {
  for (const t of tenants) await t.cleanup();
});

async function ingresar(page: Page, persona: Person, t: Tenant) {
  await login(page, persona.email, persona.password);
  await page.goto(`/panel/${t.slug}/llamados`);
}

const mesa = (page: Page, label: string) => page.locator(`[data-testid="mesa"][data-label="${label}"]`);
const mutedUntilDe = async (id: string) => (await service().from("tables").select("muted_until").eq("id", id).single()).data?.muted_until ?? null;
const cooldownDe = async (branchId: string) =>
  (await service().from("branches").select("waiter_call_cooldown_seconds").eq("id", branchId).single()).data?.waiter_call_cooldown_seconds;
const aviso = (page: Page) => page.locator("form").getByRole("status");

async function silenciar(page: Page, label: string, duracion: string) {
  await mesa(page, label).locator("summary", { hasText: "Silenciar" }).click();
  await mesa(page, label).getByRole("button", { name: `Silenciar ${label} por ${duracion}` }).click();
}

test.describe("silenciar mesas", () => {
  test("el Dueño silencia una mesa: la pantalla lo muestra, el comensal pierde los botones y al quitar el silencio vuelven", async ({ page, browser }) => {
    const { t, mesa1, mesa2 } = await nuevoLocal("cfg-silencio");
    await ingresar(page, t.owner, t);
    await expect(page.getByRole("heading", { name: "Configuración del llamado" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Llamados" })).toHaveAttribute("aria-current", "page");
    await expectNoHorizontalOverflow(page);

    // El comensal ve los botones antes de silenciar.
    const comensal = await browser.newPage();
    await comensal.goto(`/t/${mesa1.qr_token}`);
    await expect(comensal.getByTestId("barra-llamado")).toBeVisible();

    const antes = Date.now();
    await silenciar(page, "Mesa 1", "1 hora");
    await expect(aviso(page)).toContainText("Mesa silenciada");
    await expect(mesa(page, "Mesa 1").getByTestId("silenciada")).toContainText("Silenciada hasta");
    const hasta = Date.parse((await mutedUntilDe(mesa1.id))!);
    expect(hasta).toBeGreaterThan(antes + 59 * 60_000);
    expect(hasta).toBeLessThan(Date.now() + 61 * 60_000);
    expect(await mutedUntilDe(mesa2.id)).toBeNull(); // las demás no se tocan
    await expect(mesa(page, "Mesa 2").getByTestId("silenciada")).toHaveCount(0);

    await comensal.reload();
    await expect(comensal.getByTestId("mesa")).toHaveText("Mesa 1");
    await expect(comensal.getByTestId("barra-llamado")).toHaveCount(0);

    // Quitar el silencio.
    await page.reload();
    await mesa(page, "Mesa 1").getByRole("button", { name: "Quitar el silencio de Mesa 1" }).click();
    await expect(aviso(page)).toContainText("vuelve a admitir llamados");
    expect(await mutedUntilDe(mesa1.id)).toBeNull();
    await comensal.reload();
    await expect(comensal.getByTestId("barra-llamado")).toBeVisible();
    await comensal.close();
  });

  test("las cuatro duraciones guardan el fin que dicen", async ({ page }) => {
    const { t, mesa1 } = await nuevoLocal("cfg-duraciones");
    await ingresar(page, t.owner, t);
    for (const [texto, minutos] of [["15 minutos", 15], ["1 hora", 60], ["4 horas", 240], ["24 horas", 1440]] as const) {
      await page.goto(`/panel/${t.slug}/llamados`);
      const antes = Date.now();
      await silenciar(page, "Mesa 1", texto);
      await expect(aviso(page)).toContainText("Mesa silenciada");
      const hasta = Date.parse((await mutedUntilDe(mesa1.id))!);
      expect(hasta - antes, texto).toBeGreaterThanOrEqual(minutos * 60_000 - 5_000);
      expect(hasta - Date.now(), texto).toBeLessThanOrEqual(minutos * 60_000 + 5_000);
    }
  });

  test("el Staff también silencia", async ({ page }) => {
    const { t, mesa2 } = await nuevoLocal("cfg-staff-silencia");
    await ingresar(page, t.staff, t);
    await silenciar(page, "Mesa 2", "15 minutos");
    await expect(aviso(page)).toContainText("Mesa silenciada");
    expect(await mutedUntilDe(mesa2.id)).not.toBeNull();
  });

  test("una mesa inactiva avisa que no admite llamados y se puede silenciar igual", async ({ page }) => {
    const { t, mesa3 } = await nuevoLocal("cfg-inactiva");
    await ingresar(page, t.owner, t);
    await expect(mesa(page, "Mesa 3")).toContainText("Inactiva");
    await expect(mesa(page, "Mesa 3")).toContainText("no admite llamados");
    await silenciar(page, "Mesa 3", "15 minutos");
    await expect(aviso(page)).toContainText("Mesa silenciada");
    expect(await mutedUntilDe(mesa3.id)).not.toBeNull();
  });

  test("un silencio ya vencido no se muestra", async ({ page }) => {
    const { t, mesa1 } = await nuevoLocal("cfg-vencido");
    await service().from("tables").update({ muted_until: new Date(Date.now() - 60_000).toISOString() }).eq("id", mesa1.id);
    await ingresar(page, t.owner, t);
    await expect(mesa(page, "Mesa 1")).toBeVisible();
    await expect(page.getByTestId("silenciada")).toHaveCount(0);
    await expect(mesa(page, "Mesa 1").getByRole("button", { name: /Quitar el silencio/ })).toHaveCount(0);
  });

  test("objetivos táctiles de 44 px y sin desborde con una mesa silenciada y el panel abierto", async ({ page }) => {
    const { t, mesa1 } = await nuevoLocal("cfg-tactil");
    await service().from("tables").update({ muted_until: new Date(Date.now() + 30 * 60_000).toISOString() }).eq("id", mesa1.id);
    await ingresar(page, t.owner, t);
    await mesa(page, "Mesa 1").locator("summary", { hasText: "Silenciar" }).click();
    const botones = [
      mesa(page, "Mesa 1").locator("summary", { hasText: "Silenciar" }),
      mesa(page, "Mesa 1").getByRole("button", { name: "Silenciar Mesa 1 por 15 minutos" }),
      mesa(page, "Mesa 1").getByRole("button", { name: "Quitar el silencio de Mesa 1" }),
      page.getByLabel(/Segundos entre llamados/),
      page.getByRole("button", { name: "Guardar" }),
    ];
    for (const boton of botones) {
      const caja = await boton.boundingBox();
      expect(caja!.height).toBeGreaterThanOrEqual(44);
    }
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("mesa con nombre largo y varios estados", () => {
  // Revisión de Codex (P2): con «Inactiva» y «Silenciada hasta mañana» el nombre quedaba con ancho cero.
  for (const ancho of [390, 360]) {
    test(`a ${ancho} px el nombre se lee entero y nada desborda (inactiva y silenciada hasta mañana)`, async ({ page }) => {
      const { t, branch } = await nuevoLocal(`cfg-largo-${ancho}`);
      const etiqueta = "Terraza del fondo con nombre largo 3"; // 36 de 40 caracteres
      const fila = await service()
        .from("tables")
        .insert({
          organization_id: t.orgId,
          branch_id: branch,
          label: etiqueta,
          is_active: false,
          muted_until: new Date(Date.now() + 23 * 3_600_000 + 50 * 60_000).toISOString(),
        })
        .select("id")
        .single();
      expect(fila.error).toBeNull();

      await page.setViewportSize({ width: ancho, height: 800 });
      await ingresar(page, t.owner, t);
      const item = mesa(page, etiqueta);
      await expect(item.getByTestId("silenciada")).toContainText("Silenciada hasta");
      await expect(item).toContainText("Inactiva");

      // El nombre ocupa el ancho de la fila (no queda apretado letra por letra) y se lee en pocas líneas.
      const nombre = await item.locator("p", { hasText: etiqueta }).first().boundingBox();
      expect(nombre!.width).toBeGreaterThan(ancho * 0.6);
      expect(nombre!.height).toBeLessThan(80);
      // Ningún estado se sale de la pantalla.
      for (const estado of [item.getByText("Inactiva", { exact: true }), item.getByTestId("silenciada")]) {
        const caja = await estado.boundingBox();
        expect(caja!.x).toBeGreaterThanOrEqual(0);
        expect(caja!.x + caja!.width).toBeLessThanOrEqual(ancho);
      }
      await expectNoHorizontalOverflow(page);
    });
  }
});

test.describe("cooldown", () => {
  test("el Dueño lo cambia; el valor persiste y se vuelve a mostrar", async ({ page }) => {
    const { t, branch } = await nuevoLocal("cfg-cooldown");
    await ingresar(page, t.owner, t);
    const campo = page.getByLabel(/Segundos entre llamados/);
    await expect(campo).toHaveValue("60");
    await campo.fill("90");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(aviso(page)).toContainText("90 segundos");
    expect(await cooldownDe(branch)).toBe(90);

    await page.reload();
    await expect(page.getByLabel(/Segundos entre llamados/)).toHaveValue("90");
  });

  test("un valor imposible se rechaza con un mensaje claro (aunque se esquive la validación del navegador) y nada cambia", async ({ page }) => {
    const { t, branch } = await nuevoLocal("cfg-cooldown-malo");
    await ingresar(page, t.owner, t);
    for (const valor of ["5", "3601", "60.5", "abc", ""]) {
      await page.goto(`/panel/${t.slug}/llamados`); // pantalla nueva en cada vuelta: el aviso anterior no confunde
      // Se esquiva la validación del navegador para probar la del servidor (un envío manipulado).
      await page.locator("form", { has: page.getByLabel(/Segundos entre llamados/) }).evaluate((f) => ((f as HTMLFormElement).noValidate = true));
      const campo = page.getByLabel(/Segundos entre llamados/);
      await campo.evaluate((el) => ((el as HTMLInputElement).type = "text"));
      await campo.fill(valor);
      await page.getByRole("button", { name: "Guardar" }).click();
      await expect(alerta(page), valor).toContainText(/Ingresá/);
      expect(await cooldownDe(branch), valor).toBe(60);
    }
  });

  test("el Staff ve el valor sin poder cambiarlo", async ({ page }) => {
    const { t, branch } = await nuevoLocal("cfg-cooldown-staff");
    await service().from("branches").update({ waiter_call_cooldown_seconds: 120 }).eq("id", branch);
    await ingresar(page, t.staff, t);
    await expect(page.getByTestId("cooldown-lectura")).toContainText("120 segundos");
    await expect(page.getByTestId("cooldown-lectura")).toContainText("Dueño");
    await expect(page.getByLabel(/Segundos entre llamados/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Guardar" })).toHaveCount(0);
  });
});

test.describe("cuenta y plan", () => {
  for (const [estado, texto] of [["read_only", "solo lectura"], ["suspended", "suspendida"]] as const) {
    test(`con la cuenta ${texto} se ve todo pero los controles están deshabilitados y nada cambia`, async ({ page }) => {
      const { t, branch, mesa1 } = await nuevoLocal(`cfg-${estado.replace("_", "-")}`, { estado });
      await ingresar(page, t.owner, t);
      await expect(page.getByTestId("llamados-bloqueados")).toContainText(texto);
      await expect(page.getByLabel(/Segundos entre llamados/)).toBeDisabled();
      await expect(page.getByRole("button", { name: "Guardar" })).toBeDisabled();
      await mesa(page, "Mesa 1").locator("summary", { hasText: "Silenciar" }).click();
      await expect(mesa(page, "Mesa 1").getByRole("button", { name: "Silenciar Mesa 1 por 15 minutos" })).toBeDisabled();
      expect(await cooldownDe(branch)).toBe(60);
      expect(await mutedUntilDe(mesa1.id)).toBeNull();
    });
  }

  test("en gracia se edita con normalidad", async ({ page }) => {
    const { t, branch } = await nuevoLocal("cfg-gracia", { estado: "grace" });
    await ingresar(page, t.owner, t);
    await expect(page.getByTestId("llamados-bloqueados")).toHaveCount(0);
    await page.getByLabel(/Segundos entre llamados/).fill("45");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(aviso(page)).toContainText("45 segundos");
    expect(await cooldownDe(branch)).toBe(45);
  });

  test("con plan Básico avisa que el llamado no está activo, pero deja la configuración lista", async ({ page }) => {
    const { t, branch } = await nuevoLocal("cfg-basico", { plan: "basic" });
    await ingresar(page, t.owner, t);
    await expect(page.getByTestId("llamado-inactivo")).toContainText("no está activo");
    await page.getByLabel(/Segundos entre llamados/).fill("100");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(aviso(page)).toContainText("100 segundos");
    expect(await cooldownDe(branch)).toBe(100);
  });

  test("con plan Pro al día no aparece ese aviso", async ({ page }) => {
    const { t } = await nuevoLocal("cfg-pro");
    await ingresar(page, t.owner, t);
    await expect(page.getByTestId("llamado-inactivo")).toHaveCount(0);
  });
});

test.describe("acceso", () => {
  test("sin sesión pasa por el login y vuelve a la misma pantalla", async ({ page }) => {
    const { t } = await nuevoLocal("cfg-sin-sesion");
    await page.goto(`/panel/${t.slug}/llamados`);
    await expect(page).toHaveURL(/\/login\?next=/);
    await login(page, t.owner.email, t.owner.password, `/panel/${t.slug}/llamados`);
    await expect(page).toHaveURL(new RegExp(`/panel/${t.slug}/llamados$`));
  });

  test("una persona de otro local recibe 404 y no ve nada del primero", async ({ page }) => {
    const { t } = await nuevoLocal("cfg-ajeno-a");
    const otro = await nuevoLocal("cfg-ajeno-b");
    await login(page, otro.t.owner.email, otro.t.owner.password);
    const respuesta = await page.goto(`/panel/${t.slug}/llamados`);
    expect(respuesta?.status()).toBe(404);
    await expect(page.getByText("Mesa 1")).toHaveCount(0);
  });
});

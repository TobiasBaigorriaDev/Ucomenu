import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createTenant, expectNoHorizontalOverflow, login, service, type Estado, type Person, type Tenant } from "./support";

/**
 * Alta guiada del dueño (ficha alta-guiada-del-dueno): la guía de primeros pasos del Resumen, a 390 px. El avance se
 * deduce de los datos reales; las pruebas siembran con la clave de servicio (no es lo que se prueba). Cada prueba usa un
 * local propio.
 */

const tenants: Tenant[] = [];

async function nuevoLocal(label: string, opciones: { estado?: Estado; plan?: "basic" | "pro" } = {}) {
  const t = await createTenant(label, opciones.estado ?? "active");
  tenants.push(t);
  if (opciones.plan === "pro") {
    const r = await service().from("subscriptions").update({ plan_code: "pro" }).eq("organization_id", t.orgId);
    if (r.error) throw new Error(r.error.message);
  }
  return t;
}

test.afterAll(async () => {
  for (const t of tenants) await t.cleanup();
});

async function sucursalDe(t: Tenant): Promise<string> {
  const { data } = await service().from("branches").select("id").eq("organization_id", t.orgId).single();
  return data!.id;
}

/** Una categoría con platos (`conFoto`: cuántos llevan foto) y, aparte, una categoría inactiva con un plato que no se ve. */
async function sembrarCarta(t: Tenant, opciones: { platos?: number; conFoto?: number } = {}) {
  const db = service();
  const cat = await db.from("categories").insert({ organization_id: t.orgId, name: "Entradas" }).select("id").single();
  if (cat.error) throw new Error(cat.error.message);
  const platos = opciones.platos ?? 2;
  // La base exige que la ruta de la foto sea `{org}/{plato}/{uuid}.ext`: se fija el id del plato de antemano.
  const filas = Array.from({ length: platos }, (_, i) => {
    const id = randomUUID();
    return {
      id,
      organization_id: t.orgId,
      category_id: cat.data.id,
      name: `Plato ${i + 1}`,
      price_cents: 100_000,
      sort_order: i,
      image_path: i < (opciones.conFoto ?? 0) ? `${t.orgId}/${id}/${randomUUID()}.webp` : null,
    };
  });
  if (filas.length > 0) {
    const r = await db.from("products").insert(filas);
    if (r.error) throw new Error(r.error.message);
  }
}

async function sembrarMesas(t: Tenant, cuantas: number, activa = true) {
  const branch = await sucursalDe(t);
  const filas = Array.from({ length: cuantas }, (_, i) => ({ organization_id: t.orgId, branch_id: branch, label: `Mesa ${i + 1}`, is_active: activa }));
  const r = await service().from("tables").insert(filas);
  if (r.error) throw new Error(r.error.message);
  return branch;
}

async function ingresar(page: Page, persona: Person, t: Tenant) {
  await login(page, persona.email, persona.password);
  await page.goto(`/panel/${t.slug}`);
}

const paso = (page: Page, id: string) => page.locator(`[data-testid="guia-paso"][data-step="${id}"]`);
const estados = (page: Page) => page.getByTestId("guia-paso").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-step")}:${e.getAttribute("data-status")}`));

test.describe("local recién dado de alta", () => {
  test("el Dueño ve los tres pasos, con su estado en texto, y llega a la carta desde el primero", async ({ page }) => {
    const t = await nuevoLocal("guia-nuevo");
    await ingresar(page, t.owner, t);

    await expect(page.getByRole("heading", { name: "Primeros pasos", exact: true })).toBeVisible();
    expect(await estados(page)).toEqual(["carta:todo", "mesas:todo", "qr:waiting"]);
    await expect(paso(page, "carta")).toContainText("Para hacer");
    await expect(paso(page, "qr")).toContainText("Después");
    await expect(paso(page, "qr").getByRole("link")).toHaveCount(0);
    await expect(page.getByTestId("guia-bloqueada")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    // Los botones son tocables: al menos 44 px de alto.
    for (const enlace of await page.getByTestId("guia-pasos").getByRole("link").all()) {
      expect((await enlace.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }

    await paso(page, "carta").getByRole("link", { name: "Crear la primera categoría" }).click();
    await expect(page).toHaveURL(new RegExp(`/panel/${t.slug}/carta$`));
  });

  test("avanza al cargar datos: carta, luego mesas, luego la guía queda completa", async ({ page }) => {
    const t = await nuevoLocal("guia-avance");
    await ingresar(page, t.owner, t);
    expect(await estados(page)).toEqual(["carta:todo", "mesas:todo", "qr:waiting"]);

    // Una categoría sola no alcanza: hacen falta platos que se vean.
    const cat = await service().from("categories").insert({ organization_id: t.orgId, name: "Postres" }).select("id").single();
    await page.reload();
    expect(await estados(page)).toEqual(["carta:todo", "mesas:todo", "qr:waiting"]);
    await expect(paso(page, "carta")).toContainText("1 categoría");
    await service().from("categories").delete().eq("id", cat.data!.id);

    await sembrarCarta(t, { platos: 3 });
    await page.reload();
    expect(await estados(page)).toEqual(["carta:done", "mesas:todo", "qr:waiting"]);
    await expect(paso(page, "carta")).toContainText("Listo");
    await expect(paso(page, "carta")).toContainText("3 platos se ven en tu carta");

    // Mesas todas inactivas: tampoco cuentan.
    const branch = await sembrarMesas(t, 1, false);
    await page.reload();
    expect(await estados(page)).toEqual(["carta:done", "mesas:todo", "qr:waiting"]);
    await expect(paso(page, "mesas")).toContainText("inactivas");
    await service().from("tables").update({ is_active: true }).eq("organization_id", t.orgId);
    await page.reload();
    // Con platos visibles y mesas activas la guía se resume.
    await expect(page.getByTestId("guia-lista")).toBeVisible();
    await expect(page.getByTestId("guia-paso")).toHaveCount(0);
    await expect(page.getByTestId("guia-lista")).toContainText("3 platos en la carta y 1 mesa activa con su QR");

    // El atajo lleva a la hoja de QR de la sucursal.
    await page.getByTestId("guia-lista").getByRole("link", { name: "Imprimir los QR" }).click();
    await expect(page).toHaveURL(new RegExp(`/panel/${t.slug}/mesas/imprimir/${branch}$`));
  });

  test("un plato inactivo o en una categoría inactiva no cuenta como carta cargada", async ({ page }) => {
    const t = await nuevoLocal("guia-ocultos");
    const db = service();
    const cat = await db.from("categories").insert({ organization_id: t.orgId, name: "Oculta", is_active: false }).select("id").single();
    await db.from("products").insert({ organization_id: t.orgId, category_id: cat.data!.id, name: "No se ve", price_cents: 1000 });
    const visible = await db.from("categories").insert({ organization_id: t.orgId, name: "Visible" }).select("id").single();
    await db.from("products").insert({ organization_id: t.orgId, category_id: visible.data!.id, name: "Apagado", price_cents: 1000, is_active: false });
    await ingresar(page, t.owner, t);
    expect(await estados(page)).toEqual(["carta:todo", "mesas:todo", "qr:waiting"]);
  });
});

test.describe("local completo", () => {
  test("se resume, sugiere fotos y no ofrece la sala con plan Básico", async ({ page }) => {
    const t = await nuevoLocal("guia-completo");
    await sembrarCarta(t, { platos: 4, conFoto: 3 });
    await sembrarMesas(t, 2);
    await ingresar(page, t.owner, t);

    const lista = page.getByTestId("guia-lista");
    await expect(lista).toContainText("Tu local está listo: 4 platos en la carta y 2 mesas activas con su QR");
    await expect(page.getByTestId("guia-sugerencia")).toContainText("1 plato sin foto");
    await expect(lista.getByRole("link", { name: /Sala en vivo/ })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test("con todas las fotos no hay sugerencia, y con plan Pro aparece la sala", async ({ page }) => {
    const t = await nuevoLocal("guia-completo-pro", { plan: "pro" });
    await sembrarCarta(t, { platos: 2, conFoto: 2 });
    await sembrarMesas(t, 1);
    await ingresar(page, t.owner, t);

    await expect(page.getByTestId("guia-lista")).toBeVisible();
    await expect(page.getByTestId("guia-sugerencia")).toHaveCount(0);
    await expect(page.getByTestId("guia-lista").getByRole("link", { name: "Atender llamados en Sala en vivo" })).toBeVisible();
  });
});

test.describe("rol y estado de la cuenta", () => {
  test("el Staff ve la misma guía que el Dueño pero sin el uso del plan", async ({ page }) => {
    const t = await nuevoLocal("guia-staff");
    await ingresar(page, t.staff, t);
    expect(await estados(page)).toEqual(["carta:todo", "mesas:todo", "qr:waiting"]);
    await expect(page.getByText("Uso del plan")).toHaveCount(0);
    await expect(page.getByTestId("guia-pasos").getByText(/plan|Suscripción/)).toHaveCount(0);
    await paso(page, "mesas").getByRole("link", { name: "Agregar la primera mesa" }).click();
    await expect(page).toHaveURL(new RegExp(`/panel/${t.slug}/mesas$`));
  });

  for (const [estado, texto] of [
    ["read_only", "solo lectura"],
    ["suspended", "suspendida"],
  ] as const) {
    test(`con la cuenta ${estado === "read_only" ? "en solo lectura" : "suspendida"} la guía no ofrece cargar nada y lo explica`, async ({ page }) => {
      const t = await nuevoLocal(`guia-${estado === "read_only" ? "ro" : "susp"}`, { estado });
      await ingresar(page, t.owner, t);

      expect(await estados(page)).toEqual(["carta:paused", "mesas:paused", "qr:waiting"]);
      await expect(paso(page, "carta")).toContainText("En pausa");
      await expect(page.getByTestId("guia-pasos").getByRole("link")).toHaveCount(0);
      await expect(page.getByTestId("guia-bloqueada")).toContainText(texto);
      await expect(page.getByTestId("guia-bloqueada")).toContainText("Suscripción");
      await expectNoHorizontalOverflow(page);
    });
  }

  test("el Staff con la cuenta en solo lectura recibe el aviso operativo, sin pagos", async ({ page }) => {
    const t = await nuevoLocal("guia-staff-ro", { estado: "read_only" });
    await ingresar(page, t.staff, t);
    const aviso = page.getByTestId("guia-bloqueada");
    await expect(aviso).toContainText("Avisale al dueño");
    await expect(aviso).not.toContainText("Suscripción");
    await expect(page.getByTestId("guia-pasos").getByRole("link")).toHaveCount(0);
  });

  test("en solo lectura con mesas activas se puede igualmente imprimir los QR", async ({ page }) => {
    const t = await nuevoLocal("guia-ro-qr", { estado: "read_only" });
    const branch = await sembrarMesas(t, 2);
    await ingresar(page, t.owner, t);
    expect(await estados(page)).toEqual(["carta:paused", "mesas:done", "qr:todo"]);
    await paso(page, "qr").getByRole("link", { name: "Imprimir los QR" }).click();
    await expect(page).toHaveURL(new RegExp(`/mesas/imprimir/${branch}$`));
  });
});

test.describe("aislamiento entre locales", () => {
  test("quien pertenece a dos locales ve en cada guía solo los datos de ese local", async ({ page }) => {
    const vacio = await nuevoLocal("guia-aislado-a");
    const lleno = await nuevoLocal("guia-aislado-b");
    await sembrarCarta(lleno, { platos: 3 });
    await sembrarMesas(lleno, 2);
    // El Dueño del local vacío también es Staff del lleno: RLS le deja leer ambos, la guía no puede mezclarlos.
    const m = await service().from("memberships").insert({ user_id: vacio.owner.id, organization_id: lleno.orgId, role: "staff" });
    if (m.error) throw new Error(m.error.message);

    await login(page, vacio.owner.email, vacio.owner.password);
    await page.goto(`/panel/${vacio.slug}`);
    expect(await estados(page)).toEqual(["carta:todo", "mesas:todo", "qr:waiting"]);
    await expect(page.getByTestId("guia-lista")).toHaveCount(0);

    await page.goto(`/panel/${lleno.slug}`);
    await expect(page.getByTestId("guia-lista")).toContainText("3 platos en la carta y 2 mesas activas");
  });
});

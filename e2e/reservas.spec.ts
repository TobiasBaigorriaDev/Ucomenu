import { expect, test, type Page } from "@playwright/test";
import { createPerson, createTenant, expectNoHorizontalOverflow, login, service, type Tenant } from "./support";

/**
 * Reservas de mesa, fase 1 (nivel C; ficha reservas-de-mesa, ADR 0051) contra el build y el Supabase local, a 390 px: el personal carga
 * una reserva a mano, le asigna una mesa libre, ve que una mesa ocupada no se ofrece, la cancela, y el Resumen avisa de las que esperan.
 * Un local Básico ve que la función viene con Pro.
 */

const tenants: Tenant[] = [];

test.afterAll(async () => {
  for (const t of tenants) await t.cleanup();
});

/** Fecha de mañana en Buenos Aires (la zona de la sucursal por defecto), `YYYY-MM-DD`. */
function manana(): string {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date()).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

async function nuevoLocal(label: string, plan: "basic" | "pro" = "pro") {
  const t = await createTenant(label);
  tenants.push(t);
  const db = service();
  await db.from("subscriptions").update({ plan_code: plan }).eq("organization_id", t.orgId);
  const branch = (await db.from("branches").select("id").eq("organization_id", t.orgId).single()).data!.id as string;
  const mesas = await db.from("tables").insert(["Mesa 1", "Mesa 2"].map((l) => ({ organization_id: t.orgId, branch_id: branch, label: l })));
  expect(mesas.error).toBeNull();
  return t;
}

async function cargar(page: Page, datos: { nombre: string; telefono: string; personas?: number; hora?: string; nota?: string }) {
  const nueva = page.getByTestId("reservas-nueva");
  if (!(await nueva.evaluate((el) => (el as HTMLDetailsElement).open))) await nueva.locator("summary").click();
  await page.getByLabel("Nombre", { exact: true }).fill(datos.nombre);
  await page.getByLabel("Teléfono").fill(datos.telefono);
  await page.getByLabel("Personas").fill(String(datos.personas ?? 4));
  await page.getByLabel("Fecha").fill(manana());
  await page.getByLabel("Hora").fill(datos.hora ?? "21:00");
  if (datos.nota) await page.getByLabel("Nota (opcional)").fill(datos.nota);
  await page.getByTestId("reservas-crear").click();
}

const tarjeta = (page: Page, nombre: string) => page.getByTestId("reserva").filter({ hasText: nombre });

test.describe("Reservas en la Sala", () => {
  test("el Staff carga una reserva, le asigna una mesa libre, no ve la ocupada y puede cancelar; cabe en 390 px", async ({ browser }) => {
    const t = await nuevoLocal("res-flujo");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    // Sin desplazamiento suave (`html { scroll-behavior: smooth }`): la página es larga y Playwright mide los botones mientras aún se desplaza.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await login(page, t.staff.email, t.staff.password);
    await page.goto(`/sala/${t.slug}/reservas?dia=${manana()}`);
    await expect(page.getByRole("heading", { name: "Reservas", exact: true })).toBeVisible();
    await expect(page.getByTestId("reservas-vacio")).toBeVisible();

    await cargar(page, { nombre: "Ana Pérez", telefono: "+54 11 5555-1234", personas: 4, nota: "Cumpleaños" });
    await expect(page.getByTestId("reservas-ok")).toHaveText("Reserva cargada.");
    const ana = tarjeta(page, "Ana Pérez");
    await expect(ana.getByTestId("reserva-estado")).toHaveText("Por confirmar");
    await expect(ana.getByTestId("reserva-hora")).toHaveText("21:00");
    await expect(ana.getByTestId("reserva-personas")).toHaveText("4 personas");
    await expect(ana.getByTestId("reserva-telefono")).toHaveAttribute("href", "tel:+541155551234");
    await expect(ana.getByTestId("reserva-nota")).toHaveText("Cumpleaños");
    await expect(ana.getByTestId("reserva-mesa")).toContainText("Sin mesa asignada");

    // Se confirma asignándole la Mesa 1.
    await ana.getByLabel("Mesa", { exact: true }).selectOption({ label: "Mesa 1" });
    await ana.getByRole("button", { name: "Confirmar con esta mesa" }).click();
    await expect(page.getByTestId("reservas-ok")).toContainText("quedó confirmada");
    await expect(tarjeta(page, "Ana Pérez").getByTestId("reserva-estado")).toHaveText("Confirmada");
    await expect(tarjeta(page, "Ana Pérez").getByTestId("reserva-mesa")).toContainText("Mesa 1");

    // Otra reserva a la misma hora: la Mesa 1 ya no se ofrece, la 2 sí.
    await cargar(page, { nombre: "Beto Gómez", telefono: "11 4444 9999", personas: 2 });
    const beto = tarjeta(page, "Beto Gómez");
    await expect(beto.getByRole("option", { name: "Mesa 1" })).toHaveCount(0);
    await expect(beto.getByRole("option", { name: "Mesa 2" })).toHaveCount(1);
    await beto.getByLabel("Mesa", { exact: true }).selectOption({ label: "Mesa 2" });
    await beto.getByRole("button", { name: "Confirmar con esta mesa" }).click();
    await expect(tarjeta(page, "Beto Gómez").getByTestId("reserva-estado")).toHaveText("Confirmada");

    // Cancelar pide confirmar; la reserva queda cancelada y su mesa, libre para otra.
    await tarjeta(page, "Ana Pérez").getByTestId("reserva-cancelar-abrir").click();
    await tarjeta(page, "Ana Pérez").getByTestId("reserva-cancelar").click();
    await expect(page.getByTestId("reservas-ok")).toHaveText("Reserva cancelada.");
    await expect(tarjeta(page, "Ana Pérez").getByTestId("reserva-estado")).toHaveText("Cancelada");
    await expect(tarjeta(page, "Ana Pérez").getByRole("button", { name: /Confirmar|Cambiar/ })).toHaveCount(0);

    await cargar(page, { nombre: "Carla Díaz", telefono: "11 3333 8888", personas: 3 });
    await expect(tarjeta(page, "Carla Díaz").getByRole("option", { name: "Mesa 1" })).toHaveCount(1);

    // Lo cancelado va al final de la lista del día.
    const nombres = await page.getByTestId("reserva-nombre").allTextContents();
    expect(nombres[nombres.length - 1]).toBe("Ana Pérez");
    await expectNoHorizontalOverflow(page);
    await context.close();
  });

  test("un dato inválido se explica y no crea nada; otro día no muestra las reservas de este", async ({ page }) => {
    const t = await nuevoLocal("res-invalido");
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/sala/${t.slug}/reservas?dia=${manana()}`);
    await cargar(page, { nombre: "Dani", telefono: "12 34" });
    await expect(page.getByTestId("reservas-error")).toContainText("teléfono no es válido");
    await expect(page.getByTestId("reserva")).toHaveCount(0);

    await cargar(page, { nombre: "Dani", telefono: "11 2222 7777" });
    await expect(tarjeta(page, "Dani")).toHaveCount(1);
    await page.goto(`/sala/${t.slug}/reservas`);
    await expect(page.getByTestId("reservas-vacio")).toBeVisible(); // hoy: nada (la reserva es de mañana)
  });

  test("el Resumen avisa de las reservas por confirmar con un enlace a la pantalla", async ({ page }) => {
    const t = await nuevoLocal("res-resumen");
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/panel/${t.slug}`);
    await expect(page.locator('[data-item="reservas"]')).toHaveCount(0);
    await page.goto(`/sala/${t.slug}/reservas?dia=${manana()}`);
    await cargar(page, { nombre: "Elena", telefono: "11 1111 6666" });
    await expect(tarjeta(page, "Elena")).toHaveCount(1);
    await page.goto(`/panel/${t.slug}`);
    const item = page.locator('[data-item="reservas"]');
    await expect(item).toContainText("1 reserva espera");
    await expect(item.getByRole("link")).toHaveAttribute("href", `/sala/${t.slug}/reservas`);
  });

  test("un local Básico ve que las reservas vienen con Pro y no puede cargar ninguna", async ({ page }) => {
    const t = await nuevoLocal("res-basico", "basic");
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/sala/${t.slug}/reservas`);
    await expect(page.getByTestId("reservas-no-incluida")).toContainText("desde el plan Pro");
    await expect(page.getByTestId("reservas-nueva")).toHaveCount(0);
    await page.goto(`/panel/${t.slug}`);
    await expect(page.locator('[data-item="reservas"]')).toHaveCount(0);
  });

  test("el cocinero no entra a las reservas y quien no tiene sesión va al login", async ({ browser }) => {
    const t = await nuevoLocal("res-cocina");
    const anon = await browser.newPage();
    await anon.goto(`/sala/${t.slug}/reservas`);
    await expect(anon).toHaveURL(/\/login/);
    await anon.close();

    const cocinero = await createPerson("res-cook", t.orgId, "cook");
    try {
      const page = await browser.newPage();
      await login(page, cocinero.email, cocinero.password);
      await page.goto(`/sala/${t.slug}/reservas`);
      await expect(page).toHaveURL(new RegExp(`/cocina/${t.slug}`));
      await expect(page.getByTestId("reservas-nueva")).toHaveCount(0);
      await page.close();
    } finally {
      await service().auth.admin.deleteUser(cocinero.id);
    }
  });
});

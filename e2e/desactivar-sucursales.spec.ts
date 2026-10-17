import { expect, test, type Page } from "@playwright/test";
import { createTenant, expectNoHorizontalOverflow, login, service, type Estado, type Tenant } from "./support";

/**
 * Desactivar y reactivar sucursales (ficha desactivar-sucursales): `/panel/{slug}/sucursales` contra el build y el
 * Supabase local, a 390 px. Cada prueba usa un local propio (`createTenant` deja una sucursal «Centro»), con una mesa.
 */

const tenants: Tenant[] = [];

async function nuevoLocal(label: string, opciones: { estado?: Estado; plan?: "basic" | "pro" | "premium" } = {}) {
  const t = await createTenant(label, opciones.estado ?? "active");
  tenants.push(t);
  const db = service();
  const plan = await db.from("subscriptions").update({ plan_code: opciones.plan ?? "pro" }).eq("organization_id", t.orgId);
  if (plan.error) throw plan.error;
  const branch = await db.from("branches").select("id").eq("organization_id", t.orgId).eq("slug", "centro").single();
  if (branch.error) throw branch.error;
  const table = await db.from("tables").insert({ organization_id: t.orgId, branch_id: branch.data.id, label: "Mesa 1" }).select("qr_token").single();
  if (table.error) throw table.error;
  return { t, branch: branch.data.id, token: table.data.qr_token };
}

test.afterAll(async () => {
  for (const t of tenants) await t.cleanup();
});

const sucursal = (page: Page, nombre: string) => page.locator(`[data-testid="sucursal"][data-name="${nombre}"]`);

async function agregarSegunda(t: Tenant) {
  const r = await service().from("branches").insert({ organization_id: t.orgId, slug: "norte", name: "Norte" });
  if (r.error) throw r.error;
}

test.describe("el Dueño desactiva y reactiva", () => {
  test("desactiva con aviso: la carta y el QR dicen «no disponible», el tope baja, y reactivar lo deja como estaba", async ({ page }) => {
    const { t, token } = await nuevoLocal("des-flujo");
    await agregarSegunda(t);
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/panel/${t.slug}/sucursales`);
    await expect(page.getByTestId("sucursales-uso")).toContainText("2 de 2");
    await expectNoHorizontalOverflow(page);

    const centro = sucursal(page, "Centro");
    await centro.getByText("Desactivar", { exact: true }).click();
    await expect(centro.getByTestId("aviso-desactivar")).toContainText("dirán «no disponible»");
    await expect(centro.getByTestId("aviso-desactivar")).not.toContainText("única sucursal activa");
    await centro.getByRole("button", { name: "Sí, desactivar Centro" }).click();

    await expect(centro.getByRole("status")).toContainText("Sucursal desactivada");
    await expect(centro.getByTestId("sucursal-desactivada")).toBeVisible();
    await expect(centro.getByRole("link", { name: /Ver la carta/ })).toHaveCount(0);
    await expect(page.getByTestId("sucursales-uso")).toContainText("1 de 2");
    await expect(centro.getByRole("button", { name: "Reactivar" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expect(page.getByTestId("aviso-tope")).toHaveCount(0); // ya hay cupo: el alta vuelve a ofrecerse
    await expect(page.getByRole("button", { name: "Crear sucursal" })).toBeVisible();

    // La carta directa y el QR de la mesa: «no disponible», sin 404 y sin datos de la carta.
    const directa = await page.goto(`/m/${t.slug}/centro`);
    expect(directa?.status()).toBe(200);
    await expect(page.getByTestId("carta-no-disponible")).toContainText("Esta sucursal no está disponible");
    await expect(page.getByRole("heading", { level: 3 })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await page.goto(`/t/${token}`);
    await expect(page.getByTestId("carta-no-disponible")).toContainText("Esta sucursal no está disponible");
    await expect(page.getByRole("button", { name: /mozo|cuenta/i })).toHaveCount(0);
    // La otra sucursal no cambia.
    const norte = await page.goto(`/m/${t.slug}/norte`);
    expect(norte?.status()).toBe(200);
    await expect(page.getByTestId("carta-no-disponible")).toHaveCount(0);

    // Reactivar: vuelve la carta y el mismo QR.
    await page.goto(`/panel/${t.slug}/sucursales`);
    await sucursal(page, "Centro").getByRole("button", { name: "Reactivar" }).click();
    await expect(sucursal(page, "Centro").getByRole("status")).toContainText("Sucursal reactivada");
    await expect(page.getByTestId("sucursales-uso")).toContainText("2 de 2");
    const reabierta = await page.goto(`/m/${t.slug}/centro`);
    expect(reabierta?.status()).toBe(200);
    await expect(page.getByTestId("carta-no-disponible")).toHaveCount(0);
    await page.goto(`/t/${token}`);
    await expect(page.getByTestId("carta-no-disponible")).toHaveCount(0);
    await expect(page.getByText("Mesa 1", { exact: true })).toBeVisible();
  });

  test("la última sucursal activa se puede desactivar, con el aviso de que el local queda sin carta; el Resumen lo dice", async ({ page }) => {
    const { t } = await nuevoLocal("des-ultima");
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/panel/${t.slug}/sucursales`);

    const centro = sucursal(page, "Centro");
    await centro.getByText("Desactivar", { exact: true }).click();
    await expect(centro.getByTestId("aviso-desactivar")).toContainText("única sucursal activa");
    await expect(centro.getByTestId("aviso-desactivar")).toContainText("sin carta pública");
    await centro.getByRole("button", { name: "Sí, desactivar Centro" }).click();
    await expect(centro.getByRole("status")).toContainText("Sucursal desactivada");

    await page.goto(`/panel/${t.slug}`);
    await expect(page.getByTestId("resumen-sin-sucursales-activas")).toContainText("Todas las sucursales están desactivadas");
    await expect(page.getByRole("link", { name: "Reactivar una sucursal" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Ver la carta" })).toHaveCount(0);
  });

  test("Básico (1): con otra sucursal activa, reactivar se rechaza con el motivo y no cambia nada", async ({ page }) => {
    const { t, branch } = await nuevoLocal("des-tope", { plan: "basic" });
    const db = service();
    // Centro queda inactiva (cargada por el servidor) y se crea «Norte», que ocupa el único cupo.
    await db.from("branches").update({ is_active: false }).eq("id", branch);
    await agregarSegunda(t);

    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/panel/${t.slug}/sucursales`);
    await expect(page.getByTestId("sucursales-uso")).toContainText("1 de 1");
    await sucursal(page, "Centro").getByRole("button", { name: "Reactivar" }).click();
    await expect(page.locator("form").getByRole("alert")).toContainText("Tu plan incluye 1 sucursal activa y ya las usás");
    await expect(page.locator("form").getByRole("alert")).toContainText("No se reactivó");
    const centro = await db.from("branches").select("is_active").eq("id", branch).single();
    expect(centro.data?.is_active).toBe(false);
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("quién y cuándo", () => {
  test("el Personal no administra sucursales: la URL lo devuelve al panel", async ({ page }) => {
    const { t } = await nuevoLocal("des-staff");
    await login(page, t.staff.email, t.staff.password);
    await page.goto(`/panel/${t.slug}/sucursales`);
    await expect(page).not.toHaveURL(/\/sucursales/);
    await expect(page.getByRole("button", { name: /Desactivar|Reactivar/ })).toHaveCount(0);
  });

  test("con la cuenta en solo lectura se ven las sucursales, pero desactivar y reactivar están deshabilitados", async ({ page }) => {
    const { t, branch } = await nuevoLocal("des-lectura", { estado: "read_only" });
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/panel/${t.slug}/sucursales`);
    await expect(page.getByTestId("sucursales-bloqueadas")).toContainText("solo lectura");
    const centro = sucursal(page, "Centro");
    await centro.getByText("Desactivar", { exact: true }).click();
    await expect(centro.getByRole("button", { name: "Sí, desactivar Centro" })).toBeDisabled();
    const fila = await service().from("branches").select("is_active").eq("id", branch).single();
    expect(fila.data?.is_active).toBe(true);
  });

  test("Mesas y Llamados del panel muestran solo las sucursales activas", async ({ page }) => {
    const { t, branch } = await nuevoLocal("des-paneles");
    await agregarSegunda(t);
    await service().from("branches").update({ is_active: false }).eq("id", branch);
    await login(page, t.owner.email, t.owner.password);

    await page.goto(`/panel/${t.slug}/mesas`);
    await expect(page.getByText("Norte", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Centro", { exact: true })).toHaveCount(0);
    await page.goto(`/panel/${t.slug}/llamados`);
    await expect(page.getByText("Centro", { exact: true })).toHaveCount(0);
  });
});

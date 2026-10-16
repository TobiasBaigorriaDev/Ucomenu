import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { sql } from "../tests/rls/helpers";
import {
  createTenant,
  expectNoHorizontalOverflow,
  login,
  service,
  type Estado,
  type Person,
  type Tenant,
} from "./support";

/**
 * Pantalla del historial de precios (ficha pantalla-historial-de-precios): del local y de un plato, con la
 * identificación de la persona según el rol, tolerancia a platos eliminados, paginación y aislamiento entre locales.
 * Cada prueba trabaja sobre locales propios; los cambios de precio los hacen sesiones reales (el trigger toma
 * `auth.uid()`), y los técnicos, la clave de servicio.
 */

const tenants: Tenant[] = [];

async function nuevoLocal(label: string, estado: Estado = "active") {
  const t = await createTenant(label, estado);
  tenants.push(t);
  return t;
}

test.afterAll(async () => {
  for (const t of tenants) await t.cleanup();
});

/** Cliente con la sesión de la persona (rol `authenticated`, RLS), como el que usa la aplicación. */
async function sesion(person: Person) {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await db.auth.signInWithPassword({ email: person.email, password: person.password });
  if (error) throw new Error(`No se pudo iniciar sesión de prueba: ${error.message}`);
  return db;
}

async function nuevoPlato(t: Tenant, nombre: string, cents: number): Promise<string> {
  const db = service();
  let category = (await db.from("categories").select("id").eq("organization_id", t.orgId).limit(1).maybeSingle()).data?.id;
  if (!category) {
    const created = await db.from("categories").insert({ organization_id: t.orgId, name: "Platos" }).select("id").single();
    if (created.error) throw new Error(created.error.message);
    category = created.data.id;
  }
  const plato = await db
    .from("products")
    .insert({ organization_id: t.orgId, category_id: category, name: nombre, price_cents: cents })
    .select("id")
    .single();
  if (plato.error) throw new Error(plato.error.message);
  return plato.data.id;
}

async function cambiarPrecio(db: ReturnType<typeof service>, plato: string, cents: number) {
  const r = await db.from("products").update({ price_cents: cents }).eq("id", plato).select("id");
  if (r.error || r.data?.length !== 1) throw new Error(`No se pudo cambiar el precio: ${r.error?.message ?? "0 filas"}`);
}

const filas = (page: Page) => page.getByTestId("historial-fila");

test.describe("historial del local", () => {
  test("el Dueño ve a quién pertenece cada cambio; el Staff nunca ve emails", async ({ browser }) => {
    const t = await nuevoLocal("hist-roles");
    const plato = await nuevoPlato(t, "Milanesa", 100000);
    await cambiarPrecio(await sesion(t.owner), plato, 150000); // Dueño
    await cambiarPrecio(await sesion(t.staff), plato, 140000); // Staff
    await cambiarPrecio(service(), plato, 160000); // operación técnica (sin usuario)

    // Dueño
    const duenoCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "es-AR" });
    const dueno = await duenoCtx.newPage();
    await login(dueno, t.owner.email, t.owner.password, `/panel/${t.slug}/carta`);
    await dueno.getByTestId("ver-historial-precios").click();
    await expect(dueno).toHaveURL(`/panel/${t.slug}/historial-de-precios`);
    await expect(dueno.getByRole("heading", { name: "Historial de precios" })).toBeVisible();
    await expect(filas(dueno)).toHaveCount(3);
    // Más nuevo primero.
    await expect(filas(dueno).nth(0)).toContainText("Milanesa");
    await expect(filas(dueno).nth(0)).toContainText("$ 1.400 → $ 1.600");
    await expect(filas(dueno).nth(0)).toContainText("Sube $ 200");
    await expect(filas(dueno).nth(0)).toContainText("Operación técnica (sin usuario)");
    await expect(filas(dueno).nth(1)).toContainText("$ 1.500 → $ 1.400");
    await expect(filas(dueno).nth(1)).toContainText("Baja $ 100");
    await expect(filas(dueno).nth(1)).toContainText(`${t.staff.email} (Personal)`);
    await expect(filas(dueno).nth(2)).toContainText("$ 1.000 → $ 1.500");
    await expect(filas(dueno).nth(2).getByTestId("historial-autor")).toHaveText("Vos");
    await expectNoHorizontalOverflow(dueno);
    await duenoCtx.close();

    // Staff
    const staffCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "es-AR" });
    const staff = await staffCtx.newPage();
    await login(staff, t.staff.email, t.staff.password, `/panel/${t.slug}/historial-de-precios`);
    await expect(filas(staff)).toHaveCount(3);
    await expect(filas(staff).nth(0).getByTestId("historial-autor")).toHaveText("Operación técnica (sin usuario)");
    await expect(filas(staff).nth(1).getByTestId("historial-autor")).toHaveText("Vos");
    await expect(filas(staff).nth(2).getByTestId("historial-autor")).toHaveText("Otra persona del equipo");
    // Ni el email del Dueño ni ningún otro llega al HTML que recibe el Staff.
    const html = await staff.content();
    expect(html).not.toContain(t.owner.email);
    await staffCtx.close();
  });

  test("una persona dada de baja no se identifica y un plato eliminado se marca sin enlace", async ({ page }) => {
    const t = await nuevoLocal("hist-baja");
    const sinBaja = await nuevoPlato(t, "Flan", 50000);
    const borrado = await nuevoPlato(t, "Plato efímero", 80000);
    const exStaff = await service().auth.admin.createUser({
      email: `e2e-ex-${Math.random().toString(36).slice(2, 8)}@example.test`,
      password: "contrasena-de-prueba-123",
      email_confirm: true,
    });
    const ex: Person = { id: exStaff.data.user!.id, email: exStaff.data.user!.email!, password: "contrasena-de-prueba-123" };
    await service().from("memberships").insert({ user_id: ex.id, organization_id: t.orgId, role: "staff" });
    await cambiarPrecio(await sesion(ex), sinBaja, 55000);
    await cambiarPrecio(await sesion(ex), borrado, 90000);
    // Baja: se quita la membresía; la cuenta de Auth sigue existiendo (como una persona de otro local).
    await service().from("memberships").delete().eq("user_id", ex.id).eq("organization_id", t.orgId);
    await service().from("products").delete().eq("id", borrado);

    await login(page, t.owner.email, t.owner.password, `/panel/${t.slug}/historial-de-precios`);
    await expect(filas(page)).toHaveCount(2);
    const eliminado = filas(page).filter({ hasText: "$ 800 → $ 900" });
    await expect(eliminado.getByTestId("historial-plato")).toHaveText("Plato eliminado");
    await expect(eliminado.getByRole("link")).toHaveCount(0);
    for (const fila of await filas(page).all()) {
      await expect(fila.getByTestId("historial-autor")).toHaveText("Persona que ya no está en el local");
    }
    expect(await page.content()).not.toContain(ex.email);
    await service().auth.admin.deleteUser(ex.id);
  });

  test("sin cambios: mensaje de estado vacío; con cuenta suspendida la pantalla igual abre", async ({ page }) => {
    const vacio = await nuevoLocal("hist-vacio");
    await login(page, vacio.owner.email, vacio.owner.password, `/panel/${vacio.slug}/historial-de-precios`);
    await expect(page.getByTestId("historial-vacio")).toHaveText("Todavía no se cambió el precio de ningún plato.");

    const suspendido = await nuevoLocal("hist-susp", "suspended");
    const plato = await nuevoPlato(suspendido, "Café", 10000);
    await cambiarPrecio(service(), plato, 12000);
    await page.context().clearCookies();
    await login(page, suspendido.staff.email, suspendido.staff.password, `/panel/${suspendido.slug}/historial-de-precios`);
    await expect(filas(page)).toHaveCount(1);
  });

  test("más de 50 cambios: se pagina sin repetir ni saltear, y un cursor inválido muestra la primera página", async ({ page }) => {
    const t = await nuevoLocal("hist-pag");
    const plato = await nuevoPlato(t, "Pizza", 1000);
    sql(
      `insert into public.price_history (organization_id, product_id, changed_at, old_price_cents, new_price_cents)
       select '${t.orgId}', '${plato}', timestamptz '2026-01-01 12:00:00+00' + ((i / 2) * interval '1 second'), i + 1000, i + 1001
       from generate_series(0, 54) as i`,
    );
    await login(page, t.owner.email, t.owner.password, `/panel/${t.slug}/historial-de-precios`);
    await expect(filas(page)).toHaveCount(50);
    const primera = await filas(page).evaluateAll((els) => els.map((e) => e.textContent ?? ""));

    await page.getByTestId("historial-ver-mas").click();
    await expect(page).toHaveURL(/despues=/);
    await expect(filas(page)).toHaveCount(5);
    const segunda = await filas(page).evaluateAll((els) => els.map((e) => e.textContent ?? ""));
    expect(new Set([...primera, ...segunda]).size).toBe(55); // ni repetidas ni salteadas
    await expect(page.getByTestId("historial-ver-mas")).toHaveCount(0);

    await page.getByRole("link", { name: "Volver a lo más reciente" }).click();
    await expect(filas(page)).toHaveCount(50);

    await page.goto(`/panel/${t.slug}/historial-de-precios?despues=${encodeURIComponent("basura),id.gt.0|x")}`);
    await expect(filas(page)).toHaveCount(50);

    // Formato correcto pero instante imposible: la base lo rechazaría; el cursor se descarta y se ve la primera página.
    const imposible = `2026-02-30T10:00:00+00:00|00000000-0000-4000-8000-000000000000`;
    await page.goto(`/panel/${t.slug}/historial-de-precios?despues=${encodeURIComponent(imposible)}`);
    await expect(page.getByTestId("historial-error")).toHaveCount(0);
    await expect(filas(page)).toHaveCount(50);
  });

  test("emails y nombres de plato larguísimos no desbordan a 390 px", async ({ page }) => {
    const t = await nuevoLocal("hist-largo");
    const nombre = "Milanesaconpapasfritasyhuevofritoconensaladamixtaygaseosagrandeparacompartir".repeat(1);
    const plato = await nuevoPlato(t, nombre, 100000);
    const email = `e2e-${"largo".repeat(11)}-${Math.random().toString(36).slice(2, 8)}@${"dominio".repeat(8)}.example.test`;
    const creada = await service().auth.admin.createUser({ email, password: "contrasena-de-prueba-123", email_confirm: true });
    const largo: Person = { id: creada.data.user!.id, email, password: "contrasena-de-prueba-123" };
    await service().from("memberships").insert({ user_id: largo.id, organization_id: t.orgId, role: "staff" });
    await cambiarPrecio(await sesion(largo), plato, 123456789);

    await login(page, t.owner.email, t.owner.password, `/panel/${t.slug}/historial-de-precios`);
    await expect(filas(page)).toHaveCount(1);
    await expect(filas(page).getByTestId("historial-autor")).toContainText(email);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: "test-results/historial-largo-local.png", fullPage: true });
    await page.goto(`/panel/${t.slug}/carta/platos/${plato}/historial`);
    await expect(filas(page)).toHaveCount(1);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: "test-results/historial-largo-plato.png", fullPage: true });
    await service().auth.admin.deleteUser(largo.id);
  });
});

test.describe("historial de un plato", () => {
  test("muestra solo los cambios de ese plato y se llega desde su edición", async ({ page }) => {
    const t = await nuevoLocal("hist-plato");
    const uno = await nuevoPlato(t, "Ñoquis", 20000);
    const otro = await nuevoPlato(t, "Tarta", 30000);
    await cambiarPrecio(await sesion(t.owner), uno, 21000);
    await cambiarPrecio(await sesion(t.owner), otro, 33000);
    await cambiarPrecio(await sesion(t.staff), uno, 22000);

    await login(page, t.owner.email, t.owner.password, `/panel/${t.slug}/carta/platos/${uno}`);
    await page.getByTestId("ver-historial-plato").click();
    await expect(page).toHaveURL(`/panel/${t.slug}/carta/platos/${uno}/historial`);
    await expect(page.getByRole("heading", { name: "Ñoquis" })).toBeVisible();
    await expect(filas(page)).toHaveCount(2);
    await expect(filas(page).nth(0)).toContainText("$ 210 → $ 220");
    await expect(filas(page).nth(1)).toContainText("$ 200 → $ 210");
    await expect(page.getByText("Tarta")).toHaveCount(0);
    await page.getByRole("link", { name: "Volver al plato" }).click();
    await expect(page).toHaveURL(`/panel/${t.slug}/carta/platos/${uno}`);
  });

  test("el id de un plato de otro local, de uno eliminado o inexistente dan el mismo 404", async ({ page }) => {
    const a = await nuevoLocal("hist-404a");
    const b = await nuevoLocal("hist-404b");
    const ajeno = await nuevoPlato(b, "Plato ajeno", 1000); // activo: la carta pública lo hace legible para cualquiera
    await cambiarPrecio(service(), ajeno, 2000);
    const borrado = await nuevoPlato(a, "Plato borrado", 1000);
    await cambiarPrecio(service(), borrado, 2000);
    await service().from("products").delete().eq("id", borrado);

    await login(page, a.owner.email, a.owner.password, `/panel/${a.slug}/carta`);
    const respuestas: number[] = [];
    for (const id of [ajeno, borrado, "00000000-0000-4000-8000-000000000000", "no-es-un-uuid"]) {
      const r = await page.goto(`/panel/${a.slug}/carta/platos/${id}/historial`);
      respuestas.push(r?.status() ?? 0);
      await expect(page.getByText("Plato ajeno")).toHaveCount(0);
      await expect(page.getByTestId("historial-fila")).toHaveCount(0);
    }
    expect(respuestas).toEqual([404, 404, 404, 404]);
  });
});

test.describe("acceso", () => {
  test("sin sesión vuelve al login con la ruta; otro local y sin membresía reciben 404", async ({ page }) => {
    const a = await nuevoLocal("hist-acc-a");
    const b = await nuevoLocal("hist-acc-b");
    const plato = await nuevoPlato(a, "Secreto", 1000);
    await cambiarPrecio(service(), plato, 2000);

    await page.goto(`/panel/${a.slug}/historial-de-precios`);
    await expect(page).toHaveURL(/\/login\?next=/);
    expect(new URL(page.url()).searchParams.get("next")).toBe(`/panel/${a.slug}/historial-de-precios`);

    await login(page, b.owner.email, b.owner.password, "/panel");
    for (const ruta of [`/panel/${a.slug}/historial-de-precios`, `/panel/${a.slug}/carta/platos/${plato}/historial`]) {
      const r = await page.goto(ruta);
      expect(r?.status()).toBe(404);
      await expect(page.getByText("Secreto")).toHaveCount(0);
    }
  });
});

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { createPerson, createTenant, expectNoHorizontalOverflow, login, service, type Person, type Tenant } from "./support";
import { sql } from "../tests/rls/helpers"; // después de ./support: carga las variables de entorno

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
  const mesas = await db.from("tables").insert(["Mesa 1", "Mesa 2"].map((l) => ({ organization_id: t.orgId, branch_id: branch, label: l }))).select("id, label").order("label");
  expect(mesas.error).toBeNull();
  return Object.assign(t, { branch, mesaIds: mesas.data!.map((m) => m.id as string) });
}

/** Carga una reserva con la sesión de la persona (la única puerta de escritura es la función de la base). */
async function reservarComo(persona: Person, branch: string, dia: string, hora: string, extra: { mesa?: string; nombre?: string } = {}) {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const sesion = await db.auth.signInWithPassword({ email: persona.email, password: persona.password });
  expect(sesion.error).toBeNull();
  const r = await db.rpc("create_reservation", {
    p_branch: branch,
    p_name: extra.nombre ?? "Reserva de prueba",
    p_phone: "11 5555 0000",
    p_email: null as unknown as string,
    p_party: 2,
    p_date: dia,
    p_time: hora,
    p_duration: 90,
    p_notes: null as unknown as string,
    p_table: (extra.mesa ?? null) as unknown as string,
    p_client_key: randomUUID(),
  });
  expect(r.error).toBeNull();
}

/** `YYYY-MM-DD` de hoy más `dias` (el calendario de Buenos Aires). */
function enDias(dias: number): string {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date()).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
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
    // La duración ya no se elige ni se muestra (decisión del usuario): ni campo en el formulario ni «hasta las» en la tarjeta.
    await expect(page.getByLabel("Duración")).toHaveCount(0);
    await expect(ana).not.toContainText("hasta las");

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
    await expect(item.getByRole("link")).toHaveAttribute("href", `/sala/${t.slug}/reservas?ver=proximas`);
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

  test("«Próximas» junta las reservas de todos los días por venir, agrupadas por día, y se puede trabajar desde ahí", async ({ page }) => {
    const t = await nuevoLocal("res-proximas");
    await reservarComo(t.owner, t.branch, enDias(3), "20:00", { nombre: "Dentro de tres" });
    await reservarComo(t.owner, t.branch, enDias(1), "21:00", { nombre: "Mañana A" });
    await reservarComo(t.owner, t.branch, enDias(1), "22:00", { nombre: "Mañana B", mesa: t.mesaIds[0] });
    await reservarComo(t.owner, t.branch, enDias(40), "13:00", { nombre: "Lejana" });
    await reservarComo(t.owner, t.branch, enDias(2), "19:00", { nombre: "Se cancela" });
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/sala/${t.slug}/reservas?dia=${enDias(2)}`);
    await tarjeta(page, "Se cancela").getByTestId("reserva-cancelar-abrir").click();
    await tarjeta(page, "Se cancela").getByTestId("reserva-cancelar").click();
    await expect(page.getByTestId("reservas-ok")).toHaveText("Reserva cancelada.");

    await page.getByTestId("reservas-vista-proximas").click();
    await expect(page).toHaveURL(/ver=proximas/);
    await expect(page.getByTestId("reservas-titulo-dia")).toHaveText("Próximas reservas");
    await expect(page.getByTestId("reservas-dias")).toHaveCount(0); // sin navegación de día
    // Están las de varios días, en orden y agrupadas; la cancelada no.
    await expect(page.getByTestId("reservas-grupo")).toHaveCount(3);
    await expect(page.getByTestId("reservas-grupo").nth(0)).toHaveAttribute("data-dia", enDias(1));
    await expect(page.getByTestId("reservas-grupo").nth(0).getByTestId("reserva")).toHaveCount(2);
    await expect(page.getByTestId("reservas-grupo").nth(1)).toHaveAttribute("data-dia", enDias(3));
    await expect(page.getByTestId("reservas-grupo").nth(2)).toHaveAttribute("data-dia", enDias(40));
    await expect(page.getByTestId("reserva-nombre")).toHaveText(["Mañana A", "Mañana B", "Dentro de tres", "Lejana"]);
    await expect(page.getByTestId("reservas-resumen")).toContainText("4 reservas");

    // Se asigna una mesa desde esta vista (la Mesa 1 está ocupada por «Mañana B» a esa hora, pero no a las 20:00 de otro día) y se vuelve a ella.
    const manana = tarjeta(page, "Mañana A");
    await expect(manana.getByRole("option", { name: "Mesa 1" })).toHaveCount(0);
    await manana.getByLabel("Mesa", { exact: true }).selectOption({ label: "Mesa 2" });
    await manana.getByRole("button", { name: "Confirmar con esta mesa" }).click();
    await expect(page).toHaveURL(/ver=proximas/);
    await expect(tarjeta(page, "Mañana A").getByTestId("reserva-estado")).toHaveText("Confirmada");
    await expect(page.getByTestId("reservas-titulo-dia")).toHaveText("Próximas reservas");

    // La que se carga desde esta vista también deja en ella.
    await cargar(page, { nombre: "Nueva desde próximas", telefono: "11 6666 1111" });
    await expect(page).toHaveURL(/ver=proximas/);
    await expect(tarjeta(page, "Nueva desde próximas")).toHaveCount(1);

    // Volver a «Por día» muestra el día de hoy.
    await page.getByTestId("reservas-vista-dia").click();
    await expect(page.getByTestId("reservas-dias")).toBeVisible();
  });

  test("«Próximas» no lista lo que ya terminó ni mezcla otra sucursal; sin reservas lo dice", async ({ page }) => {
    const t = await nuevoLocal("res-proximas-vacio");
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/sala/${t.slug}/reservas?ver=proximas`);
    await expect(page.getByTestId("reservas-vacio")).toHaveText("No hay reservas próximas.");
    await expect(page.getByTestId("reservas-resumen")).toHaveText("No hay reservas próximas.");

    const norte = await service().from("branches").insert({ organization_id: t.orgId, slug: "norte", name: "Norte" }).select("id").single();
    expect(norte.error).toBeNull();
    await reservarComo(t.owner, norte.data!.id as string, enDias(1), "21:00", { nombre: "Solo en Norte" });
    sql(
      `insert into public.reservations (organization_id, branch_id, status, guest_name, guest_phone, party_size, starts_at, ends_at, client_key, request_hash) ` +
        `values ('${t.orgId}', '${t.branch}', 'requested', 'Ya pasó', '123456', 2, now() - interval '5 hours', now() - interval '3 hours', gen_random_uuid(), 'x')`,
    );
    await page.goto(`/sala/${t.slug}/reservas?ver=proximas`);
    await expect(page.getByTestId("reservas-vacio")).toBeVisible(); // Centro: la de Norte no cuenta y la que ya terminó tampoco
    await page.getByTestId("reservas-sucursales").getByRole("link", { name: "Norte" }).click();
    await expect(page).toHaveURL(/ver=proximas/);
    await expect(tarjeta(page, "Solo en Norte")).toHaveCount(1);
  });

  // Regresiones de la revisión independiente de Codex (ronda 1).
  test("con la cuenta en solo lectura se ven las reservas ya cargadas, sin formularios ni botones", async ({ page }) => {
    const t = await nuevoLocal("res-lectura");
    await reservarComo(t.owner, t.branch, manana(), "21:00", { nombre: "Fabiana" });
    await service().from("subscriptions").update({ current_period_end: new Date(Date.now() - 10 * 864e5).toISOString(), trial_ends_at: null }).eq("organization_id", t.orgId);
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/sala/${t.slug}/reservas?dia=${manana()}`);
    await expect(page.getByTestId("reservas-solo-lectura")).toContainText("solo lectura");
    await expect(page.getByTestId("reservas-no-incluida")).toHaveCount(0);
    await expect(tarjeta(page, "Fabiana")).toHaveCount(1);
    await expect(page.getByTestId("reservas-nueva")).toHaveCount(0);
    await expect(page.getByTestId("reserva").getByRole("button")).toHaveCount(0);
  });

  test("una mesa ocupada pasada la medianoche no se ofrece a una reserva que termina después de las 00:00", async ({ page }) => {
    const t = await nuevoLocal("res-medianoche");
    const dia = manana();
    await reservarComo(t.owner, t.branch, enDias(2), "00:30", { mesa: t.mesaIds[0], nombre: "Madrugada" }); // Mesa 1, de 00:30 a 02:00 del día siguiente
    await reservarComo(t.owner, t.branch, dia, "23:30", { nombre: "Noche" }); // de 23:30 a 01:00: se pisa con la anterior
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/sala/${t.slug}/reservas?dia=${dia}`);
    const noche = tarjeta(page, "Noche");
    await expect(noche.getByRole("option", { name: "Mesa 1" })).toHaveCount(0);
    await expect(noche.getByRole("option", { name: "Mesa 2" })).toHaveCount(1);
  });

  test("si el día tiene más reservas de las que se pueden leer, la pantalla lo avisa", async ({ page }) => {
    const t = await nuevoLocal("res-tope");
    const dia = manana();
    sql(
      `insert into public.reservations (organization_id, branch_id, status, guest_name, guest_phone, party_size, starts_at, ends_at, client_key, request_hash) ` +
        `select '${t.orgId}', '${t.branch}', 'cancelled', 'Masiva ' || i, '123456', 2, ((date '${dia}' + time '10:00') at time zone 'America/Argentina/Buenos_Aires') + (i * interval '1 minute'), ` +
        `((date '${dia}' + time '10:00') at time zone 'America/Argentina/Buenos_Aires') + (i * interval '1 minute') + interval '1 hour', gen_random_uuid(), 'x' from generate_series(1, 1005) as i`,
    );
    // Una reserva por confirmar, dentro de las primeras 1000 filas: con la lectura incompleta no se sabe qué mesas están libres.
    await reservarComo(t.owner, t.branch, dia, "09:00", { nombre: "Visible" });
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/sala/${t.slug}/reservas?dia=${dia}`);
    await expect(page.getByTestId("reservas-truncada")).toContainText("1000");
    await expect(page.getByTestId("reserva").first()).toBeVisible();
    const visible = tarjeta(page, "Visible");
    await expect(visible.getByTestId("reserva-mesas-incompletas")).toBeVisible();
    await expect(visible.getByRole("option")).toHaveCount(0);
    await expect(visible.getByRole("button", { name: "Confirmar con esta mesa" })).toHaveCount(0);
  });

  test("el Resumen del Staff con sucursales asignadas solo cuenta las reservas de las suyas", async ({ page }) => {
    const t = await nuevoLocal("res-asignadas");
    const norte = await service().from("branches").insert({ organization_id: t.orgId, slug: "norte", name: "Norte" }).select("id").single();
    expect(norte.error).toBeNull();
    await reservarComo(t.owner, norte.data!.id as string, manana(), "21:00", { nombre: "De Norte" });
    await service().from("memberships").update({ assigned_branch_ids: [t.branch] }).eq("organization_id", t.orgId).eq("user_id", t.staff.id);

    await login(page, t.staff.email, t.staff.password);
    await page.goto(`/panel/${t.slug}`);
    await expect(page.getByTestId("resumen-atencion")).toBeVisible();
    await expect(page.locator('[data-item="reservas"]')).toHaveCount(0);

    await service().from("memberships").update({ assigned_branch_ids: [] }).eq("organization_id", t.orgId).eq("user_id", t.staff.id);
    await page.goto(`/panel/${t.slug}`);
    await expect(page.locator('[data-item="reservas"]')).toContainText("1 reserva espera");
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

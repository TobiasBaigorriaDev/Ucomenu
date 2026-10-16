import { createClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";
import { purgeOrgRecordsWhere } from "../tests/rls/purge-price-history";

/**
 * Apoyo de las pruebas E2E del acceso. Crea locales y personas de prueba con la clave de servicio
 * (solo en las pruebas, contra el Supabase LOCAL) y las limpia al terminar. Los usuarios del seed
 * (`supabase/seed.sql`) se usan solo para lectura: lo que modifica datos trabaja sobre locales propios.
 */

for (const file of [".env.local", ".env.test.local"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // Si falta alguno, `service()` falla con un mensaje claro.
  }
}

export const SEED_PASSWORD = "ucomenu-dev-2026";
export const SEED = {
  duenoCafe: "dueno@cafe-ejemplo.test",
  mozoCafe: "mozo@cafe-ejemplo.test",
  duenoParrilla: "dueno@parrilla-demo.test",
  mozoParrilla: "mozo@parrilla-demo.test",
  duenoMoroso: "dueno@resto-moroso.test",
  mozoMoroso: "mozo@resto-moroso.test",
  multi: "multi@ucomenu.test",
} as const;

export const TEST_PASSWORD = "contrasena-de-prueba-123";
const DIA_MS = 24 * 60 * 60 * 1000;

export function service() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (.env.local / .env.test.local).");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

const rand = () => Math.random().toString(36).slice(2, 8);

export type Estado = "active" | "grace" | "read_only" | "suspended";
export type Person = { id: string; email: string; password: string };

export type Tenant = {
  orgId: string;
  slug: string;
  name: string;
  owner: Person;
  staff: Person;
  cleanup: () => Promise<void>;
};

async function createPerson(label: string, orgId: string, role: "owner" | "staff"): Promise<Person> {
  const db = service();
  const email = `e2e-${label}-${rand()}@example.test`;
  const created = await db.auth.admin.createUser({ email, password: TEST_PASSWORD, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`No se pudo crear ${email}: ${created.error?.message}`);
  const membership = await db.from("memberships").insert({ user_id: created.data.user.id, organization_id: orgId, role });
  if (membership.error) throw new Error(`No se pudo crear la membresía: ${membership.error.message}`);
  return { id: created.data.user.id, email, password: TEST_PASSWORD };
}

/** Un local propio de la prueba, con Dueño y Staff, una sucursal y el estado de cuenta pedido. */
export async function createTenant(label: string, estado: Estado = "active"): Promise<Tenant> {
  const db = service();
  const slug = `e2e-${label}-${rand()}`;
  const name = `Local ${label}`;

  const org = await db.from("organizations").insert({ slug, name }).select("id").single();
  if (org.error) throw new Error(`No se pudo crear el local: ${org.error.message}`);
  const orgId = org.data.id;

  // El día N de mora es el techo de las 24 h: 2 d 23 h de atraso es el día 3.
  const HORA_MS = 60 * 60 * 1000;
  const finEnMs = {
    active: 5 * DIA_MS,
    grace: -3 * DIA_MS + HORA_MS,
    read_only: -10 * DIA_MS,
    suspended: -20 * DIA_MS,
  }[estado];
  const sub = await db
    .from("subscriptions")
    .update({ current_period_end: new Date(Date.now() + finEnMs).toISOString(), trial_ends_at: null })
    .eq("organization_id", orgId);
  if (sub.error) throw new Error(`No se pudo fijar la suscripción: ${sub.error.message}`);

  await db.from("branches").insert({ organization_id: orgId, slug: "centro", name: "Centro" });

  const owner = await createPerson(`${label}-d`, orgId, "owner");
  const staff = await createPerson(`${label}-s`, orgId, "staff");

  const people = [owner, staff];
  return {
    orgId,
    slug,
    name,
    owner,
    staff,
    cleanup: async () => {
      purgeOrgRecordsWhere(`o.id = '${orgId}'`); // historial de precios y pagos bloquean el borrado (RESTRICT)
      await db.from("organizations").delete().eq("id", orgId); // la cascada de dueños se permite
      for (const p of people) await db.auth.admin.deleteUser(p.id);
    },
  };
}

/** Borra cuentas creadas durante una prueba (p. ej. desde el panel). */
export async function deleteAccountsByEmail(emails: string[]) {
  const db = service();
  const { data } = await db.auth.admin.listUsers({ perPage: 1000 });
  for (const user of data.users) {
    if (user.email && emails.includes(user.email)) await db.auth.admin.deleteUser(user.id);
  }
}

export async function login(page: Page, email: string, password: string, next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Ingresar" }).click();
  // Espera el resultado: salir de /login (éxito) o el mensaje de error del formulario.
  await Promise.race([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 }),
    alerta(page).waitFor({ timeout: 20_000 }),
  ]);
}

/** El aviso de error/estado de un formulario (Next tiene su propio role="alert" para anunciar rutas). */
export const alerta = (page: Page) => page.locator("form").getByRole("alert");

/**
 * Ningún elemento visible sobrepasa el ancho del teléfono. No se mide `scrollWidth - innerWidth`: en emulación móvil el
 * viewport crece con el contenido y esa resta da 0 aunque la página se ensanche (falsos aprobados). Se mide el borde
 * derecho de cada elemento contra el ancho configurado del viewport.
 */
export async function expectNoHorizontalOverflow(page: Page) {
  const ancho = page.viewportSize()?.width ?? 390;
  const { derecha, elemento } = await page.evaluate(() => {
    let derecha = 0;
    let elemento = "";
    // Lo que vive dentro de un contenedor con scroll horizontal propio (p. ej. las pestañas del panel) no ensancha la página.
    const recortado = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (getComputedStyle(p).overflowX !== "visible") return true;
      }
      return false;
    };
    for (const el of document.body.querySelectorAll("*")) {
      const caja = el.getBoundingClientRect();
      if (caja.width === 0 || caja.height === 0) continue; // ocultos o sin caja
      if (recortado(el)) continue;
      if (caja.right > derecha) {
        derecha = caja.right;
        elemento = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}` : ""}`;
      }
    }
    return { derecha, elemento };
  });
  expect(derecha, `desborde horizontal a ${ancho} px (lo causa «${elemento}»)`).toBeLessThanOrEqual(ancho + 0.5);
}

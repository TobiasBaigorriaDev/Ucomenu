import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { asegurarDestinoLocal, purgeAuditLogWhere } from "../tests/rls/purge-price-history";
import { SEED_PASSWORD, alerta, createTenant, expectNoHorizontalOverflow, login, service } from "./support";

/**
 * SuperAdmin: borrado definitivo de organizaciones (nivel C, ficha borrado-de-organizaciones, ADR 0028), contra el build y el
 * Supabase local, a 390 px. Cada prueba trabaja sobre un local propio (`createTenant`) y limpia su auditoría.
 */

const ADMIN_EMAIL = "admin@ucomenu.test";
const detalle = (slug: string) => `/admin/organizaciones/${slug}`;
const seccion = (page: Page, id: string) => page.locator(`section[aria-labelledby="${id}"]`);
const limpiarAuditoria = (orgId: string) => purgeAuditLogWhere(`organization_id = '${orgId}'`);

/** Hace que la baja auditada tenga la antigüedad pedida (la auditoría solo se agrega: se apaga su trigger un momento, solo en el Docker local). */
function envejecerBaja(orgId: string, hace: string) {
  const contenedor = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_ucomenu";
  asegurarDestinoLocal(contenedor);
  execFileSync(
    "docker",
    [
      "exec",
      contenedor,
      "psql",
      "-U",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
      "-c",
      `begin; alter table public.audit_log disable trigger audit_log_no_update_delete; ` +
        `update public.audit_log set created_at = clock_timestamp() - interval '${hace}' where organization_id = '${orgId}' and action = 'organization.deactivated'; ` +
        `alter table public.audit_log enable trigger audit_log_no_update_delete; commit`,
    ],
    { encoding: "utf8" },
  );
}

/** Da de baja desde la ficha (la sesión de SuperAdmin ya está abierta en esa página). */
async function darDeBaja(page: Page) {
  const baja = seccion(page, "seccion-baja").locator("form");
  await baja.getByLabel("Motivo de la baja").fill("Cierra el local");
  await baja.getByRole("checkbox").check();
  await baja.getByRole("button", { name: "Dar de baja la organización" }).click();
  await expect(baja.getByRole("status")).toContainText("quedó dada de baja");
}

test.describe("borrado definitivo", () => {
  test("no se ofrece con la organización activa ni con menos de 30 días de baja; con el plazo cumplido pide el identificador y borra", async ({ page, browser }) => {
    const t = await createTenant("adm-borrado");
    try {
      await login(page, ADMIN_EMAIL, SEED_PASSWORD, detalle(t.slug));
      await expect(page.getByTestId("aviso-borrado")).toContainText("Irreversible");
      await expect(page.getByTestId("borrado-estado")).toContainText("primero hay que darla de baja");
      await expect(page.getByRole("button", { name: "Borrar definitivamente" })).toHaveCount(0);

      await darDeBaja(page);
      await page.reload();
      await expect(page.getByTestId("borrado-estado")).toContainText("Se podrá borrar a partir del");
      await expect(page.getByRole("button", { name: "Borrar definitivamente" })).toHaveCount(0);

      // Con la baja de hace 31 días aparece el formulario.
      envejecerBaja(t.orgId, "31 days");
      await page.reload();
      await expect(page.getByTestId("borrado-estado")).toHaveCount(0);
      const form = seccion(page, "seccion-borrado").locator("form");
      await expect(form.getByRole("button", { name: "Borrar definitivamente" })).toBeVisible();

      // El identificador equivocado no borra nada y conserva lo escrito.
      await form.getByLabel(/Escribí el identificador/).fill("otro-local");
      await form.getByLabel("Motivo del borrado").fill("Cerró hace meses");
      await form.getByRole("checkbox").check();
      await form.getByRole("button", { name: "Borrar definitivamente" }).click();
      await expect(alerta(page)).toContainText("no coincide con el de la organización");
      await expect(form.getByLabel("Motivo del borrado")).toHaveValue("Cerró hace meses");
      expect((await service().from("organizations").select("id").eq("id", t.orgId)).data).toHaveLength(1);

      // Sin la casilla el navegador no envía el formulario.
      await form.getByLabel(/Escribí el identificador/).fill(t.slug);
      await form.getByRole("checkbox").uncheck();
      await form.getByRole("button", { name: "Borrar definitivamente" }).click();
      await expect(page).toHaveURL(new RegExp(`${detalle(t.slug)}$`));
      expect((await service().from("organizations").select("id").eq("id", t.orgId)).data).toHaveLength(1);

      // Con todo correcto: borra y vuelve a la lista con el aviso.
      await form.getByRole("checkbox").check();
      await form.getByRole("button", { name: "Borrar definitivamente" }).click();
      await expect(page).toHaveURL(/\/admin\?borrada=/);
      await expect(page.getByTestId("aviso-borrada")).toContainText(`«${t.slug}» se borró definitivamente`);
      await expect(page.getByTestId("aviso-archivos-pendientes")).toHaveCount(0);
      await expect(page.getByTestId("organizacion").filter({ hasText: t.slug })).toHaveCount(0);
      // Queda en los movimientos con el nombre, el id y el motivo.
      const movimiento = page.getByTestId("auditoria").filter({ hasText: "Organización borrada" }).filter({ hasText: t.slug });
      await expect(movimiento).toContainText(`«${t.name}»`);
      await expect(movimiento).toContainText(`id ${t.orgId}`);
      await expect(movimiento).toContainText("motivo: Cerró hace meses");

      // Ya no existe: la ficha da 404, la carta también y el Dueño no entra.
      expect((await page.goto(detalle(t.slug)))?.status()).toBe(404);
      const publico = await browser.newPage();
      expect((await publico.goto(`/m/${t.slug}/centro`))?.status()).toBe(404);
      await publico.close();
      const dueno = await browser.newPage();
      await login(dueno, t.owner.email, t.owner.password, `/panel/${t.slug}`);
      expect((await dueno.goto(`/panel/${t.slug}`))?.status()).toBe(404);
      await dueno.close();

      const filas = await service().from("organizations").select("id").eq("id", t.orgId);
      expect(filas.data).toHaveLength(0);
      const hechos = await service().from("audit_log").select("action").eq("organization_id", t.orgId).eq("action", "organization.deleted");
      expect(hechos.data).toHaveLength(1);
    } finally {
      await limpiarAuditoria(t.orgId);
      await t.cleanup();
    }
  });

  test("a 390 px la sección de borrado, con el identificador más largo y el motivo más largo, no desborda", async ({ page }) => {
    const t = await createTenant(`ancho-${"x".repeat(40)}`);
    try {
      await login(page, ADMIN_EMAIL, SEED_PASSWORD, detalle(t.slug));
      await darDeBaja(page);
      envejecerBaja(t.orgId, "40 days");
      await page.reload();
      const form = seccion(page, "seccion-borrado").locator("form");
      await form.getByLabel(/Escribí el identificador/).fill(t.slug);
      await form.getByLabel("Motivo del borrado").fill("M".repeat(200));
      await expectNoHorizontalOverflow(page);
    } finally {
      await limpiarAuditoria(t.orgId);
      await t.cleanup();
    }
  });
});

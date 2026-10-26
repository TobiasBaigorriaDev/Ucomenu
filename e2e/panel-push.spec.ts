import { expect, test, type Page } from "@playwright/test";
import { conPushDoble } from "./push-doble";
import { createTenant, expectNoHorizontalOverflow, login, service, type Tenant } from "./support";

/**
 * Aviso de llamados también desde el panel (ficha aviso-push-desde-el-panel): el Resumen ofrece activar el aviso sin entrar
 * a la sala. El servicio de push real se sustituye por el doble de `push-doble.ts` (ver `sala-push.spec.ts`); el service
 * worker y el envío se prueban aparte (`sala-sw.test.ts`, `push.test.ts`, RLS).
 */

const tenants: Tenant[] = [];

async function nuevoLocal(label: string, plan: "pro" | "basic" = "pro") {
  const t = await createTenant(label, "active");
  tenants.push(t);
  await service().from("subscriptions").update({ plan_code: plan }).eq("organization_id", t.orgId);
  return t;
}

test.afterAll(async () => {
  for (const t of tenants) await t.cleanup();
});

async function abrirPanel(page: Page, t: Tenant, persona: Tenant["staff"] = t.owner) {
  await login(page, persona.email, persona.password);
  await page.goto(`/panel/${t.slug}`);
  await expect(page.getByRole("heading", { name: "Resumen" })).toBeVisible();
}

const activar = (page: Page) => page.getByRole("button", { name: "Avisarme cuando llamen a una mesa" });

test.describe("aviso de llamados desde el panel", () => {
  for (const [rol, persona] of [
    ["el Dueño", "owner"],
    ["el Staff", "staff"],
  ] as const) {
    test(`${rol} lo activa desde el Resumen, queda registrado, sobrevive a recargar y se puede desactivar`, async ({ browser }) => {
      const t = await nuevoLocal(`panel-push-${persona}`);
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await conPushDoble(context);
      const page = await context.newPage();
      await abrirPanel(page, t, t[persona]);
      await expectNoHorizontalOverflow(page);

      await expect(activar(page)).toBeVisible();
      await activar(page).click();
      await expect(page.getByTestId("push-activo")).toContainText("aunque estés en otra pantalla");
      await expect(page.getByTestId("push-error")).toHaveCount(0);

      // Se suscribió por el service worker PROPIO (alcance /sala/), aunque se activó desde una página del panel.
      const alcances = await page.evaluate(() => (window as unknown as { __alcances: string[] }).__alcances);
      expect(alcances).toHaveLength(1);
      expect(alcances[0]).toMatch(/\/sala\/$/);

      await page.reload();
      await expect(page.getByTestId("push-activo")).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await page.getByRole("button", { name: "Desactivar avisos" }).click();
      await expect(activar(page)).toBeVisible();
      await page.reload();
      await expect(activar(page)).toBeVisible();
      await context.close();
    });
  }

  test("el dispositivo activado en el panel figura activado en la sala del mismo local, y no en otro local", async ({ browser }) => {
    const a = await nuevoLocal("panel-push-a");
    const b = await nuevoLocal("panel-push-b");
    const sumar = await service().from("memberships").insert({ user_id: a.owner.id, organization_id: b.orgId, role: "staff" });
    expect(sumar.error).toBeNull();

    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await conPushDoble(context);
    const page = await context.newPage();
    await abrirPanel(page, a);
    await activar(page).click();
    await expect(page.getByTestId("push-activo")).toBeVisible();

    await page.goto(`/sala/${a.slug}`);
    await expect(page.getByRole("heading", { name: "Mesas", level: 1 })).toBeVisible();
    await expect(page.getByTestId("push-activo")).toContainText("aunque cierres la sala");

    await page.goto(`/panel/${b.slug}`);
    await expect(page.getByRole("heading", { name: "Resumen" })).toBeVisible();
    await expect(activar(page)).toBeVisible(); // mismo dispositivo, pero este local no lo tiene registrado
    await context.close();
  });

  test("si el navegador bloquea las notificaciones, el panel lo explica y no registra nada", async ({ browser }) => {
    const t = await nuevoLocal("panel-push-denegado");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await conPushDoble(context, "denied");
    const page = await context.newPage();
    await abrirPanel(page, t);
    await activar(page).click();
    await expect(page.getByTestId("push-ayuda")).toContainText("Bloqueaste las notificaciones");
    await expect(page.getByTestId("push-activo")).toHaveCount(0);
    await context.close();
  });

  test("con el plan Básico (sin llamado al mozo) el Resumen no ofrece el aviso", async ({ browser }) => {
    const t = await nuevoLocal("panel-push-basico", "basic");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await conPushDoble(context);
    const page = await context.newPage();
    await abrirPanel(page, t);
    await expect(page.getByTestId("aviso-push")).toHaveCount(0);
    await context.close();
  });
});

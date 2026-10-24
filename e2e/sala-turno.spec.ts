import { expect, test } from "@playwright/test";
import { createTenant, expectNoHorizontalOverflow, login, service, type Tenant } from "./support";

/**
 * Turno de mesa (ficha turno-de-mesa, ADR 0044), contra el build y el Supabase local, a 390 px: «Reiniciar QR de la mesa» en la pantalla
 * de la mesa. Pide confirmación, mueve el turno de ESA mesa y no toca el QR (su token).
 */

const tenants: Tenant[] = [];

async function nuevoLocal(label: string) {
  const t = await createTenant(label);
  tenants.push(t);
  const db = service();
  await db.from("subscriptions").update({ plan_code: "pro" }).eq("organization_id", t.orgId);
  const branch = await db.from("branches").select("id").eq("organization_id", t.orgId).single();
  const mesas = await db
    .from("tables")
    .insert(["Mesa 1", "Mesa 2"].map((l) => ({ organization_id: t.orgId, branch_id: branch.data!.id, label: l })))
    .select("id, label, qr_token, turn_started_at")
    .order("label");
  if (mesas.error) throw new Error(mesas.error.message);
  return { t, mesas: mesas.data as { id: string; label: string; qr_token: string; turn_started_at: string }[] };
}

const fila = async (id: string) => (await service().from("tables").select("qr_token, turn_started_at").eq("id", id).single()).data!;

test.afterAll(async () => {
  for (const t of tenants) await t.cleanup();
});

test.describe("reiniciar el QR de la mesa", () => {
  test("pide confirmación, mueve el turno de esa mesa y deja igual el QR", async ({ browser }) => {
    const l = await nuevoLocal("turno-reinicio");
    const [mesa1, mesa2] = l.mesas;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await login(page, l.t.staff.email, l.t.staff.password);
    await page.goto(`/sala/${l.t.slug}/mesas/${mesa1.id}/anotar`);
    await expectNoHorizontalOverflow(page);

    // Cerrar la hoja sin confirmar no cambia nada.
    await page.getByTestId("abrir-reinicio").click();
    const hoja = page.getByTestId("hoja-reinicio");
    await expect(hoja).toContainText("Mesa 1");
    await expect(hoja).toContainText("escanear de nuevo");
    await expectNoHorizontalOverflow(page);
    await hoja.getByRole("button", { name: "Cerrar sin reiniciar" }).click();
    await expect(hoja).toHaveCount(0);
    expect((await fila(mesa1.id)).turn_started_at).toBe(mesa1.turn_started_at);

    // Confirmar mueve el turno de la mesa 1; la mesa 2 y el token de la 1 quedan como estaban.
    await page.getByTestId("abrir-reinicio").click();
    await page.getByTestId("confirmar-reinicio").click();
    await expect(page.getByTestId("reinicio-hecho")).toContainText("arranca un turno nuevo");
    const despues = await fila(mesa1.id);
    expect(Date.parse(despues.turn_started_at)).toBeGreaterThan(Date.parse(mesa1.turn_started_at));
    expect(despues.qr_token).toBe(mesa1.qr_token);
    expect((await fila(mesa2.id)).turn_started_at).toBe(mesa2.turn_started_at);

    await page.getByTestId("reinicio-listo").click();
    await expect(page.getByTestId("hoja-reinicio")).toHaveCount(0);
    await ctx.close();
  });

  test("una mesa de otro local no se reinicia desde la URL de este", async ({ browser }) => {
    const a = await nuevoLocal("turno-a");
    const b = await nuevoLocal("turno-b");
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await login(page, a.t.owner.email, a.t.owner.password);
    const ajena = b.mesas[0];
    const respuesta = await page.goto(`/sala/${a.t.slug}/mesas/${ajena.id}/anotar`);
    expect(respuesta?.status()).toBe(404);
    expect((await fila(ajena.id)).turn_started_at).toBe(ajena.turn_started_at);
    await ctx.close();
  });
});

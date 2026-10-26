import { expect, test, type Page } from "@playwright/test";
import { createTenant, expectNoHorizontalOverflow, service, type Tenant } from "./support";

/**
 * Invitación a reseñar en la carta (nivel M; ficha invitacion-a-resenar): el enlace del pie para todos los planes y la invitación
 * tras «Pedir la cuenta» (solo existe con el dock de llamados, plan Pro o superior), contra el build y el Supabase local, a 390 px.
 */

const tenants: Tenant[] = [];
const ENLACE = "https://g.page/r/CabcdEFGH1234/review";

async function nuevoLocal(label: string, opciones: { plan: "basic" | "pro" | "premium"; enlace: string | null }) {
  const t = await createTenant(label, "active");
  tenants.push(t);
  const db = service();
  if (opciones.plan !== "basic") {
    const r = await db.from("subscriptions").update({ plan_code: opciones.plan }).eq("organization_id", t.orgId);
    if (r.error) throw new Error(r.error.message);
  }
  const branch = await db.from("branches").update({ google_review_url: opciones.enlace }).eq("organization_id", t.orgId).select("id").single();
  if (branch.error) throw new Error(branch.error.message);
  const mesas = await db
    .from("tables")
    .insert([
      { organization_id: t.orgId, branch_id: branch.data.id, label: "Mesa 1" },
      { organization_id: t.orgId, branch_id: branch.data.id, label: "Mesa 2" },
    ])
    .select("label, qr_token")
    .order("label");
  if (mesas.error) throw new Error(mesas.error.message);
  return { t, mesa1: mesas.data[0], mesa2: mesas.data[1] };
}

test.afterAll(async () => {
  for (const t of tenants) await t.cleanup();
});

const barra = (page: Page) => page.getByTestId("barra-llamado");
const invitacion = (page: Page) => page.getByTestId("invitacion-resenas");

test.describe("invitación a reseñar en la carta", () => {
  test("el pie la ofrece en el plan Básico, sin llamados, y sin enlace no hay nada", async ({ page }) => {
    const con = await nuevoLocal("resenas-basico", { plan: "basic", enlace: ENLACE });
    await page.goto(`/m/${con.t.slug}/centro`);
    const pie = page.getByTestId("resenas-pie");
    await expect(pie).toHaveText("Dejá tu reseña en Google");
    await expect(pie).toHaveAttribute("href", ENLACE);
    await expect(pie).toHaveAttribute("target", "_blank");
    await expect(pie).toHaveAttribute("rel", /noopener/);
    await expect(barra(page)).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    const sin = await nuevoLocal("resenas-sin", { plan: "basic", enlace: null });
    await page.goto(`/m/${sin.t.slug}/centro`);
    await expect(page.getByRole("contentinfo")).toBeVisible();
    await expect(page.getByTestId("resenas-pie")).toHaveCount(0);
  });

  test("con Pro aparece solo al pedir la cuenta, se cierra y no se repite en el día", async ({ page }) => {
    const { mesa1, mesa2 } = await nuevoLocal("resenas-pro", { plan: "pro", enlace: ENLACE });
    await page.goto(`/t/${mesa1.qr_token}`);
    await expect(page.getByTestId("resenas-pie")).toHaveAttribute("href", ENLACE);
    await expect(invitacion(page)).toHaveCount(0);

    // Llamar al mozo no invita: la invitación es del momento de la cuenta.
    await barra(page).getByRole("button", { name: "Llamar al mozo" }).click();
    await expect(page.getByTestId("mensaje-llamado")).toContainText("Avisamos al personal");
    await expect(invitacion(page)).toHaveCount(0);

    await barra(page).getByRole("button", { name: "Pedir la cuenta" }).click();
    await expect(page.getByTestId("mensaje-llamado")).toContainText("Pedimos tu cuenta");
    await expect(invitacion(page)).toContainText("Si querés, podés dejar tu reseña de este lugar en Google.");
    await expect(invitacion(page).getByRole("link", { name: "Dejar una reseña" })).toHaveAttribute("href", ENLACE);
    await expect(invitacion(page).getByRole("link", { name: "Dejar una reseña" })).toHaveAttribute("rel", /noopener/);
    await expectNoHorizontalOverflow(page);
    const cerrar = invitacion(page).getByRole("button", { name: "Cerrar" });
    expect((await cerrar.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await cerrar.click();
    await expect(invitacion(page)).toHaveCount(0);

    // Otra mesa del mismo local, mismo dispositivo y mismo día: la cuenta se pide, la invitación no vuelve.
    await page.goto(`/t/${mesa2.qr_token}`);
    await barra(page).getByRole("button", { name: "Pedir la cuenta" }).click();
    await expect(page.getByTestId("mensaje-llamado")).toContainText("Pedimos tu cuenta");
    await expect(invitacion(page)).toHaveCount(0);
  });

  test("con Premium también aparece al pedir la cuenta", async ({ page }) => {
    const { mesa1 } = await nuevoLocal("resenas-premium", { plan: "premium", enlace: ENLACE });
    await page.goto(`/t/${mesa1.qr_token}`);
    await barra(page).getByRole("button", { name: "Pedir la cuenta" }).click();
    await expect(page.getByTestId("mensaje-llamado")).toContainText("Pedimos tu cuenta");
    await expect(invitacion(page)).toContainText("Si querés, podés dejar tu reseña de este lugar en Google.");
  });

  test("sin enlace de reseñas, pedir la cuenta no invita a nada", async ({ page }) => {
    const { mesa1 } = await nuevoLocal("resenas-pro-sin", { plan: "pro", enlace: null });
    await page.goto(`/t/${mesa1.qr_token}`);
    await barra(page).getByRole("button", { name: "Pedir la cuenta" }).click();
    await expect(page.getByTestId("mensaje-llamado")).toContainText("Pedimos tu cuenta");
    await expect(invitacion(page)).toHaveCount(0);
    await expect(page.getByTestId("resenas-pie")).toHaveCount(0);
  });
});

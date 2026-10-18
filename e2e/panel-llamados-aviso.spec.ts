import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { createTenant, expectNoHorizontalOverflow, login, service, type Tenant } from "./support";

/**
 * Cartel de llamados dentro del panel (ficha aviso-push-desde-el-panel): quien navega el panel se entera arriba, sin salir,
 * de que una mesa llamó. Mismo sondeo que la sala (~3 s), contra el build y el Supabase local, a 390 px.
 */

const tenants: Tenant[] = [];

async function nuevoLocal(label: string, plan: "pro" | "basic" = "pro") {
  const t = await createTenant(label, "active");
  tenants.push(t);
  const db = service();
  await db.from("subscriptions").update({ plan_code: plan }).eq("organization_id", t.orgId);
  const branch = await db.from("branches").select("id").eq("organization_id", t.orgId).single();
  const mesas = await db
    .from("tables")
    .insert(["Mesa 1", "Mesa 2"].map((label) => ({ organization_id: t.orgId, branch_id: branch.data!.id, label })))
    .select("qr_token, label")
    .order("label");
  if (mesas.error) throw new Error(mesas.error.message);
  return { t, mesas: mesas.data as { qr_token: string; label: string }[] };
}

test.afterAll(async () => {
  for (const t of tenants) await t.cleanup();
});

async function llamar(token: string, kind: "waiter" | "bill" = "waiter") {
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data, error } = await anon.rpc("create_waiter_call", { p_token: token, p_kind: kind });
  expect(error).toBeNull();
  expect(data).toEqual({ status: "created" });
}

const lista = (page: import("@playwright/test").Page) => page.getByTestId("llamados-aviso-lista");

test.describe("cartel de llamados en el panel", () => {
  test("un llamado aparece arriba mientras se navega el panel, se puede ocultar y vuelve a aparecer con uno nuevo", async ({ browser }) => {
    const { t, mesas } = await nuevoLocal("panel-aviso");
    const otro = await nuevoLocal("panel-aviso-otro");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await login(page, t.staff.email, t.staff.password);
    await page.goto(`/panel/${t.slug}/carta`);
    await expect(page.getByRole("heading", { name: "Carta", exact: true })).toBeVisible();
    await expect(page.getByTestId("llamados-aviso-titulo")).toHaveCount(0);

    await llamar(otro.mesas[0].qr_token); // otro local: no se ve acá
    await llamar(mesas[0].qr_token);
    await expect(page.getByTestId("llamados-aviso-titulo")).toHaveText("Una mesa necesita atención", { timeout: 12_000 });
    await expect(lista(page)).toContainText("Mesa 1");
    await expect(lista(page)).toContainText("llama al mozo");
    await expectNoHorizontalOverflow(page);

    // Se navega a otra pantalla del panel sin recargar: el cartel sigue.
    await page.getByRole("link", { name: "Mesas" }).first().click();
    await expect(page).toHaveURL(new RegExp(`/panel/${t.slug}/mesas`));
    await expect(page.getByTestId("llamados-aviso-titulo")).toBeVisible();

    await page.getByRole("button", { name: "Ocultar" }).click();
    await expect(page.getByTestId("llamados-aviso-titulo")).toHaveCount(0);

    await llamar(mesas[1].qr_token, "bill");
    await expect(page.getByTestId("llamados-aviso-titulo")).toHaveText("Una mesa necesita atención", { timeout: 12_000 });
    await expect(lista(page)).toContainText("Mesa 2");
    await expect(lista(page)).not.toContainText("Mesa 1"); // la oculta sigue oculta
    await expect(lista(page)).toContainText("pide la cuenta");

    // Atendido en la sala: el cartel se va solo.
    await service().from("waiter_calls").update({ status: "attended" }).eq("organization_id", t.orgId);
    await expect(page.getByTestId("llamados-aviso-titulo")).toHaveCount(0, { timeout: 12_000 });
    await context.close();
  });

  test("el enlace del cartel lleva a la sala en vivo, que no repite el cartel", async ({ browser }) => {
    const { t, mesas } = await nuevoLocal("panel-aviso-enlace");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/panel/${t.slug}`);
    await llamar(mesas[0].qr_token);
    await expect(page.getByTestId("llamados-aviso-titulo")).toBeVisible({ timeout: 12_000 });
    await page.getByRole("link", { name: "Ir a la sala en vivo" }).click();
    await expect(page.getByRole("heading", { name: "Sala en vivo" })).toBeVisible();
    await expect(page.getByTestId("llamados-aviso")).toHaveCount(0);
    await context.close();
  });

  test("con el plan Básico (sin llamado al mozo) el panel no muestra ni consulta el cartel", async ({ browser }) => {
    const { t } = await nuevoLocal("panel-aviso-basico", "basic");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const consultas: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/estado")) consultas.push(request.url());
    });
    await login(page, t.owner.email, t.owner.password);
    await page.goto(`/panel/${t.slug}`);
    await expect(page.getByRole("heading", { name: "Resumen" })).toBeVisible();
    await page.waitForTimeout(4_000);
    await expect(page.getByTestId("llamados-aviso")).toHaveCount(0);
    expect(consultas).toEqual([]);
    await context.close();
  });
});

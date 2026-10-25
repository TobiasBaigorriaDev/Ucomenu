import { expect, test } from "@playwright/test";
import { createTenant, expectNoHorizontalOverflow, login, service, type Tenant } from "./support";

const tenants: Tenant[] = [];
test.afterAll(async () => { for (const t of tenants) await t.cleanup(); });

test("Dueño configura varios horarios, persisten al recargar y se pueden desactivar", async ({ page }) => {
  const t = await createTenant("qr-horarios");
  tenants.push(t);
  await login(page, t.owner.email, t.owner.password);
  await page.goto(`/panel/${t.slug}/sucursales`);
  const section = page.locator("details").filter({ has: page.locator("summary", { hasText: "Reinicios automáticos de QR" }) });
  await section.locator("summary").click();
  await expect(section.getByLabel("Horario 1", { exact: true })).toHaveValue("05:00");
  await section.getByRole("button", { name: "Agregar horario" }).click();
  await section.getByLabel("Horario 2", { exact: true }).fill("17:30");
  await section.getByRole("button", { name: "Guardar horarios" }).click();
  await expect(section).toContainText("Horarios de reinicio guardados.");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: "output/qr-schedule-mobile.png", fullPage: true });
  await page.reload();
  await section.locator("summary").click();
  await expect(section.getByLabel("Horario 2", { exact: true })).toHaveValue("17:30");
  await page.setViewportSize({ width: 1280, height: 900 });
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: "output/qr-schedule-desktop.png", fullPage: true });
  await section.getByRole("button", { name: "Quitar horario 2" }).click();
  await section.getByRole("button", { name: "Quitar horario 1" }).click();
  await section.getByRole("button", { name: "Guardar horarios" }).click();
  await expect(section).toContainText("Reinicio automático desactivado.");
  await page.reload();
  await section.locator("summary").click();
  await expect(section.locator('input[type="time"]')).toHaveCount(0);
});

test("Staff confirma reinicio masivo, corta la visita anterior y conserva QR y pedidos", async ({ browser }) => {
  const t = await createTenant("qr-todos");
  tenants.push(t);
  const db = service();
  await db.from("subscriptions").update({ plan_code: "pro" }).eq("organization_id", t.orgId);
  const branch = await db.from("branches").select("id").eq("organization_id", t.orgId).single();
  const { data: tables, error } = await db.from("tables").insert(["Mesa 1", "Mesa 2"].map((label) => ({ organization_id: t.orgId, branch_id: branch.data!.id, label }))).select("id, qr_token, turn_started_at").order("id");
  if (error) throw error;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const visitor = await ctx.newPage();
  await visitor.goto(`/t/${tables![0].qr_token}`);
  await expect(visitor).toHaveURL(/\?v=/);
  const page = await ctx.newPage();
  await login(page, t.staff.email, t.staff.password);
  await page.goto(`/sala/${t.slug}/mesas`);
  await page.getByRole("button", { name: "Reiniciar todos los QR", exact: true }).click();
  const sheet = page.getByTestId("reinicio-todos");
  await expect(sheet).toContainText("todas sus sucursales");
  await sheet.getByRole("button", { name: "Cerrar sin reiniciar" }).click();
  const before = (await db.from("tables").select("id, qr_token, turn_started_at").eq("organization_id", t.orgId).order("id")).data!;
  expect(before).toEqual(tables);
  // Supera la tolerancia de un segundo del ticket de visita, igual que un uso real.
  await page.waitForTimeout(1100);
  await page.getByRole("button", { name: "Reiniciar todos los QR", exact: true }).click();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: "output/qr-reset-all-mobile.png", fullPage: true });
  await sheet.getByRole("button", { name: "Sí, reiniciar todas las mesas" }).click();
  await expect(sheet.getByRole("status")).toContainText("se reiniciaron 2 mesas");
  const after = (await db.from("tables").select("id, qr_token, turn_started_at").eq("organization_id", t.orgId).order("id")).data!;
  expect(after.every((row, i) => row.qr_token === before[i].qr_token && row.turn_started_at > before[i].turn_started_at)).toBe(true);
  await visitor.reload();
  await expect(visitor.getByText("Esta sesión venció.", { exact: false })).toBeVisible();
  await ctx.close();
});

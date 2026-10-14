import { expect, test, type Page } from "@playwright/test";
import { qrMatrix, qrPath } from "../src/lib/mesas/qr";
import {
  alerta,
  createTenant,
  expectNoHorizontalOverflow,
  login,
  service,
  type Estado,
  type Person,
  type Tenant,
} from "./support";

/**
 * Mesas y QR (ficha mesas-y-qr): alta y gestión en el panel, hoja imprimible, regeneración del QR y la entrada
 * pública `/t/{token}`, contra el build y el Supabase local, a 390 px. Cada prueba usa un local propio.
 */

// Base del QR: NEXT_PUBLIC_SITE_URL si el entorno la define (el servidor de pruebas la hereda); si no, el servidor de las pruebas.
const BASE = process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL).origin : "http://localhost:3100";
const tenants: Tenant[] = [];

async function nuevoLocal(label: string, estado: Estado = "active") {
  const t = await createTenant(label, estado);
  tenants.push(t);
  return t;
}

test.afterAll(async () => {
  for (const t of tenants) await t.cleanup();
});

async function sucursalDe(t: Tenant): Promise<string> {
  const { data } = await service().from("branches").select("id").eq("organization_id", t.orgId).single();
  return data!.id;
}

/** Carga mesas con la clave de servicio (no es lo que se prueba). Devuelve ids y tokens por etiqueta. */
async function sembrarMesas(t: Tenant, etiquetas: string[], activa = true) {
  const branch = await sucursalDe(t);
  const { data, error } = await service()
    .from("tables")
    .insert(etiquetas.map((label) => ({ organization_id: t.orgId, branch_id: branch, label, is_active: activa })))
    .select("id, label, qr_token");
  if (error) throw new Error(error.message);
  return { branch, mesas: Object.fromEntries(data.map((m) => [m.label, m])) };
}

async function ingresar(page: Page, persona: Person, t: Tenant, ruta = "/mesas") {
  await login(page, persona.email, persona.password);
  await page.goto(`/panel/${t.slug}${ruta}`);
}

const mesa = (page: Page, label: string) => page.locator(`[data-testid="mesa"][data-label="${label}"]`);
const estado = (page: Page) => page.locator("form").getByRole("status");
const etiquetas = (page: Page) => page.locator('[data-testid="mesa"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-label")));

test.describe("entrada pública /t/{token}", () => {
  test("una mesa activa muestra la carta de su sucursal con el número de mesa", async ({ page }) => {
    const respuesta = await page.goto("/t/c0ffee01000000000000000000000000");
    expect(respuesta?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Café Ejemplo" })).toBeVisible();
    await expect(page.getByTestId("mesa")).toHaveText("Mesa 1");
    await expect(page.getByRole("heading", { name: "Espresso" })).toBeVisible();
    // Lo inactivo de la carta sigue sin verse.
    await expect(page.getByText("Cold brew (discontinuado)")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    // El token vive en la URL: la página no se indexa y no manda el referrer.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  });

  test("una mesa inactiva muestra la carta sin el número de mesa", async ({ page }) => {
    const respuesta = await page.goto("/t/c0ffee03000000000000000000000000");
    expect(respuesta?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Espresso" })).toBeVisible();
    await expect(page.getByTestId("mesa")).toHaveCount(0);
    await expect(page.getByText("fuera de servicio")).toHaveCount(0);
  });

  test("token inexistente, malformado o de una organización inactiva: 404 idéntico y sin pistas", async ({ page }) => {
    const cuerpos = new Set<string>();
    for (const token of [
      "0".repeat(32),
      "c0ffee0100000000000000000000000", // 31
      "c0ffee010000000000000000000000000", // 33
      "C0FFEE01000000000000000000000000", // mayúsculas
      "mesa-1",
      "bad00001000000000000000000000000", // organización inactiva
      "%27%20or%20%271%27%3D%271", // ' or '1'='1
      "..%2F..%2Fpanel",
    ]) {
      const respuesta = await page.goto(`/t/${token}`);
      expect(respuesta?.status(), token).toBe(404);
      await expect(page.getByRole("heading", { name: "No encontramos esta carta" })).toBeVisible();
      cuerpos.add(await page.locator("main").innerText());
    }
    expect(cuerpos.size).toBe(1);
  });

  test("una cuenta suspendida muestra «Carta temporalmente no disponible»", async ({ page }) => {
    const respuesta = await page.goto("/t/dead0001000000000000000000000000");
    expect(respuesta?.status()).toBe(200);
    await expect(page.getByText("Carta temporalmente no disponible")).toBeVisible();
    await expect(page.getByTestId("mesa")).toHaveCount(0);
    await expect(page.getByText("Milanesa completa")).toHaveCount(0);
  });

  test("en solo lectura funciona igual; suspendida, no disponible", async ({ page }) => {
    const t = await nuevoLocal("mesas-lectura", "read_only");
    const { mesas } = await sembrarMesas(t, ["Mesa 5"]);
    await service().from("categories").insert({ organization_id: t.orgId, name: "Platos" });

    await page.goto(`/t/${mesas["Mesa 5"].qr_token}`);
    await expect(page.getByTestId("mesa")).toHaveText("Mesa 5");

    await service()
      .from("subscriptions")
      .update({ current_period_end: new Date(Date.now() - 20 * 864e5).toISOString(), trial_ends_at: null })
      .eq("organization_id", t.orgId);
    await page.goto(`/t/${mesas["Mesa 5"].qr_token}`);
    await expect(page.getByText("Carta temporalmente no disponible")).toBeVisible();
  });
});

test.describe("gestión de mesas (Dueño y Staff)", () => {
  test("agrega mesas, valida los nombres, renombra y activa o desactiva", async ({ page }) => {
    const t = await nuevoLocal("mesas-flujo");
    await ingresar(page, t.owner, t);
    await expectNoHorizontalOverflow(page);
    await expect(page.getByTestId("mesas-activas")).toContainText("0 de 20");

    const campo = page.getByLabel(/Nombre de la mesa en/);
    await expect(campo).toHaveValue("Mesa 1");
    await page.getByRole("button", { name: "Agregar mesa" }).click();
    await expect(mesa(page, "Mesa 1")).toBeVisible();
    await expect(campo).toHaveValue("Mesa 2"); // sugiere la siguiente

    await campo.fill("Mesa 10");
    await page.getByRole("button", { name: "Agregar mesa" }).click();
    await expect(mesa(page, "Mesa 10")).toBeVisible();
    await campo.fill("Mesa 2");
    await page.getByRole("button", { name: "Agregar mesa" }).click();
    await expect(mesa(page, "Mesa 2")).toBeVisible();
    // Orden natural: Mesa 2 antes que Mesa 10.
    expect(await etiquetas(page)).toEqual(["Mesa 1", "Mesa 2", "Mesa 10"]);
    await expect(page.getByTestId("mesas-activas")).toContainText("3 de 20");

    // Repetida (otras mayúsculas), vacía y larga: error y lo escrito se conserva.
    await campo.fill("mesa 1");
    await page.getByRole("button", { name: "Agregar mesa" }).click();
    await expect(alerta(page)).toContainText("Ya hay una mesa con ese nombre en esta sucursal");
    await expect(campo).toHaveValue("mesa 1");
    await campo.fill("   ");
    await page.getByRole("button", { name: "Agregar mesa" }).click();
    await expect(alerta(page)).toContainText("Ingresá un nombre");
    expect(await etiquetas(page)).toEqual(["Mesa 1", "Mesa 2", "Mesa 10"]);

    // Renombrar.
    await mesa(page, "Mesa 10").locator("summary", { hasText: "Renombrar" }).click();
    await mesa(page, "Mesa 10").getByLabel("Nombre nuevo").fill("Barra");
    await mesa(page, "Mesa 10").getByRole("button", { name: "Guardar nombre" }).click();
    await expect(mesa(page, "Barra")).toBeVisible();

    // Desactivar y activar.
    await page.getByRole("button", { name: "Desactivar Mesa 2" }).click();
    await expect(mesa(page, "Mesa 2")).toContainText("Inactiva");
    await expect(page.getByTestId("mesas-activas")).toContainText("2 de 20");
    await page.getByRole("button", { name: "Activar Mesa 2" }).click();
    await expect(mesa(page, "Mesa 2")).not.toContainText("Inactiva");
    await expect(page.getByTestId("mesas-activas")).toContainText("3 de 20");
  });

  test("el Staff gestiona las mesas igual que el Dueño", async ({ page }) => {
    const t = await nuevoLocal("mesas-staff");
    await ingresar(page, t.staff, t);
    await page.getByRole("button", { name: "Agregar mesa" }).click();
    await expect(mesa(page, "Mesa 1")).toBeVisible();
    await page.getByRole("button", { name: "Desactivar Mesa 1" }).click();
    await expect(mesa(page, "Mesa 1")).toContainText("Inactiva");
  });

  test("regenerar el QR: el token anterior da 404 y el nuevo funciona; nada más cambia", async ({ page }) => {
    const t = await nuevoLocal("mesas-regenera");
    const { mesas } = await sembrarMesas(t, ["Mesa 1", "Mesa 2"]);
    await service().from("categories").insert({ organization_id: t.orgId, name: "Platos" });
    const viejo = mesas["Mesa 1"].qr_token;
    const otra = mesas["Mesa 2"].qr_token;
    await ingresar(page, t.owner, t);

    await mesa(page, "Mesa 1").locator("summary", { hasText: "Regenerar QR" }).click();
    await mesa(page, "Mesa 1").getByRole("button", { name: "Sí, regenerar" }).click();
    await expect(estado(page)).toContainText("QR regenerado");

    const { data } = await service().from("tables").select("id, label, qr_token, is_active").eq("organization_id", t.orgId).order("label");
    const nuevo = data!.find((m) => m.label === "Mesa 1")!.qr_token;
    expect(nuevo).toMatch(/^[0-9a-f]{32}$/);
    expect(nuevo).not.toBe(viejo);
    expect(data!.find((m) => m.label === "Mesa 2")!.qr_token).toBe(otra); // la otra mesa no cambia
    expect(data!.find((m) => m.label === "Mesa 1")!.is_active).toBe(true);

    expect((await page.goto(`/t/${viejo}`))?.status()).toBe(404);
    const respuesta = await page.goto(`/t/${nuevo}`);
    expect(respuesta?.status()).toBe(200);
    await expect(page.getByTestId("mesa")).toHaveText("Mesa 1");
    expect((await page.goto(`/t/${otra}`))?.status()).toBe(200);
  });

  test("«Probar el QR» abre la carta de esa mesa", async ({ page }) => {
    const t = await nuevoLocal("mesas-probar");
    const { mesas } = await sembrarMesas(t, ["Mesa 3"]);
    await ingresar(page, t.owner, t);
    await page.getByRole("link", { name: "Probar el QR de Mesa 3" }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${mesas["Mesa 3"].qr_token}$`));
    await expect(page.getByTestId("mesa")).toHaveText("Mesa 3");
  });
});

test.describe("hoja imprimible", () => {
  test("una tarjeta por mesa activa con el QR de su token; el QR cambia al regenerar", async ({ page }) => {
    const t = await nuevoLocal("mesas-imprimir");
    const { branch, mesas } = await sembrarMesas(t, ["Mesa 1", "Mesa 2"]);
    await service().from("tables").insert({ organization_id: t.orgId, branch_id: branch, label: "Mesa 3", is_active: false });
    await ingresar(page, t.owner, t);

    await page.getByRole("link", { name: /Imprimir los QR de/ }).click();
    await expect(page).toHaveURL(new RegExp(`/mesas/imprimir/${branch}$`));
    const tarjetas = page.getByTestId("tarjeta-qr");
    await expect(tarjetas).toHaveCount(2); // la inactiva no se imprime
    await expect(page.getByRole("button", { name: "Imprimir" })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    for (const label of ["Mesa 1", "Mesa 2"]) {
      const url = `${BASE}/t/${mesas[label].qr_token}`;
      const svg = page.locator(`[data-testid="tarjeta-qr"][data-label="${label}"] svg`);
      await expect(svg).toHaveAttribute("data-qr-url", url);
      // El dibujo es exactamente el QR de esa URL.
      await expect(svg.locator("path")).toHaveAttribute("d", qrPath(qrMatrix(url)));
      await expect(page.locator(`[data-testid="tarjeta-qr"][data-label="${label}"]`)).toContainText(label);
      await expect(page.locator(`[data-testid="tarjeta-qr"][data-label="${label}"]`)).toContainText("Escaneá para ver la carta");
    }

    // Al imprimir, el marco del panel desaparece y quedan las tarjetas.
    await page.emulateMedia({ media: "print" });
    await expect(page.locator("header")).toBeHidden();
    await expect(page.getByRole("button", { name: "Imprimir" })).toBeHidden();
    await expect(tarjetas.first()).toBeVisible();
    await page.emulateMedia({ media: "screen" });

    // Regenerar cambia el dibujo.
    await page.goto(`/panel/${t.slug}/mesas`);
    await mesa(page, "Mesa 1").locator("summary", { hasText: "Regenerar QR" }).click();
    await mesa(page, "Mesa 1").getByRole("button", { name: "Sí, regenerar" }).click();
    await expect(estado(page)).toContainText("QR regenerado");
    await page.goto(`/panel/${t.slug}/mesas/imprimir/${branch}`);
    const { data } = await service().from("tables").select("qr_token").eq("id", mesas["Mesa 1"].id).single();
    expect(data!.qr_token).not.toBe(mesas["Mesa 1"].qr_token);
    await expect(page.locator('[data-testid="tarjeta-qr"][data-label="Mesa 1"] svg')).toHaveAttribute("data-qr-url", `${BASE}/t/${data!.qr_token}`);
  });

  test("con la cuenta en solo lectura o suspendida la hoja se puede abrir", async ({ page }) => {
    for (const estadoCuenta of ["read_only", "suspended"] as const) {
      const t = await nuevoLocal(`mesas-imp-${estadoCuenta.replace("_", "")}`, estadoCuenta);
      const { branch } = await sembrarMesas(t, ["Mesa 1"]);
      await ingresar(page, t.owner, t, `/mesas/imprimir/${branch}`);
      await expect(page.getByTestId("tarjeta-qr")).toHaveCount(1);
      await page.context().clearCookies();
    }
  });

  test("sin sesión, la hoja pasa por el login y vuelve a la MISMA sucursal (la sucursal no se pierde)", async ({ page }) => {
    const t = await nuevoLocal("mesas-imp-login");
    const { branch } = await sembrarMesas(t, ["Mesa 1", "Mesa 2"]);
    const ruta = `/panel/${t.slug}/mesas/imprimir/${branch}`;

    // El proxy real manda al login conservando la ruta completa, sucursal incluida.
    await page.goto(ruta);
    await expect(page).toHaveURL(/\/login\?next=/);
    expect(new URL(page.url()).searchParams.get("next")).toBe(ruta);
    await expect(page.getByTestId("tarjeta-qr")).toHaveCount(0); // no se filtra nada antes de ingresar

    await page.getByLabel("Email").fill(t.owner.email);
    await page.getByLabel("Contraseña").fill(t.owner.password);
    await page.getByRole("button", { name: "Ingresar" }).click();

    await expect(page).toHaveURL(new RegExp(`${ruta}$`));
    await expect(page.getByTestId("tarjeta-qr")).toHaveCount(2);
  });

  test("tras el login, un destino manipulado hacia otra sucursal o local no abre nada ajeno", async ({ page }) => {
    const a = await nuevoLocal("mesas-imp-login-a");
    const b = await nuevoLocal("mesas-imp-login-b");
    const { branch: branchB } = await sembrarMesas(b, ["Secreta"]);

    // Entra por la ruta de la sucursal de OTRO local: login y 404 (igual que una inexistente), sin ver nada.
    await page.goto(`/panel/${a.slug}/mesas/imprimir/${branchB}`);
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.getByLabel("Email").fill(a.owner.email);
    await page.getByLabel("Contraseña").fill(a.owner.password);
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page.getByRole("heading", { name: "No encontramos esta carta" })).toBeVisible();
    await expect(page.getByText("Secreta")).toHaveCount(0);
  });

  test("una sucursal de otro local, inexistente o malformada es 404", async ({ page }) => {
    const a = await nuevoLocal("mesas-imp-a");
    const b = await nuevoLocal("mesas-imp-b");
    const branchB = await sucursalDe(b);
    await login(page, a.owner.email, a.owner.password);
    for (const sucursal of [branchB, "00000000-0000-4000-8000-000000000000", "no-es-un-id"]) {
      const respuesta = await page.goto(`/panel/${a.slug}/mesas/imprimir/${sucursal}`);
      expect(respuesta?.status(), sucursal).toBe(404);
    }
  });
});

test.describe("tope del plan", () => {
  test("con 20 mesas activas, crear y activar muestran el mensaje; desactivar libera el cupo", async ({ page }) => {
    const t = await nuevoLocal("mesas-tope");
    const etiquetasLote = Array.from({ length: 20 }, (_, i) => `M${String(i + 1).padStart(2, "0")}`);
    const { branch } = await sembrarMesas(t, etiquetasLote);
    await service().from("tables").insert({ organization_id: t.orgId, branch_id: branch, label: "Guardada", is_active: false });

    await ingresar(page, t.owner, t);
    await expect(page.getByTestId("mesas-activas")).toContainText("20 de 20");
    await expect(page.getByTestId("aviso-tope")).toBeVisible();

    await page.getByLabel(/Nombre de la mesa en/).fill("M21");
    await page.getByRole("button", { name: "Agregar mesa" }).click();
    await expect(alerta(page)).toContainText("Llegaste al tope de 20 mesas activas en esta sucursal");
    await expect(page.getByLabel(/Nombre de la mesa en/)).toHaveValue("M21");

    await page.getByRole("button", { name: "Activar Guardada" }).click();
    await expect(mesa(page, "Guardada").getByRole("alert")).toContainText("Llegaste al tope de 20 mesas activas");
    await expect(mesa(page, "Guardada")).toContainText("Inactiva");

    await page.getByRole("button", { name: "Desactivar M01" }).click();
    await expect(page.getByTestId("mesas-activas")).toContainText("19 de 20");
    await page.getByRole("button", { name: "Activar Guardada" }).click();
    await expect(page.getByTestId("mesas-activas")).toContainText("20 de 20");
  });
});

test.describe("cuenta que no puede escribir", () => {
  for (const [nombre, estadoCuenta, texto] of [
    ["solo lectura", "read_only", "solo lectura"],
    ["suspendida", "suspended", "suspendida"],
  ] as const) {
    for (const rol of ["owner", "staff"] as const) {
      test(`${nombre}, ${rol}: se ven las mesas, no se pueden editar y una acción forzada no guarda ni dice que guardó`, async ({ page }) => {
        const t = await nuevoLocal(`mesas-${estadoCuenta.replace("_", "")}-${rol}`, estadoCuenta);
        const { mesas } = await sembrarMesas(t, ["Mesa 1"]);
        const antes = (await service().from("tables").select("label, is_active, qr_token").eq("organization_id", t.orgId)).data;
        await ingresar(page, t[rol], t);

        await expect(mesa(page, "Mesa 1")).toBeVisible();
        await expect(page.getByTestId("mesas-bloqueadas")).toContainText(texto);
        await expectNoHorizontalOverflow(page);
        for (const control of ["Desactivar Mesa 1"]) await expect(page.getByRole("button", { name: control })).toBeDisabled();
        await expect(page.getByRole("button", { name: "Agregar mesa" })).toBeDisabled();
        await expect(page.getByLabel(/Nombre de la mesa en/)).toBeDisabled();
        await expect(page.getByRole("link", { name: /Imprimir los QR de/ })).toBeVisible(); // leer sí se puede

        // Acción forzada 1: crear una mesa, con el campo habilitado a mano.
        await page.locator("form fieldset").first().evaluate((el: HTMLFieldSetElement) => (el.disabled = false));
        await page.getByLabel(/Nombre de la mesa en/).fill("Forzada");
        await page.getByRole("button", { name: "Agregar mesa" }).click();
        await expect(alerta(page).first()).toContainText(texto);

        // Acción forzada 2: desactivar.
        await page.getByRole("button", { name: "Desactivar Mesa 1" }).evaluate((el: HTMLButtonElement) => {
          const form = el.form!;
          const intent = document.createElement("input");
          intent.type = "hidden";
          intent.name = "intent";
          intent.value = "deactivate";
          form.append(intent);
          form.requestSubmit();
        });
        await expect(mesa(page, "Mesa 1").getByRole("alert")).toContainText(texto);
        await expect(mesa(page, "Mesa 1").getByRole("status")).toHaveCount(0);

        // Acción forzada 3: regenerar el QR, con el formulario habilitado a mano.
        await mesa(page, "Mesa 1").locator("summary", { hasText: "Regenerar QR" }).click();
        await mesa(page, "Mesa 1").locator("fieldset").nth(1).evaluate((el: HTMLFieldSetElement) => (el.disabled = false));
        await mesa(page, "Mesa 1").getByRole("button", { name: "Sí, regenerar" }).click();
        await expect(mesa(page, "Mesa 1").locator("form").last().getByRole("alert")).toContainText(texto);

        // Nada cambió, y el QR impreso sigue sirviendo.
        const despues = (await service().from("tables").select("label, is_active, qr_token").eq("organization_id", t.orgId)).data;
        expect(despues).toEqual(antes);
        expect((await page.goto(`/t/${mesas["Mesa 1"].qr_token}`))?.status()).toBe(200);
      });
    }
  }

  test("en gracia se edita con normalidad", async ({ page }) => {
    const t = await nuevoLocal("mesas-gracia", "grace");
    await sembrarMesas(t, ["Mesa 1"]);
    await ingresar(page, t.owner, t);
    await expect(page.getByTestId("mesas-bloqueadas")).toHaveCount(0);
    await page.getByRole("button", { name: "Desactivar Mesa 1" }).click();
    await expect(mesa(page, "Mesa 1")).toContainText("Inactiva");
  });
});

test.describe("acceso y aislamiento", () => {
  test("sin sesión pide ingresar; otro local recibe 404", async ({ page, context }) => {
    const a = await nuevoLocal("mesas-aislado-a");
    const b = await nuevoLocal("mesas-aislado-b");
    await sembrarMesas(b, ["Secreta"]);

    await page.goto(`/panel/${a.slug}/mesas`);
    await expect(page).toHaveURL(/\/login\?next=/);
    await context.clearCookies();

    await login(page, a.owner.email, a.owner.password);
    expect((await page.goto(`/panel/${b.slug}/mesas`))?.status()).toBe(404);
    await expect(page.getByText("Secreta")).toHaveCount(0);
    expect((await page.goto(`/panel/${b.slug}/mesas/imprimir/${await sucursalDe(b)}`))?.status()).toBe(404);
  });

  test("un formulario manipulado (local ajeno, sucursal ajena, mesa ajena) no escribe en el otro local", async ({ page }) => {
    const a = await nuevoLocal("mesas-manip-a");
    const b = await nuevoLocal("mesas-manip-b");
    const { mesas: mesasB } = await sembrarMesas(b, ["Ajena"]);
    const branchB = await sucursalDe(b);
    const antesB = (await service().from("tables").select("*").eq("organization_id", b.orgId)).data;
    await sembrarMesas(a, ["Mesa 1"]);
    await ingresar(page, a.owner, a);

    // 1) Cambia el campo oculto «org» por el local ajeno.
    await page.locator('form input[name="org"]').first().evaluate((el: HTMLInputElement, slug) => (el.value = slug), b.slug);
    await page.getByLabel(/Nombre de la mesa en/).fill("Intrusa");
    await page.getByRole("button", { name: "Agregar mesa" }).click();
    // La acción exige membresía del local pedido: para quien no la tiene es el mismo 404 de siempre
    // (y la base tampoco lo permitiría), no un mensaje del formulario.
    await expect(page.getByRole("heading", { name: "No encontramos esta carta" })).toBeVisible();

    // 2) En mi local, una sucursal que es del otro.
    await page.goto(`/panel/${a.slug}/mesas`);
    await page.locator('form input[name="branch"]').first().evaluate((el: HTMLInputElement, id) => (el.value = id), branchB);
    await page.getByLabel(/Nombre de la mesa en/).fill("Cruzada");
    await page.getByRole("button", { name: "Agregar mesa" }).click();
    await expect(alerta(page)).toContainText("Elegí una sucursal de tu local");

    // 3) En mi local, el id de una mesa del otro.
    await page.goto(`/panel/${a.slug}/mesas`);
    await mesa(page, "Mesa 1").locator('input[name="id"]').first().evaluate((el: HTMLInputElement, id) => (el.value = id), mesasB.Ajena.id);
    await mesa(page, "Mesa 1").getByRole("button", { name: "Desactivar Mesa 1" }).click();
    await expect(mesa(page, "Mesa 1").getByRole("alert")).toBeVisible();

    const despuesB = (await service().from("tables").select("*").eq("organization_id", b.orgId)).data;
    expect(despuesB).toEqual(antesB);
    expect((await service().from("tables").select("id").in("label", ["Intrusa", "Cruzada"])).data ?? []).toHaveLength(0);
  });
});

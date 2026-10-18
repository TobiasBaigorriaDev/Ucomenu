import { createClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createTenant, expectNoHorizontalOverflow, login, service, type Tenant } from "./support";

/**
 * Aviso de llamados con la pestaña cerrada (ficha aviso-push-de-llamados, ADR 0020): la pantalla de la sala, el permiso,
 * el registro del dispositivo en el servidor y la baja al cerrar sesión, contra el build y el Supabase local, a 390 px.
 *
 * El servicio de push real (FCM) no es alcanzable ni determinista desde una prueba: `PushManager.subscribe` se sustituye
 * por un doble que entrega una suscripción con forma válida. El envío al dispositivo se prueba aparte (pruebas unitarias del
 * envío y del service worker, y las de la base). La configuración de la prueba define solo la clave pública VAPID
 * (playwright.config.ts): la pantalla ofrece el aviso, pero el servidor no envía nada a la red.
 */

const tenants: Tenant[] = [];

async function nuevoLocal(label: string) {
  const t = await createTenant(label, "active");
  tenants.push(t);
  await service().from("subscriptions").update({ plan_code: "pro" }).eq("organization_id", t.orgId);
  return t;
}

test.afterAll(async () => {
  for (const t of tenants) await t.cleanup();
});

/**
 * Doble de `PushManager`: la suscripción vive en `sessionStorage` (sobrevive a recargas, como la real) y `unsubscribe` solo
 * cuenta, para poder comprobar desde el servidor que cerrar sesión quitó el dispositivo.
 */
async function conPushDoble(context: BrowserContext, permiso: "granted" | "denied" = "granted") {
  await context.addInitScript((respuesta) => {
    // Chromium sin interfaz informa `Notification.permission = "denied"` aunque se haya concedido: se sustituye por un doble
    // con el ciclo real (empieza en «default» y pasa a lo que responda la persona al pedirlo).
    let actual: NotificationPermission = "default";
    Object.defineProperty(Notification, "permission", { configurable: true, get: () => actual });
    Notification.requestPermission = async () => (actual = respuesta);

    // Cada PushManager recuerda de qué registro de service worker viene, para comprobar por cuál se suscribe la app.
    const w2 = window as unknown as { __alcances: string[] };
    w2.__alcances = [];
    const original = Object.getOwnPropertyDescriptor(ServiceWorkerRegistration.prototype, "pushManager")!;
    Object.defineProperty(ServiceWorkerRegistration.prototype, "pushManager", {
      configurable: true,
      get() {
        const manager = original.get!.call(this) as PushManager & { __alcance?: string };
        manager.__alcance = (this as ServiceWorkerRegistration).scope;
        return manager;
      },
    });

    const KEY = "e2e:push:id";
    const w = window as unknown as { __bajas: number };
    w.__bajas = 0;
    const make = (id: string, key: number[]) => {
      const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${id}`;
      return {
        endpoint,
        expirationTime: null,
        options: { applicationServerKey: new Uint8Array(key).buffer },
        toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } }),
        unsubscribe: async () => {
          w.__bajas += 1;
          return true;
        },
      };
    };
    PushManager.prototype.getSubscription = async () => {
      const id = sessionStorage.getItem(KEY);
      return id ? (make(id, JSON.parse(sessionStorage.getItem(KEY + ":clave") ?? "[]")) as unknown as PushSubscription) : null;
    };
    PushManager.prototype.subscribe = async function (this: PushManager & { __alcance?: string }, opciones?: PushSubscriptionOptionsInit) {
      w2.__alcances.push(this.__alcance ?? "?");
      const id = crypto.randomUUID();
      const clave = Array.from(new Uint8Array(opciones?.applicationServerKey as ArrayBuffer));
      sessionStorage.setItem(KEY, id);
      sessionStorage.setItem(KEY + ":clave", JSON.stringify(clave));
      return make(id, clave) as unknown as PushSubscription;
    };
  }, permiso);
}

async function abrirSala(page: Page, t: Tenant, persona: Tenant["staff"] = t.staff) {
  await login(page, persona.email, persona.password);
  await page.goto(`/sala/${t.slug}`);
  await expect(page.getByRole("heading", { name: "Sala en vivo" })).toBeVisible();
}

const activar = (page: Page) => page.getByRole("button", { name: "Avisarme aunque cierre la sala" });

test.describe("aviso con la pestaña cerrada", () => {
  test("el Staff lo activa con permiso, queda registrado en el servidor, sobrevive a recargar y se puede desactivar", async ({ browser }) => {
    const t = await nuevoLocal("push-activa");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await conPushDoble(context);
    const page = await context.newPage();
    await abrirSala(page, t);
    await expectNoHorizontalOverflow(page);

    await expect(activar(page)).toBeVisible();
    await expect(page.getByTestId("push-ayuda")).toContainText("aunque cierres la pestaña");
    await activar(page).click();
    await expect(page.getByTestId("push-activo")).toBeVisible();
    await expect(page.getByTestId("push-error")).toHaveCount(0);

    // El service worker del aviso quedó registrado con el alcance de la sala.
    const alcance = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration("/sala/"))?.scope);
    expect(alcance).toMatch(/\/sala\/$/);

    // Recargar: el estado sale del SERVIDOR (el dispositivo sigue registrado para este local).
    await page.reload();
    await expect(page.getByTestId("push-activo")).toBeVisible();

    await page.getByRole("button", { name: "Desactivar avisos" }).click();
    await expect(activar(page)).toBeVisible();
    await page.reload();
    await expect(activar(page)).toBeVisible();
    await expect(page.getByTestId("push-activo")).toHaveCount(0);
    await context.close();
  });

  test("también lo activa el Dueño, y activarlo en un local no lo activa en otro", async ({ browser }) => {
    const a = await nuevoLocal("push-dueno-a");
    const b = await nuevoLocal("push-dueno-b");
    // El Dueño de A pasa a ser también miembro de B: un dispositivo, dos locales.
    const sumar = await service().from("memberships").insert({ user_id: a.owner.id, organization_id: b.orgId, role: "staff" });
    expect(sumar.error).toBeNull();

    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await conPushDoble(context);
    const page = await context.newPage();
    await abrirSala(page, a, a.owner);
    await activar(page).click();
    await expect(page.getByTestId("push-activo")).toBeVisible();

    await page.goto(`/sala/${b.slug}`);
    await expect(page.getByRole("heading", { name: "Sala en vivo" })).toBeVisible();
    await expect(activar(page)).toBeVisible(); // mismo dispositivo y suscripción, pero este local no lo tiene registrado
    await context.close();
  });

  test("si se rotaron las claves del servidor, el dispositivo suscrito con la anterior no figura «activado» y se rehace al activar", async ({ browser }) => {
    const t = await nuevoLocal("push-rotacion");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await conPushDoble(context);
    const page = await context.newPage();
    await abrirSala(page, t);
    await activar(page).click();
    await expect(page.getByTestId("push-activo")).toBeVisible();
    const antes = await page.evaluate(() => sessionStorage.getItem("e2e:push:id"));

    // Se rotó el par VAPID: la suscripción guardada en el navegador quedó hecha con otra clave.
    await page.evaluate(() => sessionStorage.setItem("e2e:push:id:clave", JSON.stringify(Array.from({ length: 65 }, (_, i) => i))));
    await page.reload();
    await expect(activar(page)).toBeVisible();
    await expect(page.getByTestId("push-activo")).toHaveCount(0);

    await activar(page).click();
    await expect(page.getByTestId("push-activo")).toBeVisible();
    const despues = await page.evaluate(() => sessionStorage.getItem("e2e:push:id"));
    expect(despues).not.toBe(antes); // se volvió a suscribir con la clave actual
    await context.close();
  });

  test("rotación de claves con el cupo de 10 dispositivos lleno: reactivar libera el registro viejo y no recibe «límite»", async ({ browser }) => {
    const t = await nuevoLocal("push-rotacion-cupo");
    // Nueve dispositivos más de la misma persona, registrados por la puerta real (con su sesión).
    const otro = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
    expect((await otro.auth.signInWithPassword({ email: t.staff.email, password: t.staff.password })).error).toBeNull();
    for (let i = 0; i < 9; i++) {
      const r = await otro.rpc("register_push_subscription", {
        p_org: t.orgId,
        p_endpoint: `https://fcm.googleapis.com/fcm/send/e2e-cupo-${i}-${Date.now()}`,
        p_p256dh: "B".repeat(87),
        p_auth: "a".repeat(22),
      });
      expect(r.data).toBe("ok");
    }

    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await conPushDoble(context);
    const page = await context.newPage();
    await abrirSala(page, t);
    await activar(page).click(); // el décimo
    await expect(page.getByTestId("push-activo")).toBeVisible();

    await page.evaluate(() => sessionStorage.setItem("e2e:push:id:clave", JSON.stringify(Array.from({ length: 65 }, (_, i) => i))));
    await page.reload();
    await expect(activar(page)).toBeVisible();
    await activar(page).click();
    await expect(page.getByTestId("push-activo")).toBeVisible();
    await expect(page.getByTestId("push-error")).toHaveCount(0);
    await context.close();
  });

  test("si falla soltar el registro viejo tras rotar las claves, no se pierde la recuperación: el reintento lo suelta", async ({ browser }) => {
    const t = await nuevoLocal("push-rotacion-falla");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await conPushDoble(context);
    const page = await context.newPage();
    await abrirSala(page, t);
    await activar(page).click();
    await expect(page.getByTestId("push-activo")).toBeVisible();
    const viejo = await page.evaluate(() => sessionStorage.getItem("e2e:push:id"));

    await page.evaluate(() => sessionStorage.setItem("e2e:push:id:clave", JSON.stringify(Array.from({ length: 65 }, (_, i) => i))));
    await page.reload();
    await expect(activar(page)).toBeVisible();

    // La primera acción de servidor (la baja del registro viejo) falla en la red.
    let fallar = true;
    await page.route("**/sala/**", (route) => {
      if (fallar && route.request().method() === "POST") {
        fallar = false;
        return route.abort();
      }
      return route.continue();
    });
    await activar(page).click();
    await expect(page.getByTestId("push-error")).toBeVisible();
    // El navegador sigue con la suscripción vieja: no se dio de baja antes de poder soltar el registro del servidor.
    expect(await page.evaluate(() => (window as unknown as { __bajas: number }).__bajas)).toBe(0);
    expect(await page.evaluate(() => sessionStorage.getItem("e2e:push:id"))).toBe(viejo);

    await activar(page).click(); // reintento
    await expect(page.getByTestId("push-activo")).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem("e2e:push:id"))).not.toBe(viejo);
    await context.close();
  });

  test("con el service worker de OTRA app en el mismo origen (alcance «/»), el aviso se suscribe por el propio (alcance /sala/)", async ({ browser }) => {
    const t = await nuevoLocal("push-ajeno");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await conPushDoble(context);
    // Otra app que corrió antes en el mismo puerto dejó un service worker en «/».
    await context.route("**/sw-de-otra-app.js", (route) =>
      route.fulfill({ contentType: "text/javascript", body: "self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',(e)=>e.waitUntil(self.clients.claim()));" }),
    );
    const page = await context.newPage();
    await abrirSala(page, t);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/sw-de-otra-app.js", { scope: "/" });
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect(activar(page)).toBeVisible();

    await activar(page).click();
    await expect(page.getByTestId("push-activo")).toBeVisible();
    const alcances = await page.evaluate(() => (window as unknown as { __alcances: string[] }).__alcances);
    expect(alcances.length).toBeGreaterThan(0);
    for (const alcance of alcances) expect(alcance).toMatch(/\/sala\/$/); // nunca por el registro ajeno

    // Recargar: el estado también sale del registro propio.
    await page.reload();
    await expect(page.getByTestId("push-activo")).toBeVisible();
    await context.close();
  });

  test("si el navegador bloquea las notificaciones, lo explica y no registra nada", async ({ browser }) => {
    const t = await nuevoLocal("push-bloqueado");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await conPushDoble(context, "denied");
    const page = await context.newPage();
    await abrirSala(page, t);

    await activar(page).click();
    await expect(page.getByTestId("push-ayuda")).toContainText("Bloqueaste las notificaciones");
    await expect(activar(page)).toBeDisabled();
    await expect(page.getByTestId("push-activo")).toHaveCount(0);
    await context.close();
  });

  test("un navegador sin Push lo avisa en vez de fallar", async ({ browser }) => {
    const t = await nuevoLocal("push-sin-soporte");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(() => {
      Object.defineProperty(window, "PushManager", { configurable: true, value: undefined });
      delete (window as unknown as Record<string, unknown>).PushManager;
    });
    const page = await context.newPage();
    await abrirSala(page, t);
    await expect(page.getByTestId("push-ayuda")).toContainText("no puede mostrar avisos");
    await expect(activar(page)).toBeDisabled();
    await context.close();
  });

  test("con el plan Básico (la sala está apagada) no se ofrece el aviso", async ({ browser }) => {
    const t = await nuevoLocal("push-basico");
    await service().from("subscriptions").update({ plan_code: "basic" }).eq("organization_id", t.orgId);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await conPushDoble(context);
    const page = await context.newPage();
    await abrirSala(page, t);
    await expect(page.getByTestId("sala-deshabilitada")).toBeVisible();
    await expect(page.getByTestId("aviso-push")).toHaveCount(0);
    await context.close();
  });

  test("al salir, el dispositivo se suelta del aviso: otra persona que use la misma PC no lo hereda", async ({ browser }) => {
    const t = await nuevoLocal("push-salir");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await conPushDoble(context);
    const page = await context.newPage();
    await abrirSala(page, t);
    await activar(page).click();
    await expect(page.getByTestId("push-activo")).toBeVisible();

    await page.getByRole("button", { name: "Salir" }).click();
    await expect(page).toHaveURL(/\/login/);
    expect(await page.evaluate(() => (window as unknown as { __bajas: number }).__bajas)).toBe(1);

    // Vuelve a entrar con la MISMA suscripción del navegador: el servidor ya no la tiene registrada.
    await abrirSala(page, t);
    await expect(activar(page)).toBeVisible();
    await expect(page.getByTestId("push-activo")).toHaveCount(0);
    await context.close();
  });
});

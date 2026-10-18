import type { BrowserContext } from "@playwright/test";

/**
 * Doble de `PushManager`: la suscripción vive en `sessionStorage` (sobrevive a recargas, como la real) y `unsubscribe` solo
 * cuenta, para poder comprobar desde el servidor que cerrar sesión quitó el dispositivo.
 */
export async function conPushDoble(context: BrowserContext, permiso: "granted" | "denied" = "granted") {
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

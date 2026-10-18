/**
 * Registro del service worker de la sala en el navegador (solo cliente). El origen puede tener OTROS service workers de
 * otras apps (en desarrollo, otro proyecto que corrió antes en el mismo puerto; en producción, ninguno, pero no se
 * asume): `getRegistration(url)` y `ready` devuelven el que CONTROLA esa página, que puede ser ajeno. Si el push se
 * suscribiera por un registro ajeno, el aviso llegaría al navegador y lo recibiría el código de otra app. Por eso acá se
 * trabaja siempre con el registro propio: el de alcance `/sala/` y archivo `sala-sw.js`.
 */

export const SERVICE_WORKER_URL = "/sala-sw.js";
/** El alcance es la sala; el push llega igual al service worker aunque la pestaña esté cerrada. */
export const SERVICE_WORKER_SCOPE = "/sala/";

const isOwn = (registration: ServiceWorkerRegistration): boolean => {
  if (new URL(registration.scope).pathname !== SERVICE_WORKER_SCOPE) return false;
  const worker = registration.active ?? registration.waiting ?? registration.installing;
  return worker === null || new URL(worker.scriptURL).pathname === SERVICE_WORKER_URL;
};

/** El registro propio, o `null` si todavía no se registró. Nunca devuelve el de otra app. */
export async function findOwnRegistration(): Promise<ServiceWorkerRegistration | null> {
  const registrations = await navigator.serviceWorker.getRegistrations();
  return registrations.find(isOwn) ?? null;
}

/** Espera a que el registro tenga un worker activo (hace falta para suscribir al push). */
function whenActive(registration: ServiceWorkerRegistration): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = registration.installing ?? registration.waiting ?? registration.active;
    if (!worker) return reject(new Error("sin worker"));
    if (worker.state === "activated") return resolve();
    const onChange = () => {
      if (worker.state === "activated") {
        worker.removeEventListener("statechange", onChange);
        resolve();
      } else if (worker.state === "redundant") {
        worker.removeEventListener("statechange", onChange);
        reject(new Error("worker descartado"));
      }
    };
    worker.addEventListener("statechange", onChange);
  });
}

/** Registra (o recupera) el service worker propio y espera a que esté activo. Devuelve SU registro, no el de la página. */
export async function registerOwn(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: SERVICE_WORKER_SCOPE, updateViaCache: "none" });
  await whenActive(registration);
  return registration;
}

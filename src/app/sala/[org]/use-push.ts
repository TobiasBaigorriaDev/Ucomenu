"use client";

import { useCallback, useEffect, useState } from "react";
import { pushStatusAction, registerPushAction, unregisterPushAction } from "@/lib/push/actions";

/**
 * Aviso con la pestaña cerrada (Web Push) de ESTE dispositivo para ESTE local (ADR 0020). El dispositivo se registra por
 * local: activarlo en un local no lo activa en los demás. La suscripción del navegador es una sola por dispositivo; lo
 * que cambia por local es la fila en el servidor.
 */
export type PushState =
  | "checking" // todavía no se sabe
  | "unsupported" // el navegador no tiene Service Worker, Push o Notification
  | "off" // se puede activar
  | "on" // activado en este dispositivo
  | "denied" // el navegador bloqueó las notificaciones de este sitio
  | "working";

export const SERVICE_WORKER_URL = "/sala-sw.js";
/** El alcance es la sala; el push llega igual al service worker aunque la pestaña esté cerrada. */
export const SERVICE_WORKER_SCOPE = "/sala/";

/** El navegador a veces no responde al pedir la suscripción (sin red al servicio de push): se corta y se explica, no se queda en «Un momento…». */
const SUBSCRIBE_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const supported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** La clave pública VAPID viaja en base64url; el navegador la pide como bytes. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "=");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** ¿La suscripción del navegador se hizo con la clave VAPID actual? Si se rotó el par, la anterior ya no sirve. Sin dato, se asume que sí. */
function usesKey(subscription: PushSubscription, publicKey: string): boolean {
  const stored = subscription.options?.applicationServerKey;
  if (!stored) return true;
  const a = new Uint8Array(stored);
  const b = keyBytes(publicKey);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function usePush(slug: string, publicKey: string | null) {
  const [state, setState] = useState<PushState>("checking");
  const [message, setMessage] = useState("");

  // Estado inicial: ¿soporta?, ¿permiso?, ¿este dispositivo sigue registrado en el servidor para este local?
  useEffect(() => {
    if (!publicKey) return;
    let cancelled = false;
    const settle = (next: PushState) => {
      if (!cancelled) setState(next);
    };
    void (async () => {
      if (!supported()) return settle("unsupported");
      if (Notification.permission === "denied") return settle("denied");
      try {
        const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_SCOPE);
        const subscription = await registration?.pushManager.getSubscription();
        // Hecha con otra clave del servidor (se rotaron las claves VAPID): ya no recibe nada; se ofrece activar de nuevo.
        if (!subscription || !usesKey(subscription, publicKey)) return settle("off");
        const registered = await pushStatusAction(slug, subscription.endpoint);
        settle(registered ? "on" : "off");
      } catch {
        settle("off");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, publicKey]);

  const enable = useCallback(async () => {
    if (!publicKey || !supported()) return;
    setState("working");
    setMessage("");
    try {
      // Debe pedirse desde un toque de la persona (si no, el navegador lo ignora).
      const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }

      await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: SERVICE_WORKER_SCOPE, updateViaCache: "none" });
      const registration = await withTimeout(navigator.serviceWorker.ready, SUBSCRIBE_TIMEOUT_MS);
      const options = { userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) };

      let subscription = await registration.pushManager.getSubscription();
      if (subscription && !usesKey(subscription, publicKey)) {
        await subscription.unsubscribe();
        subscription = null;
      }
      if (!subscription) {
        subscription = await withTimeout(registration.pushManager.subscribe(options), SUBSCRIBE_TIMEOUT_MS);
      }

      let result = await registerPushAction(slug, subscription.toJSON());
      if (result.status === "invalid") {
        // Una suscripción hecha con otra clave del servidor (se cambiaron las claves) no sirve: se rehace una vez.
        await subscription.unsubscribe();
        subscription = await withTimeout(registration.pushManager.subscribe(options), SUBSCRIBE_TIMEOUT_MS);
        result = await registerPushAction(slug, subscription.toJSON());
      }

      if (result.status === "ok") {
        setState("on");
        return;
      }
      setState("off");
      setMessage(
        result.status === "unavailable"
          ? "El plan o la cuenta de este local no permiten el aviso ahora."
          : result.status === "limit"
            ? "Ya tenés demasiados dispositivos activados en este local. Desactivá alguno e intentá de nuevo."
            : "No se pudo activar el aviso. Probá de nuevo en un momento.",
      );
    } catch {
      setState(Notification.permission === "denied" ? "denied" : "off");
      setMessage("El navegador no pudo activar el aviso (puede no tener conexión con el servicio de notificaciones). Probá de nuevo en un momento.");
    }
  }, [publicKey, slug]);

  const disable = useCallback(async () => {
    setState("working");
    setMessage("");
    try {
      const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_SCOPE);
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const removed = await unregisterPushAction(slug, subscription.endpoint);
        if (!removed) {
          setState("on");
          setMessage("No se pudo desactivar. Probá de nuevo.");
          return;
        }
      }
      setState("off");
    } catch {
      setState("on");
      setMessage("No se pudo desactivar. Probá de nuevo.");
    }
  }, [slug]);

  return { state, message, enable, disable };
}

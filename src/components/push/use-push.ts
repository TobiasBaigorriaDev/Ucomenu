"use client";

import { useCallback, useEffect, useState } from "react";
import { pushStatusAction, registerPushAction, unregisterPushAction } from "@/lib/push/actions";
import { isAppleMobile, isInstalledApp } from "@/lib/push/platform";
import { findOwnRegistration, registerOwn } from "@/lib/push/registration";

/**
 * Aviso con la pestaña cerrada (Web Push) de ESTE dispositivo para ESTE local (ADR 0020). El dispositivo se registra por
 * local: activarlo en un local no lo activa en los demás. La suscripción del navegador es una sola por dispositivo; lo
 * que cambia por local es la fila en el servidor.
 */
export type PushState =
  | "checking" // todavía no se sabe
  | "unsupported" // el navegador no tiene Service Worker, Push o Notification
  | "install" // iPhone o iPad en una pestaña de Safari: Apple solo entrega avisos a la app instalada en la pantalla de inicio
  | "ios-old" // la app instalada en un iPhone o iPad sin Web Push (anterior a iOS/iPadOS 16.4)
  | "off" // se puede activar
  | "on" // activado en este dispositivo
  | "denied" // el navegador bloqueó las notificaciones de este sitio
  | "working";

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

/** Por qué no se puede activar aquí. Apple tiene su propio camino: instalar la app y, en las versiones viejas, no hay Push. */
function unsupportedReason(): PushState {
  if (!isAppleMobile(navigator.userAgent, navigator.maxTouchPoints ?? 0)) return "unsupported";
  const installed = isInstalledApp((navigator as Navigator & { standalone?: boolean }).standalone, window.matchMedia?.("(display-mode: standalone)").matches === true);
  return installed ? "ios-old" : "install";
}

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
      if (!supported()) return settle(unsupportedReason());
      if (Notification.permission === "denied") return settle("denied");
      try {
        const registration = await findOwnRegistration();
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

      // Siempre el registro PROPIO (no `ready`, que devuelve el que controla la página y puede ser de otra app del mismo origen).
      const registration = await withTimeout(registerOwn(), SUBSCRIBE_TIMEOUT_MS);
      const options = { userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) };
      // Si no se puede soltar el registro viejo del servidor, no se toca la suscripción del navegador: así el reintento
      // vuelve a pasar por acá (con la clave actual ya no habría nada que soltar y el cupo lleno rechazaría el alta).
      const releaseFailed = () => {
        setState("off");
        setMessage("No se pudo soltar el registro anterior de este dispositivo. Probá de nuevo en un momento.");
      };

      let subscription = await registration.pushManager.getSubscription();
      if (subscription && !usesKey(subscription, publicKey)) {
        // Se suelta primero la fila vieja del servidor: si no, con el cupo lleno (10 dispositivos) la nueva recibiría «límite».
        if (!(await unregisterPushAction(slug, subscription.endpoint))) return releaseFailed();
        await subscription.unsubscribe();
        subscription = null;
      }
      if (!subscription) {
        subscription = await withTimeout(registration.pushManager.subscribe(options), SUBSCRIBE_TIMEOUT_MS);
      }

      let result = await registerPushAction(slug, subscription.toJSON());
      if (result.status === "invalid") {
        // Una suscripción hecha con otra clave del servidor (se cambiaron las claves) no sirve: se rehace una vez.
        if (!(await unregisterPushAction(slug, subscription.endpoint))) return releaseFailed();
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
      const registration = await findOwnRegistration();
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

"use client";

import { logoutAction } from "@/lib/auth/actions";
import { forgetPushDeviceAction } from "@/lib/push/actions";

/**
 * «Salir». Antes de cerrar la sesión suelta el aviso con la pestaña cerrada de ESTE dispositivo (ADR 0020): si no, el
 * dispositivo seguiría recibiendo los llamados de una persona que ya salió. Es de mejor esfuerzo: si algo falla,
 * igual se cierra la sesión (y, si la persona deja de ser miembro, la base ya no le manda nada).
 */
async function forgetThisDevice(): Promise<void> {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    const registration = await navigator.serviceWorker.getRegistration("/sala/");
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    await forgetPushDeviceAction(subscription.endpoint);
    await subscription.unsubscribe();
  } catch {
    // Sin soporte, sin sesión o sin red: se sale igual.
  }
}

export function LogoutForm({ buttonClassName }: { buttonClassName: string }) {
  return (
    <form
      action={async () => {
        await forgetThisDevice();
        await logoutAction();
      }}
      className="lg:contents"
    >
      <button type="submit" className={buttonClassName}>
        Salir
      </button>
    </form>
  );
}

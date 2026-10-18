import "server-only";
import { sendNotification } from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CallKind } from "@/lib/sala/types";
import { vapidConfig } from "./config";
import { dispatchCallPush, type PushSend } from "./dispatch";

/**
 * Avisa por Web Push de un llamado recién creado. Se llama desde `after()` en la acción pública del comensal, así que
 * no demora su respuesta. Sin claves VAPID no hace nada. Usa `service_role` SOLO para dos funciones de base
 * (`push_targets_for_call` y `drop_push_subscriptions`); ver ADR 0020. No lanza nunca.
 */
export async function notifyCallPush(token: string, kind: CallKind): Promise<void> {
  const vapid = vapidConfig();
  if (!vapid) return;
  try {
    const send: PushSend = (subscription, payload, options) =>
      sendNotification(subscription, payload, {
        ...options,
        vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
      });
    await dispatchCallPush(createAdminClient(), send, token, kind);
  } catch (error) {
    console.error(`El aviso push no pudo iniciarse: ${error instanceof Error ? error.message : "error desconocido"}`);
  }
}

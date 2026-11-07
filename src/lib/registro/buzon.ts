import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Cuentas creadas por un Dueño (ficha cuentas-creadas-por-duenos, auditoría run-2 2026-11-07).
 *
 * `createMember` crea al personal con el email «confirmado» y una contraseña que conoce el Dueño, aunque nadie probó que el buzón sea de esa
 * persona. Esas cuentas llevan `app_metadata.mailbox = "unverified"` (solo la clave de servicio escribe `app_metadata`). Cuando la persona
 * prueba su correo, con un enlace o con Google, la contraseña del Dueño se reemplaza por una al azar y la marca pasa a `verified`: desde
 * ahí el Dueño ya no puede volver a poner una contraseña conocida (ver `resetMemberPassword`).
 */

export const MAILBOX_UNVERIFIED = "unverified";
export const MAILBOX_VERIFIED = "verified";

type Db = SupabaseClient<Database>;

export function mailboxState(appMetadata: unknown): string | null {
  if (typeof appMetadata !== "object" || appMetadata === null) return null;
  const value = (appMetadata as { mailbox?: unknown }).mailbox;
  return typeof value === "string" ? value : null;
}

/** ¿La cuenta la creó un Dueño y todavía nadie probó el buzón? */
export const isUnverifiedMailbox = (appMetadata: unknown): boolean => mailboxState(appMetadata) === MAILBOX_UNVERIFIED;

/** Contraseña al azar de 43 caracteres: nadie la conoce, la persona elige la suya después. */
export function throwawayPassword(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Reemplaza la contraseña ajena de una cuenta que nació de un Dueño: (1) contraseña al azar, (2) marca `verified`. Cambiar la contraseña
 * desde el servidor hace que Auth cierre TODAS las sesiones de la cuenta (la del Dueño y también la que acaba de abrir la persona): quien
 * llama tiene que abrir una sesión nueva después. Si falla entre los dos pasos la cuenta sigue `unverified` y el próximo enlace lo
 * reintenta. Devuelve `true` si hubo que reemplazarla, `false` si la cuenta no lo necesitaba; lanza si falla.
 */
export async function claimMailboxIfProvisioned(admin: Db, user: { id: string; app_metadata?: unknown }): Promise<boolean> {
  if (!isUnverifiedMailbox(user.app_metadata)) return false;

  const replaced = await admin.auth.admin.updateUserById(user.id, { password: throwawayPassword() });
  if (replaced.error) throw new Error("mailbox_claim_failed");
  const marked = await admin.auth.admin.updateUserById(user.id, { app_metadata: { mailbox: MAILBOX_VERIFIED } });
  if (marked.error) throw new Error("mailbox_claim_failed");
  return true;
}

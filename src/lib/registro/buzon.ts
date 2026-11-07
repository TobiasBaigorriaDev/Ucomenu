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
 * Reemplaza la contraseña ajena de una cuenta que nació de un Dueño, en este orden: (1) contraseña al azar, (2) `revokeOthers` cierra las
 * demás sesiones (tiene que lanzar si falla) y (3) recién entonces la marca pasa a `verified`. Si algo falla en el medio la cuenta sigue
 * `unverified` y el próximo enlace lo reintenta; nunca queda marcada como verificada con sesiones del Dueño vivas. Devuelve `true` si
 * hubo que reemplazarla, `false` si la cuenta no lo necesitaba. Lanza si falla: quien llama tiene que cortar la sesión (falla cerrado).
 */
export async function claimMailboxIfProvisioned(
  admin: Db,
  user: { id: string; app_metadata?: unknown },
  revokeOthers: () => Promise<void>,
): Promise<boolean> {
  if (!isUnverifiedMailbox(user.app_metadata)) return false;

  const replaced = await admin.auth.admin.updateUserById(user.id, { password: throwawayPassword() });
  if (replaced.error) throw new Error("mailbox_claim_failed");
  await revokeOthers();
  const marked = await admin.auth.admin.updateUserById(user.id, { app_metadata: { mailbox: MAILBOX_VERIFIED } });
  if (marked.error) throw new Error("mailbox_claim_failed");
  return true;
}

import { createAdminClient } from "@/lib/supabase/admin";
import type { createSessionClient } from "@/lib/supabase/server";
import { claimMailboxIfProvisioned, isUnverifiedMailbox } from "./buzon";

type SessionClient = Awaited<ReturnType<typeof createSessionClient>>;

/**
 * Se llama cuando una sesión nueva prueba el correo (enlace o Google). `none`: la cuenta no nació de un Dueño, no se toca nada (ni se
 * pide la clave de servicio). `claimed`: su contraseña se reemplazó y las demás sesiones se cerraron. `failed`: no se pudo; la sesión se
 * cierra, porque la cuenta seguiría con la contraseña del Dueño. Falla cerrado también si falta la clave de servicio.
 */
export async function claimProvisionedMailbox(
  session: SessionClient,
  user: { id: string; app_metadata?: unknown },
): Promise<"none" | "claimed" | "failed"> {
  if (!isUnverifiedMailbox(user.app_metadata)) return "none";
  try {
    await claimMailboxIfProvisioned(createAdminClient(), user, async () => {
      // `signOut` no lanza: devuelve el error. Si no se cerraron las sesiones del Dueño, no se da la cuenta por reclamada.
      const { error } = await session.auth.signOut({ scope: "others" });
      if (error) throw new Error("revoke_failed");
    });
    return "claimed";
  } catch {
    console.error("[registro] no se pudo reemplazar la contraseña de una cuenta creada por un Dueño", { userId: user.id });
    await session.auth.signOut();
    return "failed";
  }
}

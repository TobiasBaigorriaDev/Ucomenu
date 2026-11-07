import { createAdminClient } from "@/lib/supabase/admin";
import type { createSessionClient } from "@/lib/supabase/server";
import { claimMailboxIfProvisioned, isUnverifiedMailbox } from "./buzon";

type SessionClient = Awaited<ReturnType<typeof createSessionClient>>;

/**
 * Se llama cuando una sesión nueva prueba el correo (enlace o Google). `none`: la cuenta no nació de un Dueño, no se toca nada (ni se
 * pide la clave de servicio). `claimed`: su contraseña se reemplazó (Auth cierra todas sus sesiones, también la de la persona) y se abrió
 * una sesión nueva para ella. `failed`: no se pudo; la sesión se cierra y la persona pide otro enlace. Falla cerrado también si falta la
 * clave de servicio.
 */
export async function claimProvisionedMailbox(
  session: SessionClient,
  user: { id: string; email?: string; app_metadata?: unknown },
): Promise<"none" | "claimed" | "failed"> {
  if (!isUnverifiedMailbox(user.app_metadata)) return "none";
  try {
    if (!user.email) throw new Error("sin_email");
    const admin = createAdminClient();
    await claimMailboxIfProvisioned(admin, user);

    // La sesión con la que llegó la persona ya no existe: se abre otra con un enlace que genera el servidor para esta misma cuenta.
    const link = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
    const tokenHash = link.data?.properties?.hashed_token;
    if (link.error || !tokenHash) throw new Error("sin_enlace");
    const { error } = await session.auth.verifyOtp({ token_hash: tokenHash, type: "email" });
    if (error) throw new Error("sin_sesion");
    return "claimed";
  } catch {
    console.error("[registro] no se pudo reemplazar la contraseña de una cuenta creada por un Dueño", { userId: user.id });
    await session.auth.signOut().catch(() => undefined);
    return "failed";
  }
}

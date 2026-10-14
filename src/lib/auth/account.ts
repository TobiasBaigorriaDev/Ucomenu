import type { SupabaseClient } from "@supabase/supabase-js";
import { validatePassword, type PasswordProblem } from "@/lib/auth/validation";
import type { Database } from "@/lib/supabase/database.types";

type Db = SupabaseClient<Database>;

export type AccountError = PasswordProblem | "unauthenticated" | "wrong_current" | "same_password" | "unexpected";

export const ACCOUNT_ERROR_MESSAGE: Record<AccountError, string> = {
  blank: "Ingresá una contraseña.",
  too_short: "La contraseña nueva tiene que tener al menos 10 caracteres.",
  too_long: "La contraseña nueva es demasiado larga (máximo 72 bytes).",
  unauthenticated: "Tu sesión venció. Ingresá de nuevo.",
  wrong_current: "La contraseña actual no es correcta.",
  same_password: "La contraseña nueva tiene que ser distinta de la actual.",
  unexpected: "No se pudo cambiar la contraseña. Probá de nuevo en unos minutos.",
};

/**
 * Cambia la contraseña de la persona con sesión. Pide la actual (se verifica con un cliente aparte,
 * sin sesión propia, para no tocar la cookie) y actualiza con el cliente de la sesión.
 */
export async function changeOwnPassword(
  deps: { session: Db; verifier: Db },
  input: { current: string; next: string },
): Promise<{ ok: true } | { ok: false; error: AccountError }> {
  const weak = validatePassword(input.next);
  if (weak) return { ok: false, error: weak };
  if (input.next === input.current) return { ok: false, error: "same_password" };

  const { data, error } = await deps.session.auth.getUser();
  const email = data.user?.email;
  if (error || !email) return { ok: false, error: "unauthenticated" };

  const verified = await deps.verifier.auth.signInWithPassword({ email, password: input.current });
  if (verified.error) {
    return { ok: false, error: verified.error.code === "invalid_credentials" ? "wrong_current" : "unexpected" };
  }
  await deps.verifier.auth.signOut({ scope: "local" });

  const updated = await deps.session.auth.updateUser({ password: input.next });
  if (updated.error) {
    if (updated.error.code === "same_password") return { ok: false, error: "same_password" };
    if (updated.error.code === "weak_password") return { ok: false, error: "too_short" };
    return { ok: false, error: "unexpected" };
  }
  return { ok: true };
}

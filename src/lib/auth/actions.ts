"use server";

import { redirect } from "next/navigation";
import { changeOwnPassword, ACCOUNT_ERROR_MESSAGE } from "@/lib/auth/account";
import { postLoginPath, requireUser } from "@/lib/auth/session";
import { normalizeEmail, safeNext } from "@/lib/auth/validation";
import type { FormState } from "@/lib/form-state";
import { createPublicClient } from "@/lib/supabase/public-client";
import { createSessionClient } from "@/lib/supabase/server";

const GENERIC_LOGIN_ERROR = "Email o contraseña incorrectos.";

/**
 * Login con email y contraseña. El mensaje de error es el mismo para cuenta inexistente y para
 * contraseña errónea (no revela qué emails existen).
 */
export async function loginAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const email = normalizeEmail(formData.get("email"));
  const password = formData.get("password");
  const next = safeNext(formData.get("next"));

  if (!email || typeof password !== "string" || password.length === 0) {
    return { error: GENERIC_LOGIN_ERROR, values: { email: typeof formData.get("email") === "string" ? String(formData.get("email")) : "" } };
  }

  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    const limited = error.code === "over_request_rate_limit" || error.status === 429;
    return {
      error: limited ? "Demasiados intentos. Probá de nuevo en unos minutos." : GENERIC_LOGIN_ERROR,
      values: { email },
    };
  }

  redirect(await postLoginPath(data.user.id, next, supabase));
}

/** Cierra solo esta sesión (otros dispositivos de la persona siguen abiertos). */
export async function logoutAction(): Promise<void> {
  const supabase = await createSessionClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}

/** Cambio de la contraseña propia. Pide la actual. */
export async function changePasswordAction(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireUser("/cuenta");

  const current = formData.get("current");
  const next = formData.get("next");
  const repeat = formData.get("repeat");
  if (typeof current !== "string" || typeof next !== "string" || typeof repeat !== "string") {
    return { error: ACCOUNT_ERROR_MESSAGE.unexpected };
  }
  if (next !== repeat) return { error: "La contraseña nueva y su repetición no coinciden." };

  const result = await changeOwnPassword(
    { session: await createSessionClient(), verifier: createPublicClient() },
    { current, next },
  );
  if (!result.ok) return { error: ACCOUNT_ERROR_MESSAGE[result.error] };
  return { ok: true, message: "Listo, cambiaste tu contraseña." };
}

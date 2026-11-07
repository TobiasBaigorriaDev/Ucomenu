"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { postLoginPath, requireUser } from "@/lib/auth/session";
import { normalizeEmail, PASSWORD_PROBLEM_MESSAGE, validatePassword } from "@/lib/auth/validation";
import { turnstileState, verifyTurnstile } from "@/lib/auth/turnstile";
import { siteBaseUrl } from "@/lib/cobro/mercadopago";
import type { FormState } from "@/lib/form-state";
import { createPublicClient } from "@/lib/supabase/public-client";
import { createSessionClient } from "@/lib/supabase/server";
import { claimProvisionedMailbox } from "./buzon-sesion";
import { authMethods, cameFromEmailLink, parseLinkType, parseTokenHash } from "./registro";

/**
 * Entrada de las cuentas (ficha registro-autoservicio, ADR 0053). Las respuestas de registro y recupero son iguales exista o no la
 * cuenta. La contraseña se elige recién después de probar el correo.
 */

const HUMAN_CHECK_FAILED = "No pudimos comprobar que seas una persona. Probá de nuevo.";
const TOO_MANY = "Demasiados pedidos. Probá de nuevo en unos minutos.";
const NOT_SENT = "No pudimos enviar el correo. Probá de nuevo en unos minutos.";

async function passesHumanCheck(formData: FormData): Promise<boolean> {
  const state = turnstileState();
  if (state.status === "off") return true;
  if (state.status === "misconfigured") {
    console.error("[registro] Turnstile a medias: falta TURNSTILE_SITE_KEY o TURNSTILE_SECRET_KEY");
    return false;
  }
  const ip = (await headers()).get("fly-client-ip");
  return verifyTurnstile(formData.get("cf-turnstile-response"), state.secret, ip);
}

/** Un límite por email es un pedido repetido: se responde igual para no revelar nada. Solo cambia si falló para todos. */
function mailFailure(error: { code?: string; status?: number; name?: string }): string | null {
  if (error.code === "over_email_send_rate_limit") return null;
  if (error.code === "over_request_rate_limit" || error.status === 429) return TOO_MANY;
  console.error(`[registro] Auth no pudo enviar el correo: ${error.name ?? "error"} (${error.status ?? "sin estado"})`);
  return NOT_SENT;
}

/** `/registro`: manda el enlace. Una cuenta que ya existe recibe un enlace para entrar a ella. */
export async function requestSignupAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const raw = formData.get("email");
  const email = normalizeEmail(raw);
  if (!email) return { error: "Revisá el email: no parece válido.", values: { email: typeof raw === "string" ? raw : "" } };
  if (!(await passesHumanCheck(formData))) return { error: HUMAN_CHECK_FAILED, values: { email } };

  const { error } = await createPublicClient().auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  const failure = error ? mailFailure(error) : null;
  if (failure) return { error: failure, values: { email } };
  return { ok: true, message: `Te mandamos un enlace a ${email}. Revisá tu correo y también el spam. Vence en una hora.` };
}

/** `/recuperar`: manda el enlace para elegir una contraseña nueva. No crea cuentas. */
export async function requestRecoveryAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const raw = formData.get("email");
  const email = normalizeEmail(raw);
  if (!email) return { error: "Revisá el email: no parece válido.", values: { email: typeof raw === "string" ? raw : "" } };
  if (!(await passesHumanCheck(formData))) return { error: HUMAN_CHECK_FAILED, values: { email } };

  const { error } = await createPublicClient().auth.resetPasswordForEmail(email);
  const failure = error ? mailFailure(error) : null;
  if (failure) return { error: failure, values: { email } };
  return { ok: true, message: "Si ese email tiene una cuenta, te mandamos un enlace. Revisá tu correo y también el spam. Vence en una hora." };
}

/**
 * `/auth/confirmar`: gasta el token. Corre con el botón, no al abrir la página: los antivirus de correo abren los enlaces y lo gastarían
 * antes que la persona.
 */
export async function confirmLinkAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const expired = "Este enlace venció o ya se usó. Pedí otro.";
  const tokenHash = parseTokenHash(formData.get("token_hash"));
  const type = parseLinkType(formData.get("type"));
  if (!tokenHash || !type) return { error: expired };

  const session = await createSessionClient();
  const { data, error } = await session.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error || !data.user) return { error: expired };

  // Una cuenta que creó un Dueño tiene la contraseña del Dueño: al probar el correo se reemplaza y la persona elige la suya.
  const claimed = await claimProvisionedMailbox(session, data.user);
  if (claimed === "failed") return { error: "No pudimos terminar de confirmar tu correo. Probá de nuevo en unos minutos." };

  redirect(type === "recovery" || claimed === "claimed" ? "/cuenta/nueva-contrasena" : await postLoginPath(data.user.id, null, session));
}

/** Empieza el ingreso con Google. El verificador PKCE queda en una cookie: un retorno ajeno no inicia sesión. */
export async function googleLoginAction(): Promise<void> {
  const requestHeaders = await headers();
  const base = siteBaseUrl() ?? `${requestHeaders.get("x-forwarded-proto") ?? "http"}://${requestHeaders.get("host")}`;
  const session = await createSessionClient();
  const { data, error } = await session.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${base}/auth/callback` },
  });
  if (error || !data.url) {
    console.error(`[registro] no se pudo iniciar el ingreso con Google: ${error?.name ?? "sin dirección"}`);
    redirect("/login?aviso=google");
  }
  redirect(data.url);
}

/** Elegir una contraseña desde un enlace por correo. Cierra las demás sesiones: si había otra persona adentro, deja de estarlo. */
export async function setNewPasswordAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/cuenta/nueva-contrasena");
  const session = await createSessionClient();
  const { data: claims } = await session.auth.getClaims();
  if (!cameFromEmailLink(authMethods(claims?.claims?.amr))) redirect("/cuenta");

  const password = formData.get("password");
  const repeat = formData.get("repeat");
  if (typeof password !== "string" || typeof repeat !== "string") return { error: PASSWORD_PROBLEM_MESSAGE.blank };
  const weak = validatePassword(password);
  if (weak) return { error: PASSWORD_PROBLEM_MESSAGE[weak] };
  if (password !== repeat) return { error: "La contraseña y su repetición no coinciden." };

  const { error } = await session.auth.updateUser({ password });
  if (error && error.code !== "same_password") {
    return { error: error.code === "weak_password" ? PASSWORD_PROBLEM_MESSAGE.too_short : "No pudimos guardar la contraseña. Probá de nuevo en unos minutos." };
  }
  await session.auth.signOut({ scope: "others" });
  redirect(await postLoginPath(user.id, null, session));
}

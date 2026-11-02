/**
 * Cloudflare Turnstile, verificado por el servidor de la app en `/registro` y `/recuperar` (ADR 0053). No se usa el captcha de Auth
 * porque también se exigiría en cada login. Sin las dos claves está apagado (local y E2E); con una sola, falla cerrado.
 */

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileState = { status: "off" } | { status: "misconfigured" } | { status: "on"; siteKey: string; secret: string };

export function turnstileState(env: Record<string, string | undefined> = process.env): TurnstileState {
  const siteKey = env.TURNSTILE_SITE_KEY?.trim();
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  if (!siteKey && !secret) return { status: "off" };
  if (!siteKey || !secret) return { status: "misconfigured" };
  return { status: "on", siteKey, secret };
}

/** ¿Cloudflare acepta este token? Sin respuesta clara es «no»: un registro de más cuesta más que pedir que reintente. */
export async function verifyTurnstile(
  token: unknown,
  secret: string,
  remoteIp: string | null,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) return false;
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);
  try {
    const response = await fetcher(SITEVERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(5000) });
    if (!response.ok) return false;
    const data: unknown = await response.json();
    return typeof data === "object" && data !== null && (data as { success?: unknown }).success === true;
  } catch {
    return false;
  }
}

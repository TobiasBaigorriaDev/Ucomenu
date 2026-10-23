import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "@/lib/analitica/registrar";
import { clientIpFrom, clientSecret } from "@/lib/llamados/client-key";
import { isToken } from "@/lib/mesas/url";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Likes anónimos del feed (ficha likes-del-feed, ADR 0031). La autoridad es `set_video_like` (la única puerta de escritura de
 * `video_likes`): este módulo arma las claves que la base espera, llama a la función con el cliente de servicio (ADR 0038) y lee su respuesta.
 *
 * Nada que identifique al comensal llega a la base: el navegador guarda un código aleatorio (`DEVICE_CODE`) y el servidor manda
 * solo su HMAC (`device_key`); el límite por conexión usa el HMAC de la IP (`rate_key`), con un prefijo propio para que no se
 * pueda cruzar con el `client_key` de los llamados. La IP y el código crudo no se guardan ni se registran.
 */

type Db = SupabaseClient<Database>;

/** El código aleatorio que guarda el navegador: 128 bits en 32 hex. */
export const DEVICE_CODE = /^[0-9a-f]{32}$/;
export const isDeviceCode = (value: unknown): value is string => typeof value === "string" && DEVICE_CODE.test(value);

/** HMAC de 32 hex con un prefijo de dominio: el mismo valor da claves distintas en likes y comentarios. */
export const hmac = (secret: string, domain: string, value: string): string => createHmac("sha256", secret).update(`${domain}:${value}`).digest("hex").slice(0, 32);

/** El `device_key` del código del navegador, o `null` si no tiene la forma esperada. */
export function deviceKeyFrom(code: unknown, secret: string = clientSecret()): string | null {
  return isDeviceCode(code) ? hmac(secret, "like-device", code) : null;
}

/** El `rate_key` de la conexión del pedido, o `null` si no hay una IP utilizable (entonces no hay límite por conexión). */
export function rateKeyFrom(headers: { get(name: string): string | null }, secret: string = clientSecret()): string | null {
  const ip = clientIpFrom(headers);
  return ip ? hmac(secret, "like-ip", ip) : null;
}

export type LikeResult =
  | { status: "ok"; liked: boolean; count: number }
  | { status: "rate_limited"; retryAfterSeconds: number }
  /** La cuenta de la mesa ya se atendió después de este ticket: hay que escanear de nuevo. */
  | { status: "session_closed" }
  | { status: "unavailable" }
  | { status: "not_found" };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Lee la respuesta de la función. Cualquier forma inesperada es «no disponible» (falla cerrado). */
export function parseLikeResult(raw: unknown): LikeResult {
  if (!isRecord(raw)) return { status: "unavailable" };
  switch (raw.status) {
    case "ok": {
      const { liked, count } = raw;
      return typeof liked === "boolean" && typeof count === "number" && Number.isInteger(count) && count >= 0 ? { status: "ok", liked, count } : { status: "unavailable" };
    }
    case "session_closed":
    case "unavailable":
    case "not_found":
      return { status: raw.status };
    case "rate_limited": {
      const seconds = raw.retry_after_seconds;
      return typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 1 ? { status: "rate_limited", retryAfterSeconds: Math.ceil(seconds) } : { status: "unavailable" };
    }
    default:
      return { status: "unavailable" };
  }
}

/**
 * Pone (`liked = true`) o quita (`false`) el like de un dispositivo en un video. Entra con el cliente de servicio (ADR 0038). Un token, un video
 * o una clave imposibles no llegan a la base. Cualquier error de red o de la base es «no disponible» para el comensal y se registra
 * SIN IP, token ni claves.
 */
export async function setVideoLike(
  db: Db,
  token: unknown,
  videoId: unknown,
  liked: boolean,
  deviceKey: string | null,
  rateKey: string | null,
  visitStartedAt: Date | null = null,
): Promise<LikeResult> {
  if (!isToken(token) || !isUuid(videoId) || !deviceKey) return { status: "not_found" };

  try {
    const { data, error } = await db.rpc("set_video_like", {
      p_token: token,
      p_video: videoId,
      p_liked: liked,
      p_device: deviceKey,
      ...(rateKey ? { p_rate: rateKey } : {}),
      ...(visitStartedAt ? { p_visit_started_at: visitStartedAt.toISOString() } : {}),
    });
    if (error) {
      console.error(`set_video_like falló (${error.code ?? "sin código"}): ${error.message}`);
      return { status: "unavailable" };
    }
    return parseLikeResult(data);
  } catch (error) {
    console.error(`set_video_like falló: ${error instanceof Error ? error.message : "error desconocido"}`);
    return { status: "unavailable" };
  }
}

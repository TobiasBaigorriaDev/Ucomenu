import { BASE_LANG, type Lang } from "@/lib/idiomas/idiomas";
import { TEXTOS } from "@/lib/idiomas/textos";

/** Resultado de `create_waiter_call` y los mensajes que ve el comensal. Puro: se prueba en `llamados.test.ts`. */

export type CallKind = "waiter" | "bill";

export const isCallKind = (value: unknown): value is CallKind => value === "waiter" || value === "bill";

export type CallResult =
  | { status: "created" }
  | { status: "already_pending" }
  | { status: "cooldown"; retryAfterSeconds: number }
  | { status: "rate_limited"; retryAfterSeconds: number }
  | { status: "unavailable" }
  | { status: "not_found" }
  /** El personal atendió la cuenta de esta mesa después de emitido el ticket de visita: hay que escanear de nuevo. */
  | { status: "session_closed" };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Lee la respuesta de la función. Cualquier forma inesperada es «no disponible» (falla cerrado). */
export function parseCallResult(raw: unknown): CallResult {
  if (!isRecord(raw)) return { status: "unavailable" };
  switch (raw.status) {
    case "created":
    case "already_pending":
    case "unavailable":
    case "not_found":
    case "session_closed":
      return { status: raw.status };
    case "cooldown":
    case "rate_limited": {
      const seconds = raw.retry_after_seconds;
      return typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 1
        ? { status: raw.status, retryAfterSeconds: Math.ceil(seconds) }
        : { status: "unavailable" };
    }
    default:
      return { status: "unavailable" };
  }
}

export type CallTone = "ok" | "info" | "error";

/** El ticket de visita venció, no es válido o la mesa ya cerró la cuenta (fichas ticket-de-visita y cerrar-sesion-al-atender-la-cuenta): mismo texto. */
export const SESSION_EXPIRED_MESSAGE = TEXTOS[BASE_LANG].call.expired;

export const UNAVAILABLE_MESSAGE = TEXTOS[BASE_LANG].call.unavailable;

/**
 * Qué se le dice al comensal por cada resultado, en el idioma de su carta (los textos viven en `idiomas/textos.ts`). El tono
 * decide el rol accesible del mensaje.
 */
export function callMessage(kind: CallKind, result: CallResult, lang: Lang = BASE_LANG): { tone: CallTone; text: string } {
  const t = TEXTOS[lang].call;
  switch (result.status) {
    case "created":
      return { tone: "ok", text: t.created[kind] };
    case "already_pending":
      return { tone: "info", text: t.already[kind] };
    case "cooldown":
      return { tone: "info", text: t.cooldown(result.retryAfterSeconds) };
    case "rate_limited":
      return { tone: "error", text: t.rateLimited(Math.max(1, Math.ceil(result.retryAfterSeconds / 60))) };
    case "session_closed":
      return { tone: "error", text: t.expired };
    default:
      return { tone: "error", text: t.unavailable };
  }
}

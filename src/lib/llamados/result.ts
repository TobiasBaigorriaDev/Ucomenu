/** Resultado de `create_waiter_call` y los mensajes que ve el comensal. Puro: se prueba en `llamados.test.ts`. */

export type CallKind = "waiter" | "bill";

export const isCallKind = (value: unknown): value is CallKind => value === "waiter" || value === "bill";

export type CallResult =
  | { status: "created" }
  | { status: "already_pending" }
  | { status: "cooldown"; retryAfterSeconds: number }
  | { status: "rate_limited"; retryAfterSeconds: number }
  | { status: "unavailable" }
  | { status: "not_found" };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Lee la respuesta de la función. Cualquier forma inesperada es «no disponible» (falla cerrado). */
export function parseCallResult(raw: unknown): CallResult {
  if (!isRecord(raw)) return { status: "unavailable" };
  switch (raw.status) {
    case "created":
    case "already_pending":
    case "unavailable":
    case "not_found":
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

export const UNAVAILABLE_MESSAGE = "Por ahora no se puede avisar desde acá. Levantá la mano o buscá al personal.";

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** Qué se le dice al comensal por cada resultado. El tono decide el rol accesible del mensaje. */
export function callMessage(kind: CallKind, result: CallResult): { tone: CallTone; text: string } {
  const bill = kind === "bill";
  switch (result.status) {
    case "created":
      return { tone: "ok", text: bill ? "Pedimos tu cuenta. En un momento te la acercan." : "Avisamos al personal. En un momento te atienden." };
    case "already_pending":
      return { tone: "info", text: bill ? "Ya pedimos tu cuenta. Enseguida te la acercan." : "Ya avisamos al personal. Enseguida te atienden." };
    case "cooldown":
      return { tone: "info", text: `Ya avisaste hace un momento. Podés volver a avisar en ${plural(result.retryAfterSeconds, "segundo", "segundos")}.` };
    case "rate_limited": {
      const minutes = Math.max(1, Math.ceil(result.retryAfterSeconds / 60));
      return { tone: "error", text: `Se hicieron demasiados avisos desde tu conexión. Probá de nuevo en ${plural(minutes, "minuto", "minutos")}.` };
    }
    default:
      return { tone: "error", text: UNAVAILABLE_MESSAGE };
  }
}

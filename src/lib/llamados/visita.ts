import { verifyVisitTicket, VISIT_TTL_MS } from "./visit-ticket";

/**
 * La visita de un comensal vive en la URL (`?v={ticket}`; ficha turno-de-mesa, ADR 0044, enmienda del 2026-10-25). Escanear el QR (`/t/{token}`,
 * sin `v`) emite una visita nueva y redirige a la URL con ella; RECARGAR esa URL reutiliza la misma visita en vez de emitir otra. Así, cuando el
 * turno de la mesa termina (cobro o «Reiniciar QR»), quien recarga una pestaña vieja ve «escaneá de nuevo» en vez de recibir un ticket nuevo que
 * le devuelva los botones. Escribir la URL a mano sin `v` equivale a escanear (desde afuera es indistinguible, y no se pretende evitarlo).
 * Puro: se prueba en `visita.test.ts`. El estado del turno lo decide la base (`visit_in_turn`); esto solo lee y valida la forma.
 */

export type VisitaDeLaUrl =
  /** Sin `v`: es un escaneo (o una URL escrita a mano): se emite una visita y se redirige. */
  | { kind: "nueva" }
  /** Un ticket firmado para ESTA mesa y todavía dentro de su plazo, con lo que le queda de vida. */
  | { kind: "propia"; ticket: string; issuedAt: Date; ttlMs: number }
  /** Mal formado, forjado, de otra mesa, del futuro o vencido: no se emite uno nuevo. `raw` es lo que venía (acotado) para conservarlo en los enlaces. */
  | { kind: "invalida"; raw: string };

const MAX_RAW = 64;

export function leerVisitaDeLaUrl(token: string, raw: unknown, nowMs: number = Date.now()): VisitaDeLaUrl {
  if (raw === undefined) return { kind: "nueva" };
  if (typeof raw !== "string") return { kind: "invalida", raw: "" };
  const check = verifyVisitTicket(token, raw, nowMs);
  if (!check.ok) return { kind: "invalida", raw: raw.slice(0, MAX_RAW) };
  return { kind: "propia", ticket: raw, issuedAt: check.issuedAt, ttlMs: Math.max(0, VISIT_TTL_MS - (nowMs - check.issuedAt.getTime())) };
}

/** `path` con la query de la página (por ejemplo `lang`) más la visita `v`, que reemplaza a una anterior. */
export function urlConVisita(path: string, query: Record<string, string | string[] | undefined>, ticket: string): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key !== "v" && typeof value === "string") params.set(key, value);
  }
  params.set("v", ticket);
  return `${path}?${params.toString()}`;
}

/** Agrega `clave=valor` a una ruta que puede tener ya una query. */
export const conParametro = (ruta: string, clave: string, valor: string): string => `${ruta}${ruta.includes("?") ? "&" : "?"}${clave}=${encodeURIComponent(valor)}`;

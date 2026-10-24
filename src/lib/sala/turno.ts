/**
 * Reiniciar el turno de una mesa desde la Sala (ficha turno-de-mesa, ADR 0044): validación de lo que llega al servidor y mensajes de los
 * errores de la base. Sin dependencias de servidor. Se prueban en `turno.test.ts`.
 *
 * La AUTORIDAD es la base (`reset_table_turn`): ella comprueba que la persona sea miembro de la organización de la mesa. El QR impreso
 * no cambia; lo que se corta es que los celulares que escanearon antes sigan viendo la cuenta.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ResetInput = { tableId: string };

export function parseResetInput(raw: unknown): ResetInput | "invalid" {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "invalid";
  const tableId = (raw as { tableId?: unknown }).tableId;
  return typeof tableId === "string" && UUID.test(tableId) ? { tableId: tableId.toLowerCase() } : "invalid";
}

export type ResetFailure = "table_gone" | "invalid" | "unexpected";

export type ResetResult = { status: "done" } | { status: "failed"; reason: ResetFailure };

/** Qué dice la base cuando no puede reiniciar: la mesa no existe, es de otro local o ya no es accesible. */
export function resetFailureFromDb(message: string | undefined): ResetFailure {
  return (message ?? "").trim() === "table_not_found" ? "table_gone" : "unexpected";
}

export const RESET_TEXT: Record<ResetFailure, string> = {
  table_gone: "Esa mesa ya no existe. Volvé a «Mesas».",
  invalid: "Los datos no son válidos. Probá de nuevo.",
  unexpected: "No se pudo confirmar el reinicio. Probá de nuevo.",
};

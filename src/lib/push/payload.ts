import { KIND_LABEL, type CallKind } from "@/lib/sala/types";
import { vibrationPattern, type VibrationLevel } from "@/lib/sala/vibracion";

/**
 * Texto del aviso. Lleva solo lo necesario para decidir si abrir la sala: el tipo, la mesa y (si el local tiene más de
 * una sucursal) cuál. Nunca ids, tokens ni datos del comensal. Viaja cifrado de punta a punta hasta el dispositivo.
 * Puro: se prueba en `push.test.ts`.
 */
/** `vibrate` (milisegundos, solo Android) se omite con la vibración apagada. */
export type CallPushPayload = { title: string; body: string; url: string; tag: string; vibrate?: number[] };

const MAX_TEXT = 80;
const clip = (text: string) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text);

export function buildCallPayload(input: {
  slug: string;
  kind: CallKind;
  tableLabel: string;
  /** Clave opaca de la mesa (no es su id): distingue «Mesa 1» de dos sucursales para que sus avisos no se reemplacen. */
  tableKey: string;
  branchName: string;
  multiBranch: boolean;
  /** Intensidad que eligió el Dueño; sin ella el aviso no declara patrón. */
  vibration?: VibrationLevel;
}): CallPushPayload {
  const table = clip(input.tableLabel.trim() || "Mesa");
  const branch = input.multiBranch && input.branchName.trim() ? ` · ${clip(input.branchName.trim())}` : "";
  const vibrate = input.vibration ? vibrationPattern(input.vibration, input.kind) : [];
  return {
    title: KIND_LABEL[input.kind],
    body: `${table}${branch}`,
    url: `/sala/${input.slug}`,
    // Un segundo aviso de la MISMA mesa y tipo reemplaza al anterior en vez de apilarse (mesas distintas no se pisan).
    tag: `llamado:${input.slug}:${input.kind}:${input.tableKey}`,
    ...(vibrate.length > 0 ? { vibrate } : {}),
  };
}

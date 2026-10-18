import { KIND_LABEL, type CallKind } from "@/lib/sala/types";

/**
 * Texto del aviso. Lleva solo lo necesario para decidir si abrir la sala: el tipo, la mesa y (si el local tiene más de
 * una sucursal) cuál. Nunca ids, tokens ni datos del comensal. Viaja cifrado de punta a punta hasta el dispositivo.
 * Puro: se prueba en `push.test.ts`.
 */
export type CallPushPayload = { title: string; body: string; url: string; tag: string };

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
}): CallPushPayload {
  const table = clip(input.tableLabel.trim() || "Mesa");
  const branch = input.multiBranch && input.branchName.trim() ? ` · ${clip(input.branchName.trim())}` : "";
  return {
    title: KIND_LABEL[input.kind],
    body: `${table}${branch}`,
    url: `/sala/${input.slug}`,
    // Un segundo aviso de la MISMA mesa y tipo reemplaza al anterior en vez de apilarse (mesas distintas no se pisan).
    tag: `llamado:${input.slug}:${input.kind}:${input.tableKey}`,
  };
}

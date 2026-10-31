/**
 * Vibración de los avisos (ficha vibracion-de-aviso). La base guarda solo el nivel; los patrones viven acá, los comparten el
 * navegador (`navigator.vibrate`) y el servidor (el aviso push que muestra el service worker en Android). iPhone y iPad no
 * exponen la vibración a la web: allí no tiene efecto. Un patrón alterna milisegundos de vibración y de pausa.
 */
export const VIBRATION_LEVELS = [
  { id: "ninguna", label: "Sin vibración", hint: "El celular no vibra por los avisos de la app" },
  { id: "suave", label: "Suave", hint: "Pulsos cortos, para un salón tranquilo" },
  { id: "fuerte", label: "Fuerte", hint: "Pulsos largos, se sienten en el bolsillo" },
  { id: "muy_fuerte", label: "Muy fuerte", hint: "Más de tres segundos de vibración, para salones con mucho ruido" },
] as const;

export type VibrationLevel = (typeof VIBRATION_LEVELS)[number]["id"];
/** Qué avisa: una mesa que llama, una que pide la cuenta o un pedido que cocina terminó. Cada uno se siente distinto. */
export type VibrationEvent = "waiter" | "bill" | "ready";

export const DEFAULT_VIBRATION: VibrationLevel = "fuerte";
/** Tope de un patrón: más largo que esto resulta molesto y algunos navegadores lo cortan. */
export const MAX_PATTERN_MS = 6_000;

const PATTERNS: Record<Exclude<VibrationLevel, "ninguna">, Record<VibrationEvent, readonly number[]>> = {
  suave: { waiter: [300, 150, 300], bill: [800], ready: [250, 120, 250] },
  fuerte: { waiter: [500, 200, 500, 200, 500], bill: [1200, 300, 1200], ready: [500, 200, 500] },
  muy_fuerte: { waiter: [700, 200, 700, 200, 700, 200, 700], bill: [1500, 300, 1500, 300, 1500], ready: [800, 200, 800, 200, 800] },
};

export function isVibrationLevel(value: unknown): value is VibrationLevel {
  return typeof value === "string" && VIBRATION_LEVELS.some((level) => level.id === value);
}

export const vibrationOrDefault = (value: unknown): VibrationLevel => (isVibrationLevel(value) ? value : DEFAULT_VIBRATION);

/** Patrón en milisegundos del aviso (vacío con «ninguna»). */
export function vibrationPattern(level: VibrationLevel, event: VibrationEvent): number[] {
  return level === "ninguna" ? [] : [...PATTERNS[level][event]];
}

export const patternDuration = (pattern: readonly number[]) => pattern.reduce((total, ms) => total + ms, 0);

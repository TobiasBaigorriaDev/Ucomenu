/**
 * Catálogo de tonos de aviso (ficha tonos-de-aviso). Lo comparten la base (el CHECK de `organizations.call_tone` y
 * `ready_tone` repite estos ids), el servidor (valida lo que manda el formulario) y el navegador (los reproduce).
 * Los dos primeros son los MP3 de siempre; el resto se sintetiza con Web Audio, sin archivos nuevos.
 */
export type Note = {
  /** Frecuencia en Hz. */
  hz: number;
  /** Segundos desde el inicio del tono. */
  at: number;
  /** Duración audible en segundos. */
  length: number;
  wave: OscillatorType;
  /** Volumen pico, de 0 a 1. */
  gain: number;
};

export type Tone =
  | { id: string; label: string; hint: string; file: string }
  | { id: string; label: string; hint: string; notes: readonly Note[] };

const bell = (hz: number, at: number, length = 1.1, gain = 0.5): Note[] => [
  { hz, at, length, wave: "sine", gain },
  { hz: hz * 2.76, at, length: length * 0.45, wave: "sine", gain: gain * 0.25 },
];

export const TONES = [
  { id: "llamado", label: "Clásico", hint: "El aviso de siempre", file: "/notificacion.mp3" },
  { id: "plato-listo", label: "Plato listo", hint: "El aviso de plato listo de siempre", file: "/notificacion-plato-listo.mp3" },
  { id: "campana", label: "Campana", hint: "Dos golpes de campana, grave y claro", notes: [...bell(659, 0), ...bell(880, 0.32, 1.4)] },
  { id: "timbre", label: "Timbre", hint: "Ding-dong de puerta", notes: [...bell(784, 0, 0.9), ...bell(523, 0.45, 1.3)] },
  {
    id: "marimba",
    label: "Marimba",
    hint: "Tres notas suaves que suben",
    notes: [
      { hz: 523, at: 0, length: 0.35, wave: "triangle", gain: 0.6 },
      { hz: 659, at: 0.16, length: 0.35, wave: "triangle", gain: 0.6 },
      { hz: 784, at: 0.32, length: 0.6, wave: "triangle", gain: 0.6 },
    ],
  },
  {
    id: "digital",
    label: "Digital",
    hint: "Dos pitidos cortos y agudos",
    notes: [
      { hz: 1175, at: 0, length: 0.12, wave: "square", gain: 0.18 },
      { hz: 1175, at: 0.2, length: 0.12, wave: "square", gain: 0.18 },
    ],
  },
  {
    id: "alerta",
    label: "Alerta",
    hint: "Tres golpes seguidos, difícil de pasar por alto",
    notes: [0, 0.28, 0.56].map((at) => ({ hz: 880, at, length: 0.2, wave: "sawtooth" as const, gain: 0.22 })),
  },
] as const satisfies readonly Tone[];

export type ToneId = (typeof TONES)[number]["id"];

/** Qué suena para cada aviso mientras el Dueño no elija otra cosa. */
export const DEFAULT_TONES = { call: "llamado", ready: "plato-listo" } as const satisfies Record<string, ToneId>;

export type AlertTones = { call: ToneId; ready: ToneId };

export function isToneId(value: unknown): value is ToneId {
  return typeof value === "string" && TONES.some((tone) => tone.id === value);
}

/** Id válido o, si la base devolviera algo desconocido, el tono por defecto del aviso. */
export function toneOrDefault(value: unknown, event: keyof AlertTones): ToneId {
  return isToneId(value) ? value : DEFAULT_TONES[event];
}

export const toneById = (id: ToneId): Tone => TONES.find((tone) => tone.id === id) ?? TONES[0];

/** Los archivos que hay que precargar al desbloquear el audio. */
export const TONE_FILES: readonly { id: ToneId; file: string }[] = TONES.flatMap((tone) => ("file" in tone ? [{ id: tone.id, file: tone.file }] : []));

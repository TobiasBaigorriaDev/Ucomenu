/**
 * Reglas puras de la configuración del llamado (ficha configuracion-del-llamado): duraciones del silencio, rango del
 * cooldown y lectura del estado «silenciada». Se prueban en `config.test.ts`. La autoridad de fondo —quién puede
 * escribir, el rango y el tope de 24 horas— vive en la base.
 */

/** Duraciones que ofrece la pantalla, en minutos. La base acepta como máximo 24 horas. */
export const MUTE_OPTIONS = [
  { minutes: 15, label: "15 minutos" },
  { minutes: 60, label: "1 hora" },
  { minutes: 240, label: "4 horas" },
  { minutes: 1440, label: "24 horas" },
] as const;

/** Rango del cooldown (el mismo del CHECK de `branches.waiter_call_cooldown_seconds`). */
export const COOLDOWN_MIN = 10;
export const COOLDOWN_MAX = 3600;

const MINUTE_MS = 60_000;

/** Minutos de un silencio, solo si es una de las opciones ofrecidas (cualquier otro valor se rechaza). */
export function parseMuteMinutes(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^\d{1,4}$/.test(raw)) return null;
  const minutes = Number(raw);
  return MUTE_OPTIONS.some((option) => option.minutes === minutes) ? minutes : null;
}

export type CooldownParse = { ok: true; seconds: number } | { ok: false; problem: "blank" | "not_integer" | "out_of_range" };

/** Segundos del cooldown: entero entre 10 y 3600. */
export function parseCooldown(raw: unknown): CooldownParse {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text.length === 0) return { ok: false, problem: "blank" };
  if (!/^\d{1,5}$/.test(text)) return { ok: false, problem: "not_integer" };
  const seconds = Number(text);
  if (seconds < COOLDOWN_MIN || seconds > COOLDOWN_MAX) return { ok: false, problem: "out_of_range" };
  return { ok: true, seconds };
}

/** Instante (ISO) hasta el que queda silenciada una mesa que se silencia ahora por `minutes`. */
export function muteUntil(minutes: number, now: Date = new Date()): string {
  return new Date(now.getTime() + minutes * MINUTE_MS).toISOString();
}

/** ¿Sigue silenciada? Una fecha vencida o ilegible cuenta como no silenciada. */
export function isMuted(mutedUntil: string | null, now: Date = new Date()): boolean {
  if (!mutedUntil) return false;
  const until = Date.parse(mutedUntil);
  return Number.isFinite(until) && until > now.getTime();
}

const TIME_ZONE = "America/Argentina/Buenos_Aires";
const timeFormat = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TIME_ZONE });
const dayFormat = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "numeric", timeZone: TIME_ZONE });

/** «las 15:30» si es hoy y «el 15/10 a las 15:30» si no (hora de Argentina). */
export function formatMuteEnd(mutedUntil: string, now: Date = new Date()): string {
  const until = new Date(mutedUntil);
  const time = timeFormat.format(until);
  return dayFormat.format(until) === dayFormat.format(now) ? `las ${time}` : `el ${dayFormat.format(until)} a las ${time}`;
}

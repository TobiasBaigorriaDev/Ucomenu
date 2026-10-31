/**
 * «Voz del local» (ADR 0050): lema, horarios, Instagram y WhatsApp que el Dueño publica en la carta pública. Son datos que el propio
 * local decide mostrar a cualquiera; por eso hay reglas estrictas: texto plano de una línea (React lo escapa; nunca HTML), largos
 * acotados y enlaces ARMADOS por el servidor a partir de un identificador validado (usuario de Instagram, número de WhatsApp), nunca
 * una dirección escrita por la persona. Estas reglas son espejo de los CHECK de la migración `voz_del_local`; una prueba de RLS
 * compara los dos con la misma tabla de casos.
 */
export const TAGLINE_MAX = 80;
export const HOURS_MAX = 160;
export const INSTAGRAM_PATTERN = /^[A-Za-z0-9._]{1,30}$/;
export const WHATSAPP_PATTERN = /^[0-9]{8,15}$/;
/** Controles (incluido el salto de línea) y marcas invisibles de dirección o ancho cero, que sirven para disfrazar texto. */
export const FORBIDDEN_TEXT = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁩﻿]/;

export type TextProblem = "too_long" | "invalid";
export type Parsed<T> = { ok: true; value: T | null } | { ok: false; problem: TextProblem };

function plainText(raw: unknown, max: number): Parsed<string> {
  const value = typeof raw === "string" ? raw.trim().replace(/ {2,}/g, " ") : "";
  if (value === "") return { ok: true, value: null };
  if (FORBIDDEN_TEXT.test(value)) return { ok: false, problem: "invalid" };
  return [...value].length > max ? { ok: false, problem: "too_long" } : { ok: true, value };
}

/** Lema corto bajo el nombre del local. Vacío = quitarlo. */
export const validateTagline = (raw: unknown): Parsed<string> => plainText(raw, TAGLINE_MAX);
/** Horarios en una línea («Lun a sáb de 8 a 20 hs»). Vacío = quitarlos. */
export const validateHours = (raw: unknown): Parsed<string> => plainText(raw, HOURS_MAX);

/** Usuario de Instagram. Acepta «@usuario», «usuario» o el enlace del perfil; guarda solo el usuario. Vacío = quitarlo. */
export function validateInstagram(raw: unknown): Parsed<string> {
  let value = typeof raw === "string" ? raw.trim() : "";
  if (value === "") return { ok: true, value: null };
  // Del enlace del perfil se toma solo el usuario; cualquier otra forma con barras ("a/b", otros sitios) no pasa el patrón.
  const profile = value.match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#]*)\/?(?:[?#].*)?$/i);
  value = (profile ? profile[1] : value).replace(/^@/, "");
  return INSTAGRAM_PATTERN.test(value) ? { ok: true, value } : { ok: false, problem: value.length > 30 ? "too_long" : "invalid" };
}

/** Número de WhatsApp en formato internacional. Acepta «+54 9 11 1234-5678»; guarda solo los dígitos (8 a 15). Vacío = quitarlo. */
export function validateWhatsapp(raw: unknown): Parsed<string> {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value === "") return { ok: true, value: null };
  if (!/^\+?[\d\s().-]+$/.test(value)) return { ok: false, problem: "invalid" };
  const digits = value.replace(/\D/g, "");
  return WHATSAPP_PATTERN.test(digits) ? { ok: true, value: digits } : { ok: false, problem: digits.length > 15 ? "too_long" : "invalid" };
}

export const instagramUrl = (handle: string): string => `https://www.instagram.com/${handle}/`;
export const whatsappUrl = (number: string): string => `https://wa.me/${number}`;

export type Voice = { tagline: string | null; hours: string | null; instagram: string | null; whatsapp: string | null };

/** Lee la voz de una fila de la base descartando cualquier valor que no cumpla las reglas (nunca se confía en lo guardado). */
export function readVoice(row: { menu_tagline?: unknown; opening_hours?: unknown; instagram_handle?: unknown; whatsapp_number?: unknown }): Voice {
  const text = (value: unknown, max: number) => {
    const parsed = plainText(value, max);
    return parsed.ok ? parsed.value : null;
  };
  const matching = (value: unknown, pattern: RegExp) => (typeof value === "string" && pattern.test(value) ? value : null);
  return {
    tagline: text(row.menu_tagline, TAGLINE_MAX),
    hours: text(row.opening_hours, HOURS_MAX),
    instagram: matching(row.instagram_handle, INSTAGRAM_PATTERN),
    whatsapp: matching(row.whatsapp_number, WHATSAPP_PATTERN),
  };
}

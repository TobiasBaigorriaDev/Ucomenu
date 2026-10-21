import type { CSSProperties } from "react";
import type { Lang } from "@/lib/idiomas/idiomas";

/**
 * Temas de fechas especiales de la carta (ADR 0037): decoración opcional (patrón de fondo muy suave, saludo y adornos en la
 * cabecera y el pie) que el Dueño enciende, con una ventana de fechas opcional. No cambia colores, textos del local ni datos:
 * el patrón toma el color de la paleta del local. Módulo puro, sin dependencias de la base: lo usan el servidor y la vista previa.
 */

export type MotifName = "heart" | "star" | "flower" | "egg" | "tie" | "sun" | "glass" | "pumpkin" | "bat" | "snowflake" | "gift";

type ThemeInfo = {
  name: string;
  /** Cuándo cae, para que el Dueño lo reconozca en el selector. */
  when: string;
  greeting: Record<Lang, string>;
  /** Motivos del patrón y de los adornos del pie, en orden. */
  motifs: readonly MotifName[];
};

export const THEMES = {
  sanvalentin: { name: "San Valentín", when: "14 de febrero", greeting: { es: "Feliz San Valentín", en: "Happy Valentine's Day", pt: "Feliz Dia de São Valentim" }, motifs: ["heart"] },
  pascuas: { name: "Pascuas", when: "Semana Santa", greeting: { es: "Felices Pascuas", en: "Happy Easter", pt: "Feliz Páscoa" }, motifs: ["egg", "flower"] },
  diamadre: { name: "Día de la Madre", when: "3.er domingo de octubre", greeting: { es: "Feliz Día de la Madre", en: "Happy Mother's Day", pt: "Feliz Dia das Mães" }, motifs: ["flower", "heart"] },
  diapadre: { name: "Día del Padre", when: "3.er domingo de junio", greeting: { es: "Feliz Día del Padre", en: "Happy Father's Day", pt: "Feliz Dia dos Pais" }, motifs: ["tie", "star"] },
  patrias: { name: "Fiestas patrias", when: "25 de mayo y 9 de julio", greeting: { es: "Felices Fiestas Patrias", en: "Happy National Day", pt: "Feliz Dia da Pátria" }, motifs: ["sun", "star"] },
  diaamigo: { name: "Día del Amigo", when: "20 de julio", greeting: { es: "Feliz Día del Amigo", en: "Happy Friendship Day", pt: "Feliz Dia da Amizade" }, motifs: ["glass", "star"] },
  halloween: { name: "Halloween", when: "31 de octubre", greeting: { es: "Feliz Halloween", en: "Happy Halloween", pt: "Feliz Halloween" }, motifs: ["pumpkin", "bat"] },
  navidad: { name: "Navidad", when: "25 de diciembre", greeting: { es: "Feliz Navidad", en: "Merry Christmas", pt: "Feliz Natal" }, motifs: ["snowflake", "gift", "star"] },
  anionuevo: { name: "Año Nuevo", when: "31 de diciembre y 1 de enero", greeting: { es: "Feliz Año Nuevo", en: "Happy New Year", pt: "Feliz Ano Novo" }, motifs: ["glass", "star"] },
} as const satisfies Record<string, ThemeInfo>;

export type Theme = keyof typeof THEMES;
export const THEME_KEYS = Object.keys(THEMES) as Theme[];
/** El valor que guarda la base cuando el local no usa ningún tema. */
export const NO_THEME = "ninguno";
export const isTheme = (value: unknown): value is Theme => typeof value === "string" && Object.hasOwn(THEMES, value);

/** Opacidad máxima del patrón: `temas.test.ts` comprueba el contraste AA del texto sobre el fondo así teñido, en todas las paletas. */
export const PATTERN_OPACITY = 0.07;

// ── Ventana de fechas ──────────────────────────────────────────────────────────────────────────────────────────────

const TIME_ZONE = "America/Argentina/Buenos_Aires";
const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `AAAA-MM-DD` de un instante en Buenos Aires (como la zona del negocio en el resto de la aplicación). */
export const buenosAiresDay = (now: Date): string => dayFormat.format(now);

/** Una fecha válida del calendario (`2026-02-30` no lo es). */
export function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

export type ThemeSetting = { theme: string | null | undefined; from?: string | null; until?: string | null };

export type ThemeStatus =
  | { kind: "none" }
  | { kind: "active"; theme: Theme; until: string | null }
  | { kind: "scheduled"; theme: Theme; from: string }
  | { kind: "expired"; theme: Theme; until: string };

/** Estado del tema de un local en el día `now`: `desde` y `hasta` son inclusivos y cualquiera de los dos puede faltar. */
export function themeStatus(setting: ThemeSetting, now: Date): ThemeStatus {
  if (!isTheme(setting.theme)) return { kind: "none" };
  const today = buenosAiresDay(now);
  const from = isDay(setting.from) ? setting.from : null;
  const until = isDay(setting.until) ? setting.until : null;
  if (from && today < from) return { kind: "scheduled", theme: setting.theme, from };
  if (until && today > until) return { kind: "expired", theme: setting.theme, until };
  return { kind: "active", theme: setting.theme, until };
}

/** El tema que se ve hoy en la carta, o `null` (sin tema, aún no empezó o ya venció). */
export function activeTheme(setting: ThemeSetting, now: Date): Theme | null {
  const status = themeStatus(setting, now);
  return status.kind === "active" ? status.theme : null;
}

// ── Motivos: una sola definición sirve a los íconos (React) y al patrón de fondo (máscara CSS) ──────────────────────

/** Trazos en una grilla de 24: `filled` pinta las formas macizas; si no, solo el contorno. */
export const MOTIFS: Record<MotifName, { filled: boolean; markup: string }> = {
  heart: { filled: true, markup: '<path d="M12 21C12 21 3 14.5 3 8.8 3 6.1 5 4.5 7.2 4.5c1.9 0 3.4 1 4.8 2.9 1.4-1.9 2.9-2.9 4.8-2.9C19 4.5 21 6.1 21 8.8 21 14.5 12 21 12 21z"/>' },
  star: { filled: true, markup: '<path d="M12 2.5l2.9 6.2 6.8.8-5 4.7 1.3 6.7-6-3.4-6 3.4 1.3-6.7-5-4.7 6.8-.8z"/>' },
  flower: { filled: true, markup: '<circle cx="12" cy="6" r="3.6"/><circle cx="18" cy="10.4" r="3.6"/><circle cx="15.7" cy="17.4" r="3.6"/><circle cx="8.3" cy="17.4" r="3.6"/><circle cx="6" cy="10.4" r="3.6"/><circle cx="12" cy="12.4" r="2.4"/>' },
  egg: { filled: false, markup: '<path d="M12 3.5c-3.8 0-6.5 5.4-6.5 10 0 3.6 2.9 6 6.5 6s6.5-2.4 6.5-6c0-4.6-2.7-10-6.5-10z"/><path d="M5.7 13.2l2.1-2 2.1 2 2.1-2 2.1 2 2.1-2 .5.5"/>' },
  tie: { filled: true, markup: '<path d="M9.5 2.5h5l1 3.5-2.2 2.2 3 10.3-3.3 3-3.3-3 3-10.3L8.5 6z"/>' },
  sun: { filled: false, markup: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/>' },
  glass: { filled: false, markup: '<path d="M7 3h10l-.9 6.5a4.1 4.1 0 0 1-8.2 0z"/><path d="M12 13.6V20M8 21h8"/>' },
  pumpkin: { filled: false, markup: '<ellipse cx="12" cy="14.2" rx="9" ry="6.8"/><path d="M12 7.4v13.6M8.2 8.4c-2.2 2.2-2.2 8 0 11M15.8 8.4c2.2 2.2 2.2 8 0 11M12 7.4c0-2 1-3.4 3-4.2"/>' },
  bat: { filled: true, markup: '<path d="M12 8.5c-1-2.3-3.2-3.5-6.5-3.5 1 1 1.5 2.1 1.5 3.3-2.3 0-4.2 1.1-5.5 3.2 2-.6 4-.1 5 1.5 1-1 2.6-1.5 5.5-1.5s4.5.5 5.5 1.5c1-1.6 3-2.1 5-1.5-1.3-2.1-3.2-3.2-5.5-3.2 0-1.2.5-2.3 1.5-3.3-3.3 0-5.5 1.2-6.5 3.5z"/>' },
  snowflake: { filled: false, markup: '<path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6M9.5 4.2L12 6.7l2.5-2.5M9.5 19.8L12 17.3l2.5 2.5"/>' },
  gift: { filled: false, markup: '<rect x="4" y="10" width="16" height="10.5" rx="1"/><path d="M3 10h18V6.5H3zM12 6.5v14M12 6.5C10 3 6 3 7 5.5c.5 1 3 1 5 1zM12 6.5c2-3.5 6-3.5 5-1-.5 1-3 1-5 1z"/>' },
};

const STROKE = 'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

/** Atributos de pintura del motivo (relleno macizo o contorno) para el `<svg>` o el `<g>` que lo envuelva. */
export const motifPaint = (name: MotifName, color: string): string =>
  MOTIFS[name].filled ? `fill="${color}"` : `fill="none" stroke="${color}" ${STROKE}`;

/** Posición (x, y) y giro de cada motivo dentro del mosaico de 96 px; se reparten en diagonal para que quede ralo y no forme columnas. */
const SLOTS = [[8, 10, -14], [56, 30, 12], [24, 62, 6]] as const;
const TILE = 96;
const ICON = 22;

/** SVG del mosaico del patrón (solo importa su transparencia: se usa de máscara y el color lo pone la paleta). */
export function patternSvg(theme: Theme): string {
  const motifs = THEMES[theme].motifs;
  const items = SLOTS.map(([x, y, turn], i) => {
    const name = motifs[i % motifs.length];
    return `<g transform="translate(${x} ${y}) rotate(${turn} ${ICON / 2} ${ICON / 2}) scale(${ICON / 24})" ${motifPaint(name, "#000")}>${MOTIFS[name].markup}</g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}" viewBox="0 0 ${TILE} ${TILE}">${items.join("")}</svg>`;
}

/** Variables CSS que activa el tema dentro de `.carta` (ver `carta.css`): el patrón va inline, sin pedidos de red. */
export function themeStyle(theme: Theme | null | undefined): CSSProperties {
  if (!theme) return {};
  return { "--tema-patron": `url("data:image/svg+xml,${encodeURIComponent(patternSvg(theme))}")`, "--tema-opacidad": String(PATTERN_OPACITY) } as CSSProperties;
}

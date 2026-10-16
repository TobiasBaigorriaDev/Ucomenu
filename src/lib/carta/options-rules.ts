/**
 * Reglas puras de variantes y adicionales (ficha variantes-y-adicionales): validación de mínimo y máximo, diferencia de
 * precio, el texto de la regla de elección y las plantillas del alta. Sin base ni red: se prueban en `options.test.ts`.
 *
 * Una VARIANTE es un grupo con mínimo 1 y máximo 1 (p. ej. el tamaño); los ADICIONALES, mínimo 0 y máximo N.
 */
import { parsePrice, type PriceProblem } from "./price";

/** Topes técnicos (no de plan). Los repite la base (`enforce_option_group_cap` / `enforce_option_cap`, error 54000). */
export const MAX_CHOICES = 50;
export const MAX_GROUPS_PER_PRODUCT = 20;
export const MAX_OPTIONS_PER_GROUP = 60;

export type ChoicesProblem = "invalid" | "min_over_max" | "max_range";

/** Un número entero escrito en un campo: «2», « 3 ». Nada de decimales, signos ni notación científica. */
function wholeNumber(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!/^\d{1,3}$/.test(text)) return null;
  return Number(text);
}

export function parseChoices(
  rawMin: unknown,
  rawMax: unknown,
): { ok: true; min: number; max: number } | { ok: false; problem: ChoicesProblem } {
  const min = wholeNumber(rawMin);
  const max = wholeNumber(rawMax);
  if (min === null || max === null) return { ok: false, problem: "invalid" };
  if (max < 1 || max > MAX_CHOICES) return { ok: false, problem: "max_range" };
  if (min > max) return { ok: false, problem: "min_over_max" };
  return { ok: true, min, max };
}

/**
 * Diferencia de precio de una opción, en centavos. Vacío = 0 (sin diferencia). Reutiliza el parser de precios de la
 * carta (es-AR, centavos enteros, tope de $ 10.000.000); un valor negativo no es válido.
 */
export function parseDelta(raw: unknown): { ok: true; cents: number } | { ok: false; problem: Exclude<PriceProblem, "blank"> } {
  if (typeof raw !== "string" || raw.trim() === "") return { ok: true, cents: 0 };
  const price = parsePrice(raw);
  if (price.ok) return price;
  return { ok: false, problem: price.problem === "blank" ? "invalid" : price.problem };
}

/** Para precargar el campo al editar: 0 -> «» (sin diferencia); 30000 -> «300». */
export function deltaToInput(cents: number): string {
  if (cents === 0) return "";
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? String(whole) : `${whole},${String(rest).padStart(2, "0")}`;
}

/** «Elegí 1», «Opcional · hasta 3»… Lo que el comensal y el local leen para entender la regla del grupo. */
export function choiceRule(min: number, max: number): string {
  if (min === 0) return max === 1 ? "Opcional · hasta 1" : `Opcional · hasta ${max}`;
  if (min === max) return `Elegí ${min}`;
  return `Elegí de ${min} a ${max}`;
}

/** Variante = elegir exactamente una; el panel lo muestra con esa palabra. */
export function isVariant(min: number, max: number): boolean {
  return min === 1 && max === 1;
}

/** Con mínimo `min`, hacen falta al menos `min` opciones ACTIVAS: si no, el grupo no se puede cumplir. */
export function isUnsatisfiable(min: number, activeOptions: number): boolean {
  return min > activeOptions;
}

export type GroupTemplate = { key: "variant" | "extras"; label: string; name: string; min: string; max: string };

/** Plantillas del alta de un grupo: rellenan el formulario, que sigue siendo editable. */
export const GROUP_TEMPLATES: GroupTemplate[] = [
  { key: "variant", label: "Variante", name: "Tamaño", min: "1", max: "1" },
  { key: "extras", label: "Adicionales", name: "Adicionales", min: "0", max: "3" },
];

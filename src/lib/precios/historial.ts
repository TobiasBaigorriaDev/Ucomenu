import type { SupabaseClient } from "@supabase/supabase-js";
import { asUuid } from "@/lib/carta/validation";
import type { Role } from "@/lib/entitlements";
import { formatArs } from "@/lib/money";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Pantalla del historial de precios (ficha pantalla-historial-de-precios, ADR 0012). Todo se lee con el cliente de
 * la PERSONA (rol `authenticated`, RLS): la base decide qué filas ve (miembros de la propia organización).
 *
 * `price_history.product_id` y `changed_by` no tienen clave foránea (el historial sobrevive al borrado del plato y
 * a la baja de la persona), así que PostgREST no puede unir: el plato y la persona se resuelven aparte y
 * **tolerando el faltante**.
 */

type Db = SupabaseClient<Database>;

export const PAGE_SIZE = 50;

export type PriceChange = {
  id: string;
  productId: string;
  /** NULL = operación técnica sin usuario (ADR 0012). */
  changedBy: string | null;
  changedAt: string;
  oldCents: number;
  newCents: number;
};

export type PriceHistoryPage = { changes: PriceChange[]; next: string | null };

// ---------------------------------------------------------------------------
// Paginación por cursor (changed_at desc, id desc): estable aunque entren cambios nuevos mientras se pagina,
// y con empates en el mismo instante. Un cursor es dato del usuario (viene de la URL): se valida estrictamente antes
// de armar el filtro, porque `changed_at` va dentro de una expresión `or(...)` de PostgREST.
// ---------------------------------------------------------------------------

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

export type Cursor = { changedAt: string; id: string };

export function encodeCursor(change: Pick<PriceChange, "changedAt" | "id">): string {
  return `${change.changedAt}|${change.id}`;
}

/** El formato es válido y el instante existe: no se aceptan 30 de febrero, mes 13, hora 25, segundo 60 ni desfases fuera de ±15:59 como +16:00 o +99:99. */
function isRealTimestamp(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!m) return false;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  if (hour > 23 || minute > 59 || second > 59) return false;
  // PostgreSQL admite desfases de hasta ±15:59 (con +16:00 responde «time zone displacement out of range»).
  if (m[8] !== undefined && (Number(m[9]) > 15 || Number(m[10]) > 59)) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Cursor de la URL (`?despues=`). Cualquier cosa que no sea exactamente `instante real|uuid` se descarta (primera página). */
export function parseCursor(raw: unknown): Cursor | null {
  if (typeof raw !== "string") return null;
  const parts = raw.split("|");
  if (parts.length !== 2) return null;
  const id = asUuid(parts[1]);
  if (!id || !TIMESTAMP.test(parts[0]) || !isRealTimestamp(parts[0])) return null;
  return { changedAt: parts[0], id };
}

const COLUMNS = "id, product_id, changed_by, changed_at, old_price_cents, new_price_cents";

/**
 * Una página del historial de una organización, del más nuevo al más viejo (opcionalmente de un solo plato).
 * `null` si la base falló: la pantalla muestra un error, no un «sin cambios» falso.
 */
export async function loadPriceHistory(
  db: Db,
  orgId: string,
  options: { productId?: string; cursor?: Cursor | null } = {},
): Promise<PriceHistoryPage | null> {
  let query = db
    .from("price_history")
    .select(COLUMNS)
    .eq("organization_id", orgId)
    .order("changed_at", { ascending: false })
    .order("id", { ascending: false })
    // Una fila de más para saber si hay página siguiente.
    .limit(PAGE_SIZE + 1);
  if (options.productId) query = query.eq("product_id", options.productId);
  if (options.cursor) {
    const { changedAt, id } = options.cursor; // ya validados por parseCursor
    query = query.or(`changed_at.lt.${changedAt},and(changed_at.eq.${changedAt},id.lt.${id})`);
  }

  const { data, error } = await query;
  if (error || !data) return null;

  const changes = data.slice(0, PAGE_SIZE).map(
    (row): PriceChange => ({
      id: row.id,
      productId: row.product_id,
      changedBy: row.changed_by,
      changedAt: row.changed_at,
      oldCents: row.old_price_cents,
      newCents: row.new_price_cents,
    }),
  );
  const next = data.length > PAGE_SIZE && changes.length > 0 ? encodeCursor(changes[changes.length - 1]) : null;
  return { changes, next };
}

export type ProductInfo = { name: string; isActive: boolean };

/**
 * Nombres actuales de los platos de ESTE local que existen. Los que faltan (borrados) no aparecen en el mapa. `null` si
 * la base falló. El filtro por organización es necesario: la carta pública hace legibles los platos activos de cualquier
 * local, así que sin él el id de un plato ajeno parecería «de este local».
 */
export async function loadProductInfo(db: Db, orgId: string, productIds: string[]): Promise<Map<string, ProductInfo> | null> {
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return new Map();
  const { data, error } = await db.from("products").select("id, name, is_active").eq("organization_id", orgId).in("id", ids);
  if (error || !data) return null;
  return new Map(data.map((p) => [p.id, { name: p.name, isActive: p.is_active }]));
}

// ---------------------------------------------------------------------------
// Presentación (puro, probado sin base)
// ---------------------------------------------------------------------------

export type ChangeDescription = { direction: "up" | "down"; transition: string; difference: string };

/** «$ 2.700 → $ 2.800» y «Sube $ 100»: la dirección va en palabras, no solo en color. */
export function describeChange(oldCents: number, newCents: number): ChangeDescription {
  const up = newCents > oldCents;
  return {
    direction: up ? "up" : "down",
    transition: `${formatArs(oldCents)} → ${formatArs(newCents)}`,
    difference: up ? `Sube ${formatArs(newCents - oldCents)}` : `Baja ${formatArs(oldCents - newCents)}`,
  };
}

const whenFormat = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "America/Argentina/Buenos_Aires",
});

export function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : whenFormat.format(date);
}

/**
 * Quiénes siguen en el local, para el Dueño. `failed` = no se pudieron resolver (falta la clave de servicio, falla
 * de Auth…): el historial se muestra igual, con una etiqueta neutra. `none` = quien mira no es Dueño: no se busca nada.
 */
export type AuthorLookup =
  | { status: "none" }
  | { status: "failed" }
  | { status: "ok"; members: ReadonlyMap<string, { email: string; role: Role }> };

export const TECHNICAL_AUTHOR = "Operación técnica (sin usuario)";

/**
 * Etiqueta de «quién» (decisión del usuario, 2026-10-14): el Dueño ve el email de quien SIGUE en este local; el Staff
 * nunca ve el email de nadie. Quien ya no es miembro de este local no se identifica jamás.
 */
export function authorLabel(
  changedBy: string | null,
  viewer: { id: string; role: Role },
  lookup: AuthorLookup,
  roleLabel: Record<Role, string>,
): string {
  if (changedBy === null) return TECHNICAL_AUTHOR;
  if (changedBy === viewer.id) return "Vos";
  // Defensa en profundidad: aunque la página pasara un mapa, solo el Dueño recibe identidades.
  if (viewer.role !== "owner" || lookup.status === "none") return "Otra persona del equipo";
  if (lookup.status === "failed") return "Otra persona (no se pudo identificar)";
  const member = lookup.members.get(changedBy);
  return member ? `${member.email} (${roleLabel[member.role]})` : "Persona que ya no está en el local";
}

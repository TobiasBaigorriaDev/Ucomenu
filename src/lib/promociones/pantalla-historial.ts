import "server-only";
import { ROLE_LABEL } from "@/components/panel/app-shell";
import type { Role } from "@/lib/entitlements";
import { resolveAuthors, type PersonnelContext } from "@/lib/personnel";
import { authorLabel, formatWhen, type AuthorLookup } from "@/lib/precios/historial";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSessionClient } from "@/lib/supabase/server";
import { EVENT_LABEL, describeEntry, loadNameLookups, loadPromotionHistory, loadPromotionNames, parseCursor, type PromotionEvent } from "./historial";

/**
 * Arma lo que muestra la pantalla del historial de promociones. Server-only: usa la sesión de la persona (RLS) y, solo para el Dueño,
 * `resolveAuthors` (que comprueba el rol antes de tocar la clave de servicio). El Staff nunca recibe ni consulta emails (misma regla
 * que el historial de precios).
 */

export type PromotionHistoryRow = {
  id: string;
  event: PromotionEvent;
  eventLabel: string;
  promotionName: string;
  detail: string;
  whenIso: string;
  whenLabel: string;
  author: string;
};

export type PromotionHistoryScreen =
  | { state: "error" }
  | { state: "ok"; rows: PromotionHistoryRow[]; next: string | null; authorsNotice: boolean };

export async function loadPromotionHistoryScreen(input: { orgId: string; viewer: { id: string; role: Role }; rawCursor?: unknown }): Promise<PromotionHistoryScreen> {
  const db = await createSessionClient();
  const page = await loadPromotionHistory(db, input.orgId, parseCursor(input.rawCursor));
  if (!page) return { state: "error" };
  const [names, lookups] = await Promise.all([
    loadPromotionNames(
      db,
      input.orgId,
      page.entries.map((e) => e.promotionId),
    ),
    loadNameLookups(db, input.orgId, page.entries),
  ]);
  if (!names || !lookups) return { state: "error" };

  let lookup: AuthorLookup = { status: "none" };
  if (input.viewer.role === "owner") {
    lookup = { status: "failed" };
    const others = page.entries.flatMap((e) => (e.changedBy && e.changedBy !== input.viewer.id ? [e.changedBy] : []));
    try {
      const ctx: PersonnelContext = { session: db, admin: createAdminClient(), actorId: input.viewer.id };
      const result = await resolveAuthors(ctx, input.orgId, others);
      if (result.ok) lookup = { status: "ok", members: result.data };
    } catch {
      // Sin SUPABASE_SERVICE_ROLE_KEY u otra falla de Auth: el historial se muestra con etiquetas neutras.
    }
  }

  const rows = page.entries.map(
    (entry): PromotionHistoryRow => ({
      id: entry.id,
      event: entry.event,
      eventLabel: EVENT_LABEL[entry.event],
      promotionName: names.get(entry.promotionId) ?? "Promoción",
      detail: describeEntry(entry, lookups),
      whenIso: entry.changedAt,
      whenLabel: formatWhen(entry.changedAt),
      author: authorLabel(entry.changedBy, input.viewer, lookup, ROLE_LABEL),
    }),
  );
  return { state: "ok", rows, next: page.next, authorsNotice: lookup.status === "failed" };
}

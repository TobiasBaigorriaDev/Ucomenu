import "server-only";
import { ROLE_LABEL } from "@/components/panel/app-shell";
import type { Role } from "@/lib/entitlements";
import { resolveAuthors, type PersonnelContext } from "@/lib/personnel";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSessionClient } from "@/lib/supabase/server";
import {
  authorLabel,
  describeChange,
  formatWhen,
  loadBranchNames,
  loadPriceHistory,
  loadProductInfo,
  parseCursor,
  type AuthorLookup,
} from "./historial";

/**
 * Arma lo que muestran las dos pantallas del historial (del local y de un plato). Server-only: usa la sesión de la
 * persona (RLS) para el historial y los platos y, solo para el Dueño, `resolveAuthors` (que comprueba el rol antes de
 * tocar la clave de servicio). El Staff nunca recibe ni consulta emails.
 */

export type HistoryRow = {
  id: string;
  /** Nombre actual del plato, o `null` si fue eliminado. */
  productName: string | null;
  /** Id del plato solo si existe (para enlazar); un plato eliminado no se enlaza. */
  productLinkId: string | null;
  productInactive: boolean;
  /** `null` = precio general (base); con texto, el cambio fue del precio propio de esa sucursal. */
  branchName: string | null;
  direction: "up" | "down";
  transition: string;
  difference: string;
  whenIso: string;
  whenLabel: string;
  author: string;
};

export type HistoryScreen =
  | { state: "error" }
  | { state: "ok"; rows: HistoryRow[]; next: string | null; authorsNotice: boolean };

export async function loadHistoryScreen(input: {
  orgId: string;
  viewer: { id: string; role: Role };
  productId?: string;
  rawCursor?: unknown;
}): Promise<HistoryScreen> {
  const db = await createSessionClient();
  const page = await loadPriceHistory(db, input.orgId, { productId: input.productId, cursor: parseCursor(input.rawCursor) });
  if (!page) return { state: "error" };

  const products = await loadProductInfo(
    db,
    input.orgId,
    page.changes.map((c) => c.productId),
  );
  if (!products) return { state: "error" };
  const branches = await loadBranchNames(
    db,
    input.orgId,
    page.changes.flatMap((c) => (c.branchId ? [c.branchId] : [])),
  );
  if (!branches) return { state: "error" };

  let lookup: AuthorLookup = { status: "none" };
  if (input.viewer.role === "owner") {
    lookup = { status: "failed" };
    const others = page.changes.flatMap((c) => (c.changedBy && c.changedBy !== input.viewer.id ? [c.changedBy] : []));
    try {
      const ctx: PersonnelContext = { session: db, admin: createAdminClient(), actorId: input.viewer.id };
      const result = await resolveAuthors(ctx, input.orgId, others);
      if (result.ok) lookup = { status: "ok", members: result.data };
    } catch {
      // Sin SUPABASE_SERVICE_ROLE_KEY u otra falla de Auth: el historial se muestra con etiquetas neutras.
    }
  }

  const rows = page.changes.map((change): HistoryRow => {
    const product = products.get(change.productId);
    const description = describeChange(change.oldCents, change.newCents);
    return {
      id: change.id,
      productName: product?.name ?? null,
      productLinkId: product ? change.productId : null,
      productInactive: product ? !product.isActive : false,
      branchName: change.branchId ? (branches.get(change.branchId) ?? "Otra sucursal") : null,
      direction: description.direction,
      transition: description.transition,
      difference: description.difference,
      whenIso: change.changedAt,
      whenLabel: formatWhen(change.changedAt),
      author: authorLabel(change.changedBy, input.viewer, lookup, ROLE_LABEL),
    };
  });

  return { state: "ok", rows, next: page.next, authorsNotice: lookup.status === "failed" };
}

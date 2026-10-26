"use server";

import { revalidatePath } from "next/cache";
import { getEntitlements, requireOwner } from "@/lib/auth/session";
import { loadSales } from "@/lib/analitica/cargar";
import { getSummaryProvider } from "@/lib/analitica/proveedor-resumen";
import { buildFacts, generateSummary, hasEnoughOrders, MIN_ORDERS_FOR_SUMMARY, SUMMARY_COOLDOWN_MINUTES } from "@/lib/analitica/resumen";
import { analyticsTimeZone, parsePeriod } from "@/lib/analitica/ventas";
import type { FormState } from "@/lib/form-state";
import { createSessionClient } from "@/lib/supabase/server";

/**
 * Genera el resumen con IA de un período (ficha resumen-de-analitica-con-ia, ADR 0047). Solo el Dueño con el plan `analytics`.
 * Lee las ventas con su propia sesión (la base vuelve a comprobar todo), arma los hechos (agregados, sin motivos escritos por el
 * personal ni datos de comensales), se los entrega al servicio de IA, valida la respuesta y la guarda con `save_analytics_summary`.
 * Un mismo período y alcance no se regenera antes de `SUMMARY_COOLDOWN_MINUTES`: así se acota el gasto.
 */
export async function generateSummaryAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const slug = formData.get("org");
  if (typeof slug !== "string") throw new Error("Falta el local.");
  const { membership } = await requireOwner(slug, `/panel/${slug}/analitica`);
  const orgId = membership.org.id;

  const provider = getSummaryProvider();
  if (!provider) return { error: "El resumen con IA no está disponible en este momento." };
  const ent = await getEntitlements(orgId);
  if (ent?.features.includes("analytics") !== true) return { error: "La analítica no está incluida en el plan de esta cuenta." };

  const days = parsePeriod(formData.get("dias"));
  const branchSlug = formData.get("sucursal");
  const db = await createSessionClient();
  const branches = (await db.from("branches").select("id, slug, timezone").eq("organization_id", orgId).eq("is_active", true)).data ?? [];
  const branch = typeof branchSlug === "string" && branchSlug ? (branches.find((item) => item.slug === branchSlug) ?? null) : null;
  if (typeof branchSlug === "string" && branchSlug && !branch) return { error: "No encontramos esa sucursal." };

  // Un mismo período y alcance no se regenera enseguida.
  const query = db.from("analytics_summaries").select("generated_at").eq("organization_id", orgId).eq("days", days);
  const last = (await (branch ? query.eq("branch_id", branch.id) : query.is("branch_id", null)).maybeSingle()).data;
  if (last) {
    const waitMs = SUMMARY_COOLDOWN_MINUTES * 60_000 - (Date.now() - new Date(last.generated_at).getTime());
    if (waitMs > 0) return { error: `Ya generaste este resumen hace poco. Podés actualizarlo en ${Math.ceil(waitMs / 60_000)} min.` };
  }

  const { sales, products } = await loadSales(db, orgId, days, branch?.id ?? null);
  if (!sales || !products) return { error: "No pudimos leer las ventas para armar el resumen. Probá de nuevo en unos minutos." };
  if (!hasEnoughOrders(sales)) {
    return { error: `Todavía hay pocos pedidos en este período para resumir (hacen falta al menos ${MIN_ORDERS_FOR_SUMMARY}).` };
  }

  const facts = buildFacts(sales, products, { timeZone: analyticsTimeZone(branches, branch), allBranches: branch === null });
  const outcome = await generateSummary(provider, facts);
  if (!outcome.ok) {
    return {
      error:
        outcome.error === "unavailable"
          ? "No se pudo generar el resumen. Probá de nuevo en unos minutos."
          : "El resumen que armó la IA no pasó los controles de confiabilidad. Probá de nuevo.",
    };
  }

  const saved = await db.rpc("save_analytics_summary", {
    p_org: orgId,
    p_days: days,
    p_content: outcome.summary,
    p_provider: provider.name,
    ...(branch ? { p_branch: branch.id } : {}),
  });
  if (saved.error) return { error: "El resumen se generó pero no se pudo guardar. Probá de nuevo." };

  revalidatePath(`/panel/${slug}/analitica`);
  return { ok: true, message: "Resumen generado." };
}

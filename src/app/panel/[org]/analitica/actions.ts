"use server";

import { revalidatePath } from "next/cache";
import { getEntitlements, requireOwner } from "@/lib/auth/session";
import { loadSales } from "@/lib/analitica/cargar";
import { getSummaryProvider } from "@/lib/analitica/proveedor-resumen";
import { buildFacts, generateSummary, hasEnoughOrders, MIN_ORDERS_FOR_SUMMARY, SUMMARY_COOLDOWN_MINUTES } from "@/lib/analitica/resumen";
import { analyticsTimeZone, parsePeriod } from "@/lib/analitica/ventas";
import type { FormState } from "@/lib/form-state";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSessionClient } from "@/lib/supabase/server";

/**
 * Genera el resumen con IA de un período (ficha resumen-de-analitica-con-ia, ADR 0047). Solo el Dueño con el plan `analytics`.
 * Lee las ventas con su propia sesión (la base vuelve a comprobar todo), reserva el período en la base (`claim_analytics_summary`:
 * atómico, un pedido a la vez y `SUMMARY_COOLDOWN_MINUTES` entre generaciones), arma los hechos (agregados, sin motivos escritos por
 * el personal ni datos de comensales), se los entrega al servicio de IA, valida la respuesta y la guarda con
 * `save_analytics_summary`, que SOLO ejecuta el servicio técnico: así el Dueño no puede escribir por la API un texto que no pasó la
 * validación. Si algo falla después de reservar, la reserva se devuelve.
 */
export async function generateSummaryAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const slug = formData.get("org");
  if (typeof slug !== "string") throw new Error("Falta el local.");
  const { user, membership } = await requireOwner(slug, `/panel/${slug}/analitica`);
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
  const branchArg = branch ? { p_branch: branch.id } : {};

  // Lo barato primero: sin ventas legibles o con pocos pedidos no se reserva ni se llama al servicio.
  const { sales, products } = await loadSales(db, orgId, days, branch?.id ?? null);
  if (!sales || !products) return { error: "No pudimos leer las ventas para armar el resumen. Probá de nuevo en unos minutos." };
  if (!hasEnoughOrders(sales)) {
    return { error: `Todavía hay pocos pedidos en este período para resumir (hacen falta al menos ${MIN_ORDERS_FOR_SUMMARY}).` };
  }

  // Reserva atómica: dos pedidos simultáneos del mismo período y alcance no pasan los dos.
  const reserved = await db.rpc("claim_analytics_summary", { p_org: orgId, p_days: days, p_cooldown_minutes: SUMMARY_COOLDOWN_MINUTES, ...branchArg });
  const claim = reserved.data as { claimed?: boolean; claim?: string; wait_seconds?: number } | null;
  if (reserved.error || !claim) return { error: "No pudimos reservar el resumen. Probá de nuevo en unos minutos." };
  if (!claim.claimed || typeof claim.claim !== "string") {
    const minutes = Math.max(1, Math.ceil((claim.wait_seconds ?? 60) / 60));
    return { error: `Ya generaste este resumen hace poco. Podés actualizarlo en ${minutes} min.` };
  }
  const claimedAt = claim.claim;
  const release = () => db.rpc("release_analytics_summary_claim", { p_org: orgId, p_days: days, p_claim: claimedAt, ...branchArg });

  try {
    const facts = buildFacts(sales, products, { timeZone: analyticsTimeZone(branches, branch), allBranches: branch === null });
    const outcome = await generateSummary(provider, facts);
    if (!outcome.ok) {
      await release();
      return {
        error:
          outcome.error === "unavailable"
            ? "No se pudo generar el resumen. Probá de nuevo en unos minutos."
            : "El resumen que armó la IA no pasó los controles de confiabilidad. Probá de nuevo.",
      };
    }

    // Solo el servicio técnico guarda, y solo lo que ya pasó la validación; la función vuelve a comprobar que quien pidió sea Dueño.
    const saved = await createAdminClient().rpc("save_analytics_summary", {
      p_org: orgId,
      p_user: user.id,
      p_days: days,
      p_content: outcome.summary,
      p_provider: provider.name,
      ...branchArg,
    });
    if (saved.error) {
      await release();
      return { error: "El resumen se generó pero no se pudo guardar. Probá de nuevo." };
    }
  } catch {
    await release();
    return { error: "No se pudo generar el resumen. Probá de nuevo en unos minutos." };
  }

  revalidatePath(`/panel/${slug}/analitica`);
  return { ok: true, message: "Resumen generado." };
}

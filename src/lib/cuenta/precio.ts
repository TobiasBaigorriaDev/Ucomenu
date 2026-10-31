import { formatMoney } from "@/lib/admin/format";
import type { Entitlements } from "@/lib/entitlements";

/**
 * Cuánto cuesta la suscripción del Dueño (ficha precio-en-suscripcion). Son los PRECIOS DE LISTA: el del plan sale del catálogo
 * (`plans`, en USD, legible con sesión) según el plan y el ciclo de la cuenta; el de las sucursales adicionales, de lo que ya entrega
 * `org_entitlements` al Dueño. Lo que se pagó de verdad (importe y moneda del cobro manual) vive en «Pagos». Las dos monedas no se
 * suman nunca (no hay tipo de cambio acá): cada una va en su línea. Puro: se prueba en `precio.test.ts`.
 */

export type PlanCatalogPrice = { monthlyUsdCents: number; yearlyUsdCents: number };

export type PriceSummary = {
  /** Lo principal: «US$ 40 USD por mes» o, en la prueba gratuita, «Sin costo durante la prueba». */
  headline: string;
  /** Detalle: lo que sigue después de la prueba y las sucursales adicionales. */
  lines: string[];
};

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** «US$ 40 USD por mes» / «US$ 380 USD por año»; `null` si falta el ciclo o el catálogo. */
export function planPriceText(cycle: string | undefined, catalog: PlanCatalogPrice | null): string | null {
  if (!catalog) return null;
  if (cycle === "monthly") return `${formatMoney(catalog.monthlyUsdCents, "USD")} por mes`;
  if (cycle === "yearly") return `${formatMoney(catalog.yearlyUsdCents, "USD")} por año`;
  return null;
}

/** El resumen de lo que cuesta la cuenta, o `null` si no hay con qué armarlo (sin plan, o sin ciclo y sin prueba): no se inventa un precio. */
export function describePrice(ent: Entitlements | null, catalog: PlanCatalogPrice | null): PriceSummary | null {
  if (!ent?.plan) return null;
  const plan = planPriceText(ent.billingCycle, catalog);
  const inTrial = ent.trialStatus === "in_trial";
  const lines: string[] = [];

  if (!plan && !inTrial) return null;
  if (inTrial && plan) lines.push(`Después de la prueba: ${plan}.`);

  const extra = ent.extraBranches ?? 0;
  if (extra > 0 && typeof ent.extraBranchPriceCents === "number" && ent.extraBranchCurrency) {
    const total = formatMoney(ent.extraBranchPriceCents * extra, ent.extraBranchCurrency);
    lines.push(`Más ${total} por mes por ${plural(extra, "sucursal adicional", "sucursales adicionales")}${inTrial ? " (cuando termine la prueba)" : ""}.`);
  }
  return { headline: inTrial ? "Sin costo durante la prueba" : plan!, lines };
}

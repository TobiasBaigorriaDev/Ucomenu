import type { MesasState } from "@/lib/sala/mesas";

/**
 * El salón en este momento, para el Resumen del panel (ficha resumen-del-panel). Resume el mismo estado que la vista «Mesas» de la
 * Sala (`loadMesas`): quien ve ese estado ahí, lo ve acá, con las mismas sucursales. Puro: se prueba en `ahora.test.ts`.
 */

export type AhoraView = {
  /** Mesas con un pedido abierto con platos. */
  tablesWithOrder: number;
  /** Mesas activas de las sucursales que la persona mira. */
  tablesTotal: number;
  /** Llamados pendientes en esas sucursales (mozo + cuenta). */
  pendingCalls: number;
  waiterCalls: number;
  billCalls: number;
  /** Platos anotados o en cocina, sin entregar ni estar listos. */
  inKitchen: number;
  /** Platos que la cocina marcó listos para llevar. */
  ready: number;
  /** Suma de los pedidos abiertos, en centavos. */
  openCents: number;
  /** Llamados de sucursales que la persona no mira (solo la cantidad, como en Mesas). */
  othersPending: number;
};

/** `null` si el plan o la cuenta no permiten pedidos (no hay salón en vivo que mostrar). */
export function buildAhora(state: MesasState): AhoraView | null {
  if (!state.enabled) return null;
  const view: AhoraView = {
    tablesWithOrder: 0,
    tablesTotal: state.mesas.length,
    pendingCalls: 0,
    waiterCalls: 0,
    billCalls: 0,
    inKitchen: 0,
    ready: 0,
    openCents: 0,
    othersPending: state.othersPending,
  };
  for (const mesa of state.mesas) {
    for (const call of mesa.calls) {
      view.pendingCalls += 1;
      if (call.kind === "bill") view.billCalls += 1;
      else view.waiterCalls += 1;
    }
    if (!mesa.order) continue;
    view.tablesWithOrder += 1;
    view.inKitchen += mesa.order.noted + mesa.order.inKitchen;
    view.ready += mesa.order.ready;
    view.openCents += mesa.order.totalCents;
  }
  return view;
}

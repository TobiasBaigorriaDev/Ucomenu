"use client";

import { useSyncExternalStore } from "react";

/**
 * Cuántos llamados pendientes hay, para que la navegación del panel marque «Sala en vivo» en modo alerta. Lo escribe el
 * cartel de llamados (que es quien consulta) y lo lee la navegación; viven en el mismo navegador y no se persiste nada.
 */
let count = 0;
const listeners = new Set<() => void>();

export function setPendingCalls(next: number) {
  if (next === count) return;
  count = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function usePendingCalls(): number {
  return useSyncExternalStore(subscribe, () => count, () => 0);
}

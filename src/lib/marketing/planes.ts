/** Precios de portada en pesos; los limites se contrastan con plans. */

export type PlanVendido = {
  code: "basic" | "pro";
  nombre: string;
  mensualArs: number;
  anualArs: number | null;
  maxSucursales: number;
  maxMesasPorSucursal: number;
  maxPlatosActivos: number;
};

export const PLANES: readonly PlanVendido[] = [
  { code: "basic", nombre: "Básico", mensualArs: 14_900, anualArs: 143_040, maxSucursales: 1, maxMesasPorSucursal: 20, maxPlatosActivos: 80 },
  { code: "pro", nombre: "Pro", mensualArs: 29_000, anualArs: null, maxSucursales: 2, maxMesasPorSucursal: 50, maxPlatosActivos: 200 },
];

export const precioArs = (plan: PlanVendido): string => `ARS ${plan.mensualArs.toLocaleString("es-AR")}`;

/** Sucursal adicional del plan Pro, en pesos por mes (ADR 0039); también vive en la base. */
export const SUCURSAL_ADICIONAL_ARS = 12_000;

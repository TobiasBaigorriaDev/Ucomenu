/** Precios de portada en pesos; los precios y los limites se contrastan con `plans` (tests/rls/portada-planes.rls.test.ts). */

export type PlanVendido = {
  code: "basic" | "pro";
  nombre: string;
  mensualArs: number;
  anualArs: number;
  maxSucursales: number;
  maxMesasPorSucursal: number;
  maxPlatosActivos: number;
};

export const PLANES: readonly PlanVendido[] = [
  { code: "basic", nombre: "Básico", mensualArs: 14_900, anualArs: 143_040, maxSucursales: 1, maxMesasPorSucursal: 20, maxPlatosActivos: 80 },
  { code: "pro", nombre: "Pro", mensualArs: 29_000, anualArs: 278_400, maxSucursales: 2, maxMesasPorSucursal: 50, maxPlatosActivos: 200 },
];

export const precioArs = (plan: PlanVendido): string => `ARS ${plan.mensualArs.toLocaleString("es-AR")}`;

/** Sucursal adicional del plan Pro, en pesos por mes (ADR 0039); también vive en la base. */
export const SUCURSAL_ADICIONAL_ARS = 12_000;

const basico = PLANES[0];
const pro = PLANES[1];

/** Qué incluye cada plan, tal como se vende en la portada. */
export const PLAN_INCLUYE: Record<PlanVendido["code"], string[]> = {
  basic: [
    "Carta digital con un QR por cada mesa",
    "Tu logo, 12 paletas y 5 estilos de carta",
    `${basico.maxSucursales} sucursal`,
    `Hasta ${basico.maxMesasPorSucursal} mesas`,
    `Hasta ${basico.maxPlatosActivos} platos activos`,
  ],
  pro: [
    "Todo lo del plan Básico",
    "Llamar al mozo, pedir la cuenta y Mesas en vivo",
    "Pedidos que anota el mozo y pantalla de cocina",
    "Gestión de reservas y asignación de mesas",
    "Promociones y Happy Hour programados",
    "Invitación a dejar una reseña en Google",
    "Analítica con resumen de IA",
    "Videos cortos en tu carta, con me gusta y comentarios (hasta 10 publicados)",
    `Hasta ${pro.maxSucursales} sucursales (y hasta 3 adicionales)`,
    `Hasta ${pro.maxMesasPorSucursal} mesas por sucursal`,
    `Hasta ${pro.maxPlatosActivos} platos activos`,
  ],
};

/** Lo que Pro suma, para el selector del panel: las funciones, sin el renglón «todo lo de Básico» ni los topes. */
export const PLAN_DESTACADOS: { pro: string[] } = {
  pro: PLAN_INCLUYE.pro.slice(1, 8),
};

/** Los topes en una línea. */
export const PLAN_LIMITES: Record<string, string> = {
  basic: `${basico.maxSucursales} sucursal, hasta ${basico.maxMesasPorSucursal} mesas y ${basico.maxPlatosActivos} platos activos.`,
  pro: `Hasta ${pro.maxSucursales} sucursales, ${pro.maxMesasPorSucursal} mesas por sucursal y ${pro.maxPlatosActivos} platos activos.`,
};

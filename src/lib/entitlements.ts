/**
 * Lectura tipada de `org_entitlements(org)` (ADR 0006) y avisos de mora del panel.
 * Funciones puras: se prueban en `entitlements.test.ts`.
 */

export type BillingState = "active" | "grace" | "read_only" | "suspended";
export type Role = "owner" | "staff" | "cook";

/**
 * Estado de la prueba gratuita, aparte de la mora (misma regla que `private.trial_status` de la base):
 *  - `none`: nunca tuvo prueba, o el alta del SuperAdmin la reemplazó por un plan con fecha.
 *  - `in_trial`: la prueba corre.
 *  - `expired`: terminó y nadie asignó ni pagó un período. Desde ahí rige la mora (ADR 0006), que no es otro estado de la prueba.
 *  - `converted`: ya tiene un período propio (pago o asignación posterior).
 */
export type TrialStatus = "none" | "in_trial" | "expired" | "converted";

export type Entitlements = {
  state: BillingState;
  canWrite: boolean;
  features: string[];
  /** Solo para el Dueño: el Staff no recibe plan ni fechas (ADR 0006). */
  plan?: string;
  billingCycle?: string;
  periodEnd?: string;
  daysLate?: number;
  /** Solo para el Dueño. */
  trialStatus?: TrialStatus;
  trialEndsAt?: string;
  /** Solo para el Dueño: la cuenta la suspendió a mano el equipo de UcoMenu (no es mora). */
  suspendedManually?: boolean;
  /**
   * Solo para el Dueño de un plan que admite sucursales adicionales (Pro): cuántas tiene vigentes, el precio mensual de cada una
   * y cuántas se pueden contratar en total. El Staff no recibe ni cantidad ni precio.
   */
  extraBranches?: number;
  extraBranchPriceCents?: number;
  extraBranchCurrency?: string;
  extraBranchMax?: number;
  limits: Record<string, number | null>;
  usage: Record<string, number>;
};

const STATES: readonly BillingState[] = ["active", "grace", "read_only", "suspended"];
const TRIAL_STATUSES: readonly TrialStatus[] = ["none", "in_trial", "expired", "converted"];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseEntitlements(raw: unknown): Entitlements | null {
  if (!isRecord(raw)) return null;
  const state = STATES.find((s) => s === raw.state);
  if (!state) return null;

  const numbers = (value: unknown): Record<string, number> =>
    isRecord(value)
      ? Object.fromEntries(Object.entries(value).filter((e): e is [string, number] => typeof e[1] === "number"))
      : {};

  return {
    state,
    canWrite: raw.can_write === true,
    features: Array.isArray(raw.features) ? raw.features.filter((f): f is string => typeof f === "string") : [],
    plan: typeof raw.plan === "string" ? raw.plan : undefined,
    billingCycle: typeof raw.billing_cycle === "string" ? raw.billing_cycle : undefined,
    periodEnd: typeof raw.period_end === "string" ? raw.period_end : undefined,
    daysLate: typeof raw.days_late === "number" ? raw.days_late : undefined,
    trialStatus: TRIAL_STATUSES.find((t) => t === raw.trial_status),
    trialEndsAt: typeof raw.trial_ends_at === "string" ? raw.trial_ends_at : undefined,
    suspendedManually: raw.suspended_manually === true ? true : undefined,
    extraBranches: typeof raw.extra_branches === "number" ? raw.extra_branches : undefined,
    extraBranchPriceCents: typeof raw.extra_branch_price_cents === "number" ? raw.extra_branch_price_cents : undefined,
    extraBranchCurrency: typeof raw.extra_branch_currency === "string" ? raw.extra_branch_currency : undefined,
    extraBranchMax: typeof raw.extra_branch_max === "number" ? raw.extra_branch_max : undefined,
    limits: isRecord(raw.limits)
      ? Object.fromEntries(
          Object.entries(raw.limits).filter((e): e is [string, number | null] => e[1] === null || typeof e[1] === "number"),
        )
      : {},
    usage: numbers(raw.usage),
  };
}

/** Precio mensual como lo lee el Dueño: «ARS 12.000» (sin centavos si son cero). */
export function formatMonthlyPrice(cents: number, currency: string): string {
  const amount = new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
  return `${currency} ${amount}`;
}

/**
 * Cómo se reparte el tope de sucursales del Dueño: las del plan y las adicionales (con su costo mensual). `null` si no tiene
 * adicionales vigentes o si no hay tope numérico.
 */
export function branchBreakdown(ent: Entitlements | null): string | null {
  const limit = ent?.limits.branches;
  const extra = ent?.extraBranches;
  if (typeof limit !== "number" || !extra || extra < 1) return null;
  const price =
    typeof ent?.extraBranchPriceCents === "number" && ent.extraBranchCurrency
      ? ` · ${formatMonthlyPrice(ent.extraBranchPriceCents * extra, ent.extraBranchCurrency)}/mes`
      : "";
  return `${limit - extra} del plan + ${extra} ${extra === 1 ? "adicional" : "adicionales"}${price}`;
}

export const PLAN_NAME: Record<string, string> = { basic: "Básico", pro: "Pro", premium: "Premium" };

const DAY_MS = 24 * 60 * 60 * 1000;
const GRACE_DAYS = 7;
const READ_ONLY_DAYS = 15;

export const BILLING_STATE_LABEL: Record<BillingState, string> = {
  active: "Al día",
  grace: "Vencida, en período de gracia",
  read_only: "Vencida, en solo lectura",
  suspended: "Suspendida",
};

/**
 * Estado de la cuenta a partir del fin del período y un instante: la MISMA regla que `private.billing_state` de la base
 * (bordes inclusivos: gracia hasta +168 h, solo lectura hasta +360 h; sin fecha, suspendida). La base es la autoridad;
 * esto existe para pantallas que no pueden preguntarle (p. ej. el listado del SuperAdmin) y una prueba de RLS lo compara
 * con la función real en los bordes para que no se desvíe.
 */
export function billingState(periodEnd: string | Date | null, at: Date = new Date()): BillingState {
  if (periodEnd === null) return "suspended";
  const end = new Date(periodEnd).getTime();
  if (Number.isNaN(end)) return "suspended";
  const t = at.getTime();
  if (t <= end) return "active";
  if (t <= end + GRACE_DAYS * DAY_MS) return "grace";
  if (t <= end + READ_ONLY_DAYS * DAY_MS) return "read_only";
  return "suspended";
}

/**
 * Estado de la cuenta con la suspensión manual: manda sobre las fechas (misma regla que `private.org_state`).
 * Reactivar no extiende nada: sin suspensión, vuelve al estado de las fechas.
 */
export function accountState(periodEnd: string | Date | null, suspendedManually: boolean, at: Date = new Date()): BillingState {
  return suspendedManually ? "suspended" : billingState(periodEnd, at);
}

/** Misma regla que `private.trial_status` de la base. */
export function trialStatus(
  trialEndsAt: string | Date | null,
  currentPeriodEnd: string | Date | null,
  at: Date = new Date(),
): TrialStatus {
  if (trialEndsAt === null) return "none";
  if (currentPeriodEnd !== null) return "converted";
  const end = new Date(trialEndsAt).getTime();
  if (Number.isNaN(end)) return "expired";
  return at.getTime() <= end ? "in_trial" : "expired";
}

export const TRIAL_STATUS_LABEL: Record<TrialStatus, string> = {
  none: "Sin prueba",
  in_trial: "En prueba gratuita",
  expired: "Prueba vencida",
  converted: "Ya pasó a un período propio",
};

export type MoraNotice = {
  tone: "grace" | "read_only" | "suspended";
  title: string;
  body: string;
};

/** Fecha corta en es-AR en la zona del negocio (las sucursales aún no tienen zona propia). */
export function formatDate(iso: string | number | Date): string {
  return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", timeZone: "America/Argentina/Buenos_Aires" }).format(
    new Date(iso),
  );
}

/** Fecha con año, para la pantalla de suscripción. */
export function formatDateWithYear(iso: string | number | Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(iso));
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/**
 * Qué aviso muestra el panel según el estado de la cuenta y el rol. `active` no muestra nada.
 * El Staff solo recibe el estado (sin días ni fechas): coincide con lo que le devuelve la base.
 */
export function moraNotice(ent: Entitlements | null, role: Role): MoraNotice | null {
  if (!ent || ent.state === "active") return null;

  const end = ent.periodEnd ? new Date(ent.periodEnd).getTime() : null;
  const owner = role === "owner";

  if (ent.state === "grace") {
    if (!owner) {
      return {
        tone: "grace",
        title: "El pago de la suscripción está vencido",
        body: "Podés trabajar con normalidad por ahora. Avisale al dueño para que no pase a solo lectura.",
      };
    }
    const dias = ent.daysLate ?? 1;
    const hasta = end !== null ? ` hasta el ${formatDate(end + GRACE_DAYS * DAY_MS)}` : "";
    return {
      tone: "grace",
      title: `Tu suscripción venció hace ${plural(dias, "día", "días")}`,
      body: `Podés seguir trabajando con normalidad${hasta}; después la cuenta pasa a solo lectura. Contactá a UcoMenu para registrar el pago.`,
    };
  }

  if (ent.state === "read_only") {
    if (!owner) {
      return {
        tone: "read_only",
        title: "La cuenta está en solo lectura",
        body: "Podés ver todo, pero no editar. Avisale al dueño para regularizar el pago.",
      };
    }
    const hasta = end !== null ? ` Si no se regulariza antes del ${formatDate(end + READ_ONLY_DAYS * DAY_MS)}, la carta deja de mostrarse.` : "";
    return {
      tone: "read_only",
      title: "Tu cuenta está en solo lectura",
      body: `Podés ver todo, pero no editar la carta.${hasta} Contactá a UcoMenu para registrar el pago.`,
    };
  }

  if (owner && ent.suspendedManually) {
    return {
      tone: "suspended",
      title: "Tu cuenta fue suspendida por UcoMenu",
      body: "La carta no se muestra a tus clientes. Tus datos están a salvo. Contactá a UcoMenu para saber el motivo y reactivarla.",
    };
  }

  return owner
    ? {
        tone: "suspended",
        title: "Tu cuenta está suspendida",
        body: "La carta no se muestra a tus clientes. Tus datos están a salvo. Contactá a UcoMenu para registrar el pago y reactivarla.",
      }
    : {
        tone: "suspended",
        title: "La cuenta está suspendida",
        body: "La carta no se muestra al público. Avisale al dueño para regularizar el pago.",
      };
}

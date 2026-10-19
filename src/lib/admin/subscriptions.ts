import { asUuid } from "@/lib/carta/validation";
import { accountState, trialStatus, type BillingState, type TrialStatus } from "@/lib/entitlements";
import {
  fail,
  isPlatformAdmin,
  listAuditLog,
  ok,
  type AdminContext,
  type AdminError,
  type AuditEntry,
  type Result,
} from "./organizations";
import {
  isBillingCycle,
  isCurrency,
  isPaymentMethod,
  isPlanCode,
  parseAmountToCents,
  parsePaidOn,
  parsePeriodEnd,
  parseReason,
  parseReference,
  parseSlug,
} from "./validation";

/**
 * Cambio de plan, suspensión/reactivación y pagos a mano del SuperAdmin (nivel C, ficha superadmin-planes-pagos).
 *
 * Mismo patrón que el alta (ADR 0013): la identidad se prueba con la sesión de la PERSONA (RLS sobre `platform_admins`)
 * antes de usar la clave de servicio, y cada cambio es UNA función de base que solo ejecuta `service_role`, vuelve a
 * comprobar al actor, bloquea la suscripción y escribe la auditoría en la misma transacción. `actorId` sale de `getUser()`.
 *
 * Todo se valida acá ANTES de llamar a la base para dar un mensaje claro; la base valida de nuevo (es la autoridad).
 */

const SQLSTATE = /^[0-9A-Z]{5}$/;

/** Mensajes estables de las funciones de base → error de la aplicación. */
const DB_ERRORS: Record<string, AdminError> = {
  not_platform_admin: "forbidden",
  subscription_not_found: "org_not_found",
  organization_not_found: "org_not_found",
  account_changed: "account_changed",
  membership_changed: "account_changed",
  invalid_reason: "invalid_reason",
  invalid_plan: "invalid_plan",
  invalid_cycle: "invalid_cycle",
  invalid_amount: "invalid_amount",
  invalid_currency: "invalid_currency",
  invalid_method: "invalid_method",
  invalid_reference: "invalid_reference",
  invalid_paid_on: "invalid_paid_on",
  invalid_period: "invalid_covers_until",
  plan_unchanged: "plan_unchanged",
  already_suspended: "already_suspended",
  not_suspended: "not_suspended",
  payment_not_extending: "payment_not_extending",
  payment_not_found: "payment_not_found",
  payment_already_voided: "payment_already_voided",
  payment_not_latest: "payment_not_latest",
  payment_history_inconsistent: "payment_history_inconsistent",
};

/**
 * Traduce el fallo de una función de base. Solo un error con SQLSTATE vino de Postgres, que revirtió la transacción
 * (seguro). Cualquier otro (red cortada, tiempo agotado) deja el resultado INCIERTO: el cambio pudo confirmarse y
 * perderse solo la respuesta; no se asume nada y se pide mirar el estado antes de repetir.
 */
export function dbFailure(error: { code?: string; message?: string }): Result<never> {
  if (typeof error.code !== "string" || !SQLSTATE.test(error.code)) return fail("uncertain_change");
  return fail(DB_ERRORS[error.message ?? ""] ?? "unexpected");
}

/** Id de la organización por su slug. Solo después de haber probado que quien pide es SuperAdmin. */
export async function findOrgId(ctx: AdminContext, rawSlug: unknown): Promise<Result<string>> {
  const slug = parseSlug(rawSlug);
  if (!slug) return fail("org_not_found");
  const { data, error } = await ctx.admin.from("organizations").select("id").eq("slug", slug).maybeSingle();
  if (error) return fail("unexpected");
  return data ? ok(data.id) : fail("org_not_found");
}

export type ChangePlanInput = { slug: unknown; plan: unknown; billingCycle: unknown; reason: unknown };

/** Cambia el plan y el ciclo. No toca fechas ni borra nada (bajar de plan conserva los datos). */
export async function changePlan(ctx: AdminContext, input: ChangePlanInput): Promise<Result> {
  if (!(await isPlatformAdmin(ctx))) return fail("forbidden");
  if (!isPlanCode(input.plan)) return fail("invalid_plan");
  if (!isBillingCycle(input.billingCycle)) return fail("invalid_cycle");
  const reason = parseReason(input.reason);
  if (!reason) return fail("invalid_reason");
  const org = await findOrgId(ctx, input.slug);
  if (!org.ok) return org;

  const { error } = await ctx.admin.rpc("admin_change_plan", {
    p_actor: ctx.actorId,
    p_org: org.data,
    p_plan: input.plan,
    p_billing_cycle: input.billingCycle,
    p_reason: reason,
  });
  return error ? dbFailure(error) : ok(undefined);
}

export type SuspensionInput = { slug: unknown; suspend: boolean; reason: unknown };

/** Suspende (`suspend: true`) o reactiva a mano. Reactivar no extiende fechas: vuelve al estado que digan. */
export async function setSuspension(ctx: AdminContext, input: SuspensionInput): Promise<Result> {
  if (!(await isPlatformAdmin(ctx))) return fail("forbidden");
  const reason = parseReason(input.reason);
  if (!reason) return fail("invalid_reason");
  const org = await findOrgId(ctx, input.slug);
  if (!org.ok) return org;

  const { error } = await ctx.admin.rpc("admin_set_suspension", {
    p_actor: ctx.actorId,
    p_org: org.data,
    p_suspend: input.suspend === true,
    p_reason: reason,
  });
  return error ? dbFailure(error) : ok(undefined);
}

export type RegisterPaymentInput = {
  slug: unknown;
  /** Importe como lo escribe la persona («20000», «20.000,50»). */
  amount: unknown;
  currency: unknown;
  method: unknown;
  reference: unknown;
  /** `AAAA-MM-DD`: día en que se recibió el dinero (Argentina). */
  paidOn: unknown;
  /** `AAAA-MM-DD`: la suscripción queda vigente hasta el final de ese día (Argentina). */
  coversUntil: unknown;
};

/** Registra un pago y mueve la vigencia. El pago solo se agrega; la vigencia nunca se acorta ni se repite. */
export async function registerPayment(
  ctx: AdminContext,
  input: RegisterPaymentInput,
  now: Date = new Date(),
): Promise<Result<{ paymentId: string }>> {
  if (!(await isPlatformAdmin(ctx))) return fail("forbidden");
  const cents = parseAmountToCents(input.amount);
  if (cents === null) return fail("invalid_amount");
  if (!isCurrency(input.currency)) return fail("invalid_currency");
  if (!isPaymentMethod(input.method)) return fail("invalid_method");
  const reference = parseReference(input.reference);
  if (reference === null) return fail("invalid_reference");
  const paidOn = parsePaidOn(input.paidOn, now);
  if (!paidOn) return fail("invalid_paid_on");
  const coversUntil = parsePeriodEnd(input.coversUntil, now);
  if (!coversUntil) return fail("invalid_covers_until");
  const org = await findOrgId(ctx, input.slug);
  if (!org.ok) return org;

  const { data, error } = await ctx.admin.rpc("admin_register_payment", {
    p_actor: ctx.actorId,
    p_org: org.data,
    p_amount_cents: cents,
    p_currency: input.currency,
    p_method: input.method,
    p_reference: reference,
    p_paid_on: paidOn,
    p_covers_until: coversUntil,
  });
  if (error) return dbFailure(error);
  if (typeof data !== "string") return fail("uncertain_change");
  return ok({ paymentId: data });
}

export type VoidPaymentInput = { slug: unknown; paymentId: unknown; reason: unknown };

/**
 * Anula un pago (ficha anular-pagos): asiento compensatorio con motivo; la vigencia vuelve a la de antes del pago. Solo el
 * último pago vigente; el pago no se modifica. Corregir = anular y registrar el correcto.
 */
export async function voidPayment(ctx: AdminContext, input: VoidPaymentInput): Promise<Result<{ voidId: string }>> {
  if (!(await isPlatformAdmin(ctx))) return fail("forbidden");
  const reason = parseReason(input.reason);
  if (!reason) return fail("invalid_reason");
  const paymentId = asUuid(input.paymentId);
  if (!paymentId) return fail("payment_not_found");
  const org = await findOrgId(ctx, input.slug);
  if (!org.ok) return org;

  const { data, error } = await ctx.admin.rpc("admin_void_payment", {
    p_actor: ctx.actorId,
    p_org: org.data,
    p_payment: paymentId,
    p_reason: reason,
  });
  if (error) return dbFailure(error);
  if (typeof data !== "string") return fail("uncertain_change");
  return ok({ voidId: data });
}

// ---------------------------------------------------------------------------
// Lectura: detalle de una organización
// ---------------------------------------------------------------------------

export type PaymentRow = {
  id: string;
  createdAt: string;
  paidOn: string;
  amountCents: number;
  currency: string;
  method: string;
  reference: string | null;
  plan: string;
  billingCycle: string;
  previousPeriodEnd: string;
  coversUntil: string;
  /** Anulación (cuándo y por qué), o `null` si el pago sigue vigente. */
  voided: { at: string; reason: string } | null;
};

/**
 * ¿Se puede anular este pago? Solo el que define la vigencia actual (el último vigente): su «cubre hasta» es el
 * `current_period_end` de la suscripción. La base decide de verdad; esto solo evita ofrecer un botón que daría error.
 */
export function isVoidable(payment: Pick<PaymentRow, "coversUntil" | "voided">, currentPeriodEnd: string | null): boolean {
  if (payment.voided !== null || currentPeriodEnd === null) return false;
  return new Date(payment.coversUntil).getTime() === new Date(currentPeriodEnd).getTime();
}

export type OrganizationDetail = {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
  ownerEmails: string[];
  plan: string;
  billingCycle: string;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  /** Fin efectivo: el mayor entre `current_period_end` y `trial_ends_at`. */
  periodEnd: string | null;
  suspendedAt: string | null;
  state: BillingState;
  trial: TrialStatus;
  payments: PaymentRow[];
  audit: AuditEntry[];
};

export const PAYMENTS_LIMIT = 50;

const PAYMENT_COLUMNS =
  "id, created_at, paid_on, amount_cents, currency, method, reference, plan_code, billing_cycle, previous_period_end, covers_until";

/**
 * Ficha de una organización para el SuperAdmin: suscripción, pagos y movimientos. La suscripción se lee con la clave de
 * servicio (la política la deja solo al Dueño); los pagos y la auditoría, con la sesión de la persona, donde la RLS deja
 * pasar solo a los SuperAdmin.
 */
export async function getOrganizationDetail(
  ctx: AdminContext,
  rawSlug: unknown,
  now: Date = new Date(),
): Promise<Result<OrganizationDetail>> {
  if (!(await isPlatformAdmin(ctx))) return fail("forbidden");
  const slug = parseSlug(rawSlug);
  if (!slug) return fail("org_not_found");

  const org = await ctx.admin.from("organizations").select("id, slug, name, is_active").eq("slug", slug).maybeSingle();
  if (org.error) return fail("unexpected");
  if (!org.data) return fail("org_not_found");

  const [sub, owners, payments, audit] = await Promise.all([
    ctx.admin
      .from("subscriptions")
      .select("plan_code, billing_cycle, trial_ends_at, current_period_end, suspended_at")
      .eq("organization_id", org.data.id)
      .maybeSingle(),
    ctx.admin.from("memberships").select("user_id").eq("organization_id", org.data.id).eq("role", "owner"),
    ctx.session
      .from("payments")
      .select(PAYMENT_COLUMNS)
      .eq("organization_id", org.data.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAYMENTS_LIMIT),
    listAuditLog(ctx, { organizationId: org.data.id }),
  ]);
  if (sub.error || !sub.data || owners.error || payments.error || !audit.ok) return fail("unexpected");

  // El pago que define la vigencia actual es el que se puede anular: tiene que estar en la lista aunque los últimos
  // PAYMENTS_LIMIT (vigentes y anulados) lo hayan dejado afuera (p. ej. tras muchas correcciones).
  const rows = [...payments.data];
  const currentEnd = sub.data.current_period_end;
  if (currentEnd && !rows.some((p) => new Date(p.covers_until).getTime() === new Date(currentEnd).getTime())) {
    const same = await ctx.session
      .from("payments")
      .select(PAYMENT_COLUMNS)
      .eq("organization_id", org.data.id)
      .eq("covers_until", currentEnd)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(20);
    if (same.error) return fail("unexpected");
    rows.push(...same.data.filter((p) => !rows.some((r) => r.id === p.id)));
  }

  // Anulaciones de los pagos que se muestran (RLS: solo SuperAdmin).
  const voids = rows.length
    ? await ctx.session
        .from("payment_voids")
        .select("payment_id, created_at, reason")
        .in(
          "payment_id",
          rows.map((p) => p.id),
        )
    : { data: [], error: null };
  if (voids.error) return fail("unexpected");
  const voidedById = new Map(voids.data.map((v) => [v.payment_id, { at: v.created_at, reason: v.reason }]));

  const emails = await Promise.all(
    owners.data.map(async (m) => (await ctx.admin.auth.admin.getUserById(m.user_id)).data.user?.email ?? "(sin email)"),
  );

  const ends = [sub.data.current_period_end, sub.data.trial_ends_at].filter((d): d is string => typeof d === "string");
  const periodEnd = ends.length ? ends.reduce((a, b) => (new Date(a) > new Date(b) ? a : b)) : null;

  return ok({
    id: org.data.id,
    slug: org.data.slug,
    name: org.data.name,
    isActive: org.data.is_active,
    ownerEmails: emails.sort(),
    plan: sub.data.plan_code,
    billingCycle: sub.data.billing_cycle,
    trialEndsAt: sub.data.trial_ends_at,
    currentPeriodEnd: sub.data.current_period_end,
    periodEnd,
    suspendedAt: sub.data.suspended_at,
    state: accountState(periodEnd, sub.data.suspended_at !== null, now),
    trial: trialStatus(sub.data.trial_ends_at, sub.data.current_period_end, now),
    payments: rows.map((p) => ({
      id: p.id,
      createdAt: p.created_at,
      paidOn: p.paid_on,
      amountCents: p.amount_cents,
      currency: p.currency,
      method: p.method,
      reference: p.reference,
      plan: p.plan_code,
      billingCycle: p.billing_cycle,
      previousPeriodEnd: p.previous_period_end,
      coversUntil: p.covers_until,
      voided: voidedById.get(p.id) ?? null,
    })),
    audit: audit.data,
  });
}

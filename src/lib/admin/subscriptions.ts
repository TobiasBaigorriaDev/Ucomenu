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
  isAddonCode,
  isBillingCycle,
  isCurrency,
  isPaymentMethod,
  isPlanCode,
  isPreviewFeature,
  parseAddonEnd,
  parseAmountToCents,
  parseBranchSelection,
  parseExtraBranches,
  parseExtraPacks,
  parsePaidOn,
  parsePeriodEnd,
  parsePreviewEnd,
  parseReason,
  parseReference,
  parseSlug,
  PREVIEW_FEATURES,
  type PreviewFeature,
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
  account_busy: "account_busy",
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
  invalid_addon: "invalid_addon",
  invalid_packs: "invalid_packs",
  invalid_ends_at: "invalid_ends_at",
  addon_not_allowed: "addon_not_allowed",
  addon_unchanged: "addon_unchanged",
  addon_not_active: "addon_not_active",
  branches_selection_invalid: "branches_selection_invalid",
  extra_branches_must_end: "extra_branches_must_end",
  addon_has_own_action: "addon_has_own_action",
  invalid_feature: "invalid_preview_feature",
  invalid_preview_end: "invalid_preview_end",
  feature_in_plan: "feature_in_plan",
  preview_unchanged: "preview_unchanged",
  preview_not_active: "preview_not_active",
  already_inactive: "already_inactive",
  already_active: "already_active",
  slug_mismatch: "slug_mismatch",
  organization_still_active: "organization_still_active",
  deactivation_not_audited: "deactivation_not_audited",
  deactivation_too_recent: "deactivation_too_recent",
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

export type OrganizationActiveInput = { slug: unknown; active: boolean; reason: unknown };

/**
 * Da de baja (`active: false`) o reactiva una organización (ficha addons-y-baja-de-organizaciones, ADR 0025). No borra nada:
 * la carta, los QR y los llamados quedan «no disponibles» y nadie del local entra hasta reactivarla.
 */
export async function setOrganizationActive(ctx: AdminContext, input: OrganizationActiveInput): Promise<Result> {
  if (!(await isPlatformAdmin(ctx))) return fail("forbidden");
  const reason = parseReason(input.reason);
  if (!reason) return fail("invalid_reason");
  const org = await findOrgId(ctx, input.slug);
  if (!org.ok) return org;

  const { error } = await ctx.admin.rpc("admin_set_organization_active", {
    p_actor: ctx.actorId,
    p_org: org.data,
    p_active: input.active === true,
    p_reason: reason,
  });
  return error ? dbFailure(error) : ok(undefined);
}

export type SetAddonInput = {
  slug: unknown;
  addon: unknown;
  /** Packs extra como los escribe la persona («0», «2»). */
  extraPacks: unknown;
  /** `AAAA-MM-DD` o vacío: el add-on vale hasta el final de ese día (Argentina); vacío = sin fecha de fin. */
  endsOn: unknown;
  reason: unknown;
};

/** Activa un add-on o cambia sus packs extra y su fecha de fin. La base valida de nuevo (es la autoridad). */
export async function setAddon(ctx: AdminContext, input: SetAddonInput, now: Date = new Date()): Promise<Result> {
  if (!(await isPlatformAdmin(ctx))) return fail("forbidden");
  if (!isAddonCode(input.addon)) return fail("invalid_addon");
  const packs = parseExtraPacks(input.extraPacks);
  if (packs === null) return fail("invalid_packs");
  const endsAt = parseAddonEnd(input.endsOn, now);
  if (endsAt === undefined) return fail("invalid_ends_at");
  const reason = parseReason(input.reason);
  if (!reason) return fail("invalid_reason");
  const org = await findOrgId(ctx, input.slug);
  if (!org.ok) return org;

  const { error } = await ctx.admin.rpc("admin_set_addon", {
    p_actor: ctx.actorId,
    p_org: org.data,
    p_addon: input.addon,
    p_extra_packs: packs,
    // La función acepta NULL (sin fecha de fin); el generador de tipos no marca los argumentos como anulables.
    p_ends_at: endsAt as string,
    p_reason: reason,
  });
  return error ? dbFailure(error) : ok(undefined);
}

export type EndAddonInput = { slug: unknown; addon: unknown; reason: unknown };

/** Finaliza un add-on vigente (queda con fin = ahora; los packs se conservan por si se vuelve a activar). */
export async function endAddon(ctx: AdminContext, input: EndAddonInput): Promise<Result> {
  if (!(await isPlatformAdmin(ctx))) return fail("forbidden");
  if (!isAddonCode(input.addon)) return fail("invalid_addon");
  const reason = parseReason(input.reason);
  if (!reason) return fail("invalid_reason");
  const org = await findOrgId(ctx, input.slug);
  if (!org.ok) return org;

  const { error } = await ctx.admin.rpc("admin_end_addon", {
    p_actor: ctx.actorId,
    p_org: org.data,
    p_addon: input.addon,
    p_reason: reason,
  });
  return error ? dbFailure(error) : ok(undefined);
}

export type SetExtraBranchesInput = {
  slug: unknown;
  /** Cantidad como la escribe la persona («0» a «3»); 0 = finalizar. */
  quantity: unknown;
  /** Ids de las sucursales a desactivar cuando la baja deja más activas que el tope nuevo. */
  deactivate: unknown;
  reason: unknown;
};

/**
 * Pone la cantidad de sucursales adicionales de una organización Pro (ficha sucursal-adicional, ADR 0039). Al bajar la
 * cantidad, la base exige desactivar exactamente las sucursales que sobran y que la persona eligió; nunca decide sola.
 */
export async function setExtraBranches(ctx: AdminContext, input: SetExtraBranchesInput): Promise<Result> {
  if (!(await isPlatformAdmin(ctx))) return fail("forbidden");
  const quantity = parseExtraBranches(input.quantity);
  if (quantity === null) return fail("invalid_extra_branches");
  const selection = parseBranchSelection(input.deactivate);
  if (selection === null) return fail("branches_selection_invalid");
  const reason = parseReason(input.reason);
  if (!reason) return fail("invalid_reason");
  const org = await findOrgId(ctx, input.slug);
  if (!org.ok) return org;

  const { error } = await ctx.admin.rpc("admin_set_extra_branches", {
    p_actor: ctx.actorId,
    p_org: org.data,
    p_quantity: quantity,
    p_deactivate: selection,
    p_reason: reason,
  });
  return error ? dbFailure(error) : ok(undefined);
}

export type SetFeaturePreviewInput = {
  slug: unknown;
  feature: unknown;
  /** `AAAA-MM-DD`: la vista previa vale hasta el final de ese día (Argentina), hasta 90 días. */
  endsOn: unknown;
  reason: unknown;
};

/**
 * Habilita una función a una organización por tiempo limitado, o cambia el fin de una vista previa vigente (ficha
 * vistas-previas-de-funciones, ADR 0039). La base vuelve a validar y escribe la auditoría en la misma transacción.
 */
export async function setFeaturePreview(ctx: AdminContext, input: SetFeaturePreviewInput, now: Date = new Date()): Promise<Result> {
  if (!(await isPlatformAdmin(ctx))) return fail("forbidden");
  if (!isPreviewFeature(input.feature)) return fail("invalid_preview_feature");
  const endsAt = parsePreviewEnd(input.endsOn, now);
  if (endsAt === null) return fail("invalid_preview_end");
  const reason = parseReason(input.reason);
  if (!reason) return fail("invalid_reason");
  const org = await findOrgId(ctx, input.slug);
  if (!org.ok) return org;

  const { error } = await ctx.admin.rpc("admin_set_feature_preview", {
    p_actor: ctx.actorId,
    p_org: org.data,
    p_feature: input.feature,
    p_ends_at: endsAt,
    p_reason: reason,
  });
  return error ? dbFailure(error) : ok(undefined);
}

export type EndFeaturePreviewInput = { slug: unknown; feature: unknown; reason: unknown };

/** Finaliza ahora una vista previa vigente. */
export async function endFeaturePreview(ctx: AdminContext, input: EndFeaturePreviewInput): Promise<Result> {
  if (!(await isPlatformAdmin(ctx))) return fail("forbidden");
  if (!isPreviewFeature(input.feature)) return fail("invalid_preview_feature");
  const reason = parseReason(input.reason);
  if (!reason) return fail("invalid_reason");
  const org = await findOrgId(ctx, input.slug);
  if (!org.ok) return org;

  const { error } = await ctx.admin.rpc("admin_end_feature_preview", {
    p_actor: ctx.actorId,
    p_org: org.data,
    p_feature: input.feature,
    p_reason: reason,
  });
  return error ? dbFailure(error) : ok(undefined);
}

// ---------------------------------------------------------------------------
// Lectura: detalle de una organización
// ---------------------------------------------------------------------------

/** Un add-on del catálogo y, si la organización lo contrató alguna vez, su estado. */
export type AddonRow = {
  code: string;
  name: string;
  baseQuota: number;
  packSize: number;
  allowedPlans: string[];
  /** ¿Lo admite el plan actual de la organización? Si no, no se puede activar ni da nada aunque haya una fila. */
  allowedByPlan: boolean;
  /** `null` = nunca contratado. */
  contract: { extraPacks: number; endsAt: string | null; active: boolean; quota: number } | null;
};

/** ¿Está vigente un add-on con este fin? Sin fin o con fin futuro. */
export function isAddonActive(endsAt: string | null, now: Date): boolean {
  return endsAt === null || new Date(endsAt).getTime() > now.getTime();
}

/** Sucursales adicionales de la organización (ficha sucursal-adicional); `null` en el detalle si el catálogo no las ofrece. */
export type ExtraBranchesRow = {
  /** ¿Lo admite el plan actual? Solo Pro. */
  allowedByPlan: boolean;
  /** Sucursales adicionales vigentes. */
  quantity: number;
  max: number;
  priceCents: number;
  currency: string;
  /** Tope de sucursales del plan sin adicionales (`null` = sin tope). */
  planBranches: number | null;
  /** Sucursales activas, para elegir cuáles se desactivan. */
  activeBranches: { id: string; name: string; slug: string }[];
};

/** Una función que el SuperAdmin puede habilitar a la organización y su vista previa, si alguna vez tuvo una. */
export type FeaturePreviewRow = {
  feature: PreviewFeature;
  /** ¿Ya la incluye el plan? Entonces no hace falta (ni se permite) una vista previa. */
  inPlan: boolean;
  /** `null` = nunca tuvo vista previa. */
  preview: { endsAt: string; reason: string; active: boolean } | null;
};

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
  /** Cuándo se dio de baja (baja auditada vigente), o `null` si está activa o no hay baja auditada: el borrado la exige. */
  deactivatedAt: string | null;
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
  addons: AddonRow[];
  extraBranches: ExtraBranchesRow | null;
  featurePreviews: FeaturePreviewRow[];
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

  const [sub, owners, payments, audit, catalog, contracted, lifecycle, activeBranches, plans, previews] = await Promise.all([
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
    ctx.admin
      .from("addons")
      .select("code, name, base_model_quota, pack_size, allowed_plans, grants_limit, quota_per_pack, max_packs, price_cents, currency")
      .order("code"),
    ctx.admin.from("subscription_addons").select("addon_code, extra_packs, ends_at").eq("organization_id", org.data.id),
    // Último evento de ciclo de vida (baja o reactivación): de cuándo corre el plazo del borrado. No depende de AUDIT_LIMIT.
    ctx.session
      .from("audit_log")
      .select("action, created_at")
      .eq("organization_id", org.data.id)
      .in("action", ["organization.deactivated", "organization.reactivated"])
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1),
    ctx.admin.from("branches").select("id, name, slug").eq("organization_id", org.data.id).eq("is_active", true).order("name").order("id"),
    ctx.admin.from("plans").select("code, max_branches, features"),
    ctx.admin.from("organization_feature_previews").select("feature, ends_at, reason").eq("organization_id", org.data.id),
  ]);
  if (
    sub.error ||
    !sub.data ||
    owners.error ||
    payments.error ||
    !audit.ok ||
    catalog.error ||
    contracted.error ||
    lifecycle.error ||
    activeBranches.error ||
    plans.error ||
    previews.error
  ) {
    return fail("unexpected");
  }
  const lastLifecycle = lifecycle.data[0];
  const deactivatedAt = !org.data.is_active && lastLifecycle?.action === "organization.deactivated" ? lastLifecycle.created_at : null;

  const planCode = sub.data.plan_code;
  // Los add-ons que conceden un límite tienen su propia acción y su propio bloque (no pasan por el formulario genérico).
  const addons: AddonRow[] = catalog.data.filter((a) => a.grants_limit === null).map((a) => {
    const row = contracted.data.find((c) => c.addon_code === a.code);
    return {
      code: a.code,
      name: a.name,
      baseQuota: a.base_model_quota,
      packSize: a.pack_size,
      allowedPlans: a.allowed_plans,
      allowedByPlan: a.allowed_plans.includes(planCode),
      contract: row
        ? {
            extraPacks: row.extra_packs,
            endsAt: row.ends_at,
            active: isAddonActive(row.ends_at, now),
            quota: a.base_model_quota + row.extra_packs * a.pack_size,
          }
        : null,
    };
  });

  const extraAddon = catalog.data.find((a) => a.grants_limit === "branches");
  const extraContract = extraAddon ? contracted.data.find((c) => c.addon_code === extraAddon.code) : undefined;
  const extraBranches: ExtraBranchesRow | null =
    extraAddon && extraAddon.quota_per_pack !== null && extraAddon.max_packs !== null && extraAddon.price_cents !== null && extraAddon.currency !== null
      ? {
          allowedByPlan: extraAddon.allowed_plans.includes(planCode),
          quantity: extraContract && isAddonActive(extraContract.ends_at, now) ? Math.min(extraContract.extra_packs, extraAddon.max_packs) * extraAddon.quota_per_pack : 0,
          max: extraAddon.max_packs * extraAddon.quota_per_pack,
          priceCents: extraAddon.price_cents,
          currency: extraAddon.currency,
          planBranches: plans.data.find((p) => p.code === planCode)?.max_branches ?? null,
          activeBranches: activeBranches.data,
        }
      : null;

  const planFeatures = plans.data.find((p) => p.code === planCode)?.features ?? [];
  const featurePreviews: FeaturePreviewRow[] = PREVIEW_FEATURES.map((feature) => {
    const row = previews.data.find((p) => p.feature === feature);
    return {
      feature,
      inPlan: planFeatures.includes(feature),
      preview: row ? { endsAt: row.ends_at, reason: row.reason, active: isAddonActive(row.ends_at, now) } : null,
    };
  });

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
    deactivatedAt,
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
    addons,
    extraBranches,
    featurePreviews,
    audit: audit.data,
  });
}

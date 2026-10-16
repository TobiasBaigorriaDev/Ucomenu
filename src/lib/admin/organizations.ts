import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeEmail, validatePassword, type PasswordProblem } from "@/lib/auth/validation";
import { accountState, trialStatus, type BillingState, type TrialStatus } from "@/lib/entitlements";
import type { Database } from "@/lib/supabase/database.types";
import { isBillingCycle, isPlanCode, parseName, parsePeriodEnd, parseSlug } from "./validation";

/**
 * Alta de organizaciones por el SuperAdmin (nivel C, ficha superadmin-alta-de-organizaciones, ADR 0013).
 *
 * Recibe los clientes ya construidos para poder probarse contra el Supabase local:
 *  - `session`: el cliente de la PERSONA (rol `authenticated`, RLS). Es la prueba de identidad: antes de usar la clave
 *    de servicio se comprueba con él que quien pide está en `platform_admins` (cada uno solo ve su propia fila).
 *  - `admin`: `service_role`. Crea la cuenta de Auth y llama a la función de base, la ÚNICA que escribe (organización,
 *    suscripción, membresía y auditoría en una sola transacción). Nunca se usa sin la comprobación anterior; además la
 *    función vuelve a comprobar que `actorId` es SuperAdmin.
 *
 * `actorId` sale de `getUser()` en el servidor, jamás de un campo del formulario.
 */

type Db = SupabaseClient<Database>;

export type AdminContext = { session: Db; admin: Db; actorId: string };

export type AdminError =
  | PasswordProblem
  | "forbidden" // no es SuperAdmin
  | "invalid_name"
  | "invalid_slug"
  | "invalid_branch_name"
  | "invalid_branch_slug"
  | "invalid_email"
  | "invalid_plan"
  | "invalid_cycle"
  | "invalid_period"
  | "slug_taken"
  | "email_taken" // el email ya tiene cuenta: no se toca
  | "uncertain" // se perdió la respuesta y no se pudo comprobar si el alta quedó hecha
  | "unexpected"
  // Cambio de plan, suspensión y pagos (ficha superadmin-planes-pagos)
  | "org_not_found"
  | "invalid_reason"
  | "invalid_amount"
  | "invalid_currency"
  | "invalid_method"
  | "invalid_reference"
  | "invalid_paid_on"
  | "invalid_covers_until"
  | "plan_unchanged"
  | "already_suspended"
  | "not_suspended"
  | "payment_not_extending"
  | "uncertain_change"; // se perdió la respuesta de un cambio: pudo quedar hecho

export type Result<T = void> = { ok: true; data: T } | { ok: false; error: AdminError };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const fail = (error: AdminError): Result<never> => ({ ok: false, error });

export const ADMIN_ERROR_MESSAGE: Record<AdminError, string> = {
  blank: "Ingresá una contraseña.",
  too_short: "La contraseña tiene que tener al menos 10 caracteres.",
  too_long: "La contraseña es demasiado larga (máximo 72 bytes).",
  forbidden: "No tenés permiso para hacer esto.",
  invalid_name: "Ingresá el nombre de la organización (hasta 80 caracteres).",
  invalid_slug:
    "El identificador solo puede tener minúsculas, números y guiones simples (por ejemplo, cafe-del-centro), hasta 64 caracteres.",
  invalid_branch_name: "Ingresá el nombre de la primera sucursal (hasta 80 caracteres).",
  invalid_branch_slug:
    "El identificador de la sucursal solo puede tener minúsculas, números y guiones simples (por ejemplo, principal), hasta 64 caracteres.",
  invalid_email: "Revisá el email del Dueño: no parece válido.",
  invalid_plan: "Elegí un plan válido.",
  invalid_cycle: "Elegí si la facturación es mensual o anual.",
  invalid_period: "«Vigente hasta» tiene que ser una fecha futura, de hasta 2 años.",
  slug_taken: "Ya existe una organización con ese identificador.",
  email_taken: "Ese email ya tiene una cuenta. Por ahora el Dueño inicial tiene que ser una cuenta nueva: usá otro email.",
  uncertain:
    "No pudimos confirmar si el alta quedó hecha. No la repitas: revisá primero la lista de organizaciones (si ya aparece, está creada).",
  unexpected: "No se pudo completar la operación. No se cambió nada; probá de nuevo en unos minutos.",
  org_not_found: "No encontramos esa organización.",
  invalid_reason: "Escribí el motivo del cambio (hasta 200 caracteres).",
  invalid_amount: "Revisá el importe: un número mayor que cero, con hasta dos decimales (por ejemplo, 20000 o 20.000,50).",
  invalid_currency: "Elegí la moneda del pago.",
  invalid_method: "Elegí cómo se pagó.",
  invalid_reference: "La referencia del pago es demasiado larga (hasta 120 caracteres).",
  invalid_paid_on: "«Fecha del pago» tiene que ser un día real, no futuro y de hasta un año atrás.",
  invalid_covers_until: "«Cubre hasta» tiene que ser una fecha futura, de hasta 2 años.",
  plan_unchanged: "Ese ya es el plan y el ciclo de la organización: no hay nada que cambiar.",
  already_suspended: "La organización ya está suspendida a mano.",
  not_suspended: "La organización no está suspendida a mano, así que no hay nada que reactivar.",
  payment_not_extending:
    "«Cubre hasta» tiene que ser posterior al vencimiento actual y a hoy. Si ya cargaste este pago, no lo repitas: mirá el historial de pagos.",
  uncertain_change:
    "No pudimos confirmar si el cambio quedó hecho. No lo repitas todavía: recargá esta página y mirá el estado y los últimos movimientos.",
};

/** Prueba de identidad: lo comprueba el cliente de la persona (RLS), no la clave de servicio. */
export async function isPlatformAdmin(ctx: Pick<AdminContext, "session" | "actorId">): Promise<boolean> {
  const { data, error } = await ctx.session.from("platform_admins").select("user_id").eq("user_id", ctx.actorId).maybeSingle();
  return !error && data !== null;
}

export type CreateOrganizationInput = {
  name: unknown;
  slug: unknown;
  ownerEmail: unknown;
  ownerPassword: string;
  /** Primera sucursal: va en la dirección pública de la carta (`/m/{slug}/{branchSlug}`). */
  branchName: unknown;
  branchSlug: unknown;
  plan: unknown;
  billingCycle: unknown;
  /** `AAAA-MM-DD`: vale hasta el final de ese día en Argentina. */
  periodEnd: unknown;
};

export type CreatedOrganization = {
  orgId: string;
  slug: string;
  branchSlug: string;
  ownerUserId: string;
  ownerEmail: string;
};

export async function createOrganization(
  ctx: AdminContext,
  input: CreateOrganizationInput,
  now: Date = new Date(),
): Promise<Result<CreatedOrganization>> {
  if (!(await isPlatformAdmin(ctx))) return fail("forbidden");

  // Todo se valida ANTES de crear nada: un dato inválido no debe dejar una cuenta de Auth suelta.
  const name = parseName(input.name);
  if (!name) return fail("invalid_name");
  const slug = parseSlug(input.slug);
  if (!slug) return fail("invalid_slug");
  const branchName = parseName(input.branchName);
  if (!branchName) return fail("invalid_branch_name");
  const branchSlug = parseSlug(input.branchSlug);
  if (!branchSlug) return fail("invalid_branch_slug");
  const email = normalizeEmail(input.ownerEmail);
  if (!email) return fail("invalid_email");
  const weak = validatePassword(input.ownerPassword);
  if (weak) return fail(weak);
  if (!isPlanCode(input.plan)) return fail("invalid_plan");
  if (!isBillingCycle(input.billingCycle)) return fail("invalid_cycle");
  const periodEnd = parsePeriodEnd(input.periodEnd, now);
  if (!periodEnd) return fail("invalid_period");

  // Comprobación temprana para no crear (y borrar) una cuenta por un slug ocupado. La carrera real la resuelve el
  // índice único dentro de la función de base; ahí se compensa.
  const existing = await ctx.admin.from("organizations").select("id").eq("slug", slug).maybeSingle();
  if (existing.error) return fail("unexpected");
  if (existing.data) return fail("slug_taken");

  const created = await ctx.admin.auth.admin.createUser({ email, password: input.ownerPassword, email_confirm: true });
  if (created.error || !created.data.user) {
    const code = created.error?.code;
    if (code === "email_exists" || code === "user_already_exists") return fail("email_taken");
    if (code === "weak_password") return fail("too_short");
    return fail("unexpected");
  }
  const ownerUserId = created.data.user.id;

  const rpc = await ctx.admin.rpc("admin_create_organization", {
    p_actor: ctx.actorId,
    p_slug: slug,
    p_name: name,
    p_owner: ownerUserId,
    p_plan: input.plan,
    p_billing_cycle: input.billingCycle,
    p_period_end: periodEnd,
    p_branch_slug: branchSlug,
    p_branch_name: branchName,
  });

  if (!rpc.error && typeof rpc.data === "string") {
    return ok({ orgId: rpc.data, slug, branchSlug, ownerUserId, ownerEmail: email });
  }

  // Solo un error con SQLSTATE (5 caracteres) vino de Postgres: la transacción se revirtió seguro. Cualquier otro
  // (red cortada, tiempo agotado, respuesta ilegible) deja el resultado INCIERTO: el alta pudo confirmarse y perderse
  // solo la respuesta. Antes de compensar hay que averiguar qué pasó.
  const rolledBack = typeof rpc.error?.code === "string" && /^[0-9A-Z]{5}$/.test(rpc.error.code);
  if (!rolledBack) {
    const created = await findCreatedOrganization(ctx, slug, ownerUserId);
    if (created.state === "created") return ok({ orgId: created.orgId, slug, branchSlug, ownerUserId, ownerEmail: email });
    // No se pudo averiguar: no se toca nada (borrar una cuenta cuyo alta quedó hecha dejaría una organización sin acceso).
    if (created.state === "unknown") return fail("uncertain");
  }

  // Compensación: no dejar una cuenta con contraseña válida y sin organización. (Si el alta se confirmara recién ahora,
  // la guarda del último Dueño impide borrar la cuenta y la organización queda intacta.)
  const cleanup = await ctx.admin.auth.admin.deleteUser(ownerUserId);
  if (cleanup.error) {
    console.error("[admin] cuenta huérfana tras un alta fallida", { ownerUserId, slug });
    // Si el resultado era incierto, el rechazo del borrado puede ser justamente la guarda del último Dueño porque el alta
    // se confirmó entre la comprobación y el borrado: se vuelve a averiguar antes de decir «no se creó nada».
    if (!rolledBack) {
      const again = await findCreatedOrganization(ctx, slug, ownerUserId);
      if (again.state === "created") return ok({ orgId: again.orgId, slug, branchSlug, ownerUserId, ownerEmail: email });
      if (again.state === "unknown") return fail("uncertain");
    }
  }
  if (rpc.error?.code === "42501") return fail("forbidden");
  if (rpc.error?.code === "23505") return fail("slug_taken");
  return fail("unexpected");
}

/** ¿Quedó hecha el alta? La organización existe con ese slug y la cuenta recién creada es su Dueño. */
async function findCreatedOrganization(
  ctx: AdminContext,
  slug: string,
  ownerUserId: string,
): Promise<{ state: "created"; orgId: string } | { state: "absent" } | { state: "unknown" }> {
  const org = await ctx.admin.from("organizations").select("id").eq("slug", slug).maybeSingle();
  if (org.error) return { state: "unknown" };
  if (!org.data) return { state: "absent" };
  const owner = await ctx.admin
    .from("memberships")
    .select("id")
    .eq("organization_id", org.data.id)
    .eq("user_id", ownerUserId)
    .eq("role", "owner")
    .maybeSingle();
  if (owner.error) return { state: "unknown" };
  // El slug existe pero el Dueño no es esta cuenta: es otra organización (se ganó la carrera), no la nuestra.
  return owner.data ? { state: "created", orgId: org.data.id } : { state: "absent" };
}

export type OrganizationRow = {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  plan: string | null;
  billingCycle: string | null;
  /** Fin efectivo: el mayor entre `current_period_end` y `trial_ends_at`. */
  periodEnd: string | null;
  /** Estado de la cuenta: la suspensión manual manda; si no, se deriva del fin efectivo (misma regla que la base). */
  state: BillingState;
  /** Estado según las fechas solamente (sin la suspensión manual): a qué vuelve la cuenta al reactivarla. */
  datesState: BillingState;
  /** Suspendida a mano por el SuperAdmin (distinto de la mora). */
  suspended: boolean;
  /** Estado de la prueba gratuita, aparte de la mora. */
  trial: TrialStatus;
  ownerEmails: string[];
};

export const ORGANIZATIONS_LIMIT = 100;

/** Las organizaciones más recientes, con su plan, su vencimiento y sus Dueños. Solo SuperAdmin. */
export async function listOrganizations(ctx: AdminContext, now: Date = new Date()): Promise<Result<OrganizationRow[]>> {
  if (!(await isPlatformAdmin(ctx))) return fail("forbidden");

  const orgs = await ctx.admin
    .from("organizations")
    .select("id, slug, name, is_active, created_at")
    .order("created_at", { ascending: false })
    .limit(ORGANIZATIONS_LIMIT);
  if (orgs.error) return fail("unexpected");
  if (orgs.data.length === 0) return ok([]);

  const ids = orgs.data.map((o) => o.id);
  const [subs, owners] = await Promise.all([
    ctx.admin
      .from("subscriptions")
      .select("organization_id, plan_code, billing_cycle, trial_ends_at, current_period_end, suspended_at")
      .in("organization_id", ids),
    ctx.admin.from("memberships").select("organization_id, user_id").eq("role", "owner").in("organization_id", ids),
  ]);
  if (subs.error || owners.error) return fail("unexpected");

  const emailById = new Map<string, string>();
  await Promise.all(
    [...new Set(owners.data.map((m) => m.user_id))].map(async (userId) => {
      const user = await ctx.admin.auth.admin.getUserById(userId);
      emailById.set(userId, user.data.user?.email ?? "(sin email)");
    }),
  );

  const subByOrg = new Map(subs.data.map((s) => [s.organization_id, s]));
  return ok(
    orgs.data.map((o): OrganizationRow => {
      const sub = subByOrg.get(o.id);
      const ends = [sub?.current_period_end, sub?.trial_ends_at].filter((d): d is string => typeof d === "string");
      const periodEnd = ends.length ? ends.reduce((a, b) => (new Date(a) > new Date(b) ? a : b)) : null;
      return {
        id: o.id,
        slug: o.slug,
        name: o.name,
        isActive: o.is_active,
        createdAt: o.created_at,
        plan: sub?.plan_code ?? null,
        billingCycle: sub?.billing_cycle ?? null,
        periodEnd,
        state: accountState(periodEnd, sub?.suspended_at != null, now),
        datesState: accountState(periodEnd, false, now),
        suspended: sub?.suspended_at != null,
        trial: trialStatus(sub?.trial_ends_at ?? null, sub?.current_period_end ?? null, now),
        ownerEmails: owners.data
          .filter((m) => m.organization_id === o.id)
          .map((m) => emailById.get(m.user_id) ?? "(sin email)")
          .sort(),
      };
    }),
  );
}

export type AuditEntry = {
  id: string;
  createdAt: string;
  actorEmail: string;
  action: string;
  organizationId: string | null;
  after: Record<string, unknown> | null;
};

export const AUDIT_LIMIT = 30;

/** Últimos movimientos de la auditoría. Se lee con la sesión de la persona: la RLS deja pasar solo a los SuperAdmin. */
export async function listAuditLog(
  ctx: Pick<AdminContext, "session">,
  filter: { organizationId?: string } = {},
): Promise<Result<AuditEntry[]>> {
  let query = ctx.session
    .from("audit_log")
    .select("id, created_at, actor_email, action, organization_id, after")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(AUDIT_LIMIT);
  if (filter.organizationId) query = query.eq("organization_id", filter.organizationId);
  const { data, error } = await query;
  if (error) return fail("unexpected");
  return ok(
    data.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      actorEmail: row.actor_email,
      action: row.action,
      organizationId: row.organization_id,
      after:
        typeof row.after === "object" && row.after !== null && !Array.isArray(row.after)
          ? (row.after as Record<string, unknown>)
          : null,
    })),
  );
}

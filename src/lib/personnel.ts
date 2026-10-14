import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeEmail, validatePassword, type PasswordProblem } from "@/lib/auth/validation";
import { parseEntitlements, type Role } from "@/lib/entitlements";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Gestión del personal por el Dueño (nivel C, ficha acceso-del-personal).
 *
 * El módulo recibe los clientes ya construidos para poder probarlo contra el Supabase local:
 *  - `session`: el cliente de la PERSONA (rol `authenticated`, RLS). Es la prueba de identidad: antes de
 *    usar la clave de servicio se comprueba con él que quien pide es `owner` de la organización.
 *  - `admin`: `service_role`. Se salta RLS y administra Auth. Nunca se usa sin la comprobación anterior.
 *
 * Reglas que este módulo hace cumplir (además del trigger `guard_last_owner` de la base):
 *  - el objetivo debe pertenecer a la MISMA organización que se está operando (no se confía en ids sueltos);
 *  - nunca se toma la cuenta de alguien que pertenece a otra organización (contraseña, borrado de Auth);
 *  - un email ya registrado no se modifica y no se revela quién lo usa;
 *  - cortar un acceso (baja, restablecer) no depende del estado de pago; dar acceso nuevo sí.
 */

type Db = SupabaseClient<Database>;

export type PersonnelContext = { session: Db; admin: Db; actorId: string };

export type PersonnelError =
  | PasswordProblem
  | "forbidden" // no es Dueño de la organización
  | "invalid_email"
  | "invalid_role"
  | "email_unavailable" // alta sobre un email ya registrado (mensaje genérico)
  | "read_only" // cuenta en solo lectura o suspendida: no se da acceso nuevo
  | "last_owner" // la base protegió al último Dueño
  | "shared_account" // la persona pertenece a otra organización
  | "owner_target" // restablecer la contraseña de un Dueño
  | "self" // sobre uno mismo
  | "not_found"
  | "unexpected";

export type Result<T = void> = { ok: true; data: T } | { ok: false; error: PersonnelError };

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const fail = (error: PersonnelError): Result<never> => ({ ok: false, error });

export const PERSONNEL_ERROR_MESSAGE: Record<PersonnelError, string> = {
  blank: "Ingresá una contraseña.",
  too_short: "La contraseña tiene que tener al menos 10 caracteres.",
  too_long: "La contraseña es demasiado larga (máximo 72 bytes).",
  forbidden: "No tenés permiso para gestionar el personal de este local.",
  invalid_email: "Revisá el email: no parece válido.",
  invalid_role: "Elegí un rol válido.",
  email_unavailable: "No se pudo crear la cuenta con ese email.",
  read_only: "La cuenta está en solo lectura o suspendida: no se pueden sumar personas ni dar permisos de Dueño. Sí podés quitar personal y cambiar contraseñas.",
  last_owner: "Tiene que quedar al menos un Dueño en el local.",
  shared_account: "Esta persona también trabaja en otro local: su contraseña y su cuenta no se pueden cambiar desde acá. Podés quitarla de este local.",
  owner_target: "La contraseña de un Dueño la cambia cada uno desde Mi cuenta.",
  self: "No podés hacer esto con tu propia cuenta. Pedile a otro Dueño o usá Mi cuenta.",
  not_found: "No encontramos a esa persona en este local.",
  unexpected: "No se pudo completar la acción. Probá de nuevo en unos minutos.",
};

const isRole = (value: unknown): value is Role => value === "owner" || value === "staff";

const isLastOwnerError = (error: { code?: string; message?: string } | null) =>
  error?.code === "23514" && (error.message ?? "").includes("last_owner_required");

/** Prueba de identidad: lo comprueba el cliente de la persona (RLS), no la clave de servicio. */
async function isOwnerOf(ctx: PersonnelContext, orgId: string): Promise<boolean> {
  const { data, error } = await ctx.session
    .from("memberships")
    .select("id")
    .eq("organization_id", orgId)
    .eq("user_id", ctx.actorId)
    .eq("role", "owner")
    .maybeSingle();
  return !error && data !== null;
}

async function canWrite(ctx: PersonnelContext, orgId: string): Promise<boolean> {
  const { data, error } = await ctx.session.rpc("org_entitlements", { p_org: orgId });
  return !error && parseEntitlements(data)?.canWrite === true;
}

type Target = { id: string; user_id: string; role: Role };

/** Membresía objetivo, acotada a la organización operada. */
async function findTarget(ctx: PersonnelContext, orgId: string, membershipId: string): Promise<Target | null> {
  const { data, error } = await ctx.admin
    .from("memberships")
    .select("id, user_id, role")
    .eq("id", membershipId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error || !data || !isRole(data.role)) return null;
  return { id: data.id, user_id: data.user_id, role: data.role };
}

/** Cantidad de membresías de la persona en OTRAS organizaciones. `null` si no se pudo saber. */
async function membershipsElsewhere(ctx: PersonnelContext, userId: string, orgId: string): Promise<number | null> {
  const { count, error } = await ctx.admin
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .neq("organization_id", orgId);
  return error ? null : (count ?? 0);
}

export type Member = {
  membershipId: string;
  userId: string;
  email: string;
  role: Role;
  isSelf: boolean;
  /** Pertenece también a otra organización: no se le puede cambiar la contraseña desde acá. */
  sharedAccount: boolean;
};

export async function listMembers(ctx: PersonnelContext, orgId: string): Promise<Result<Member[]>> {
  if (!(await isOwnerOf(ctx, orgId))) return fail("forbidden");

  const { data, error } = await ctx.admin
    .from("memberships")
    .select("id, user_id, role, created_at")
    .eq("organization_id", orgId)
    .order("created_at");
  if (error) return fail("unexpected");

  const members = await Promise.all(
    data.map(async (m): Promise<Member | null> => {
      if (!isRole(m.role)) return null;
      const [user, elsewhere] = await Promise.all([
        ctx.admin.auth.admin.getUserById(m.user_id),
        membershipsElsewhere(ctx, m.user_id, orgId),
      ]);
      return {
        membershipId: m.id,
        userId: m.user_id,
        email: user.data.user?.email ?? "(sin email)",
        role: m.role,
        isSelf: m.user_id === ctx.actorId,
        sharedAccount: elsewhere === null || elsewhere > 0,
      };
    }),
  );

  return ok(
    members
      .filter((m): m is Member => m !== null)
      .sort((a, b) => (a.role === b.role ? a.email.localeCompare(b.email) : a.role === "owner" ? -1 : 1)),
  );
}

export async function createMember(
  ctx: PersonnelContext,
  orgId: string,
  input: { email: unknown; password: string; role: unknown },
): Promise<Result<{ userId: string }>> {
  if (!(await isOwnerOf(ctx, orgId))) return fail("forbidden");

  const email = normalizeEmail(input.email);
  if (!email) return fail("invalid_email");
  if (!isRole(input.role)) return fail("invalid_role");
  const weak = validatePassword(input.password);
  if (weak) return fail(weak);
  if (!(await canWrite(ctx, orgId))) return fail("read_only");

  const created = await ctx.admin.auth.admin.createUser({ email, password: input.password, email_confirm: true });
  if (created.error || !created.data.user) {
    const code = created.error?.code;
    if (code === "email_exists" || code === "user_already_exists") return fail("email_unavailable");
    if (code === "weak_password") return fail("too_short");
    return fail("unexpected");
  }

  const userId = created.data.user.id;
  const membership = await ctx.admin
    .from("memberships")
    .insert({ user_id: userId, organization_id: orgId, role: input.role });

  if (membership.error) {
    // Compensación: no dejar una cuenta huérfana con contraseña válida y sin local.
    const cleanup = await ctx.admin.auth.admin.deleteUser(userId);
    if (cleanup.error) console.error("[personnel] cuenta huérfana tras un alta fallida", { userId, orgId });
    return fail("unexpected");
  }

  return ok({ userId });
}

export async function setMemberRole(
  ctx: PersonnelContext,
  orgId: string,
  membershipId: string,
  role: unknown,
): Promise<Result> {
  if (!(await isOwnerOf(ctx, orgId))) return fail("forbidden");
  if (!isRole(role)) return fail("invalid_role");

  const target = await findTarget(ctx, orgId, membershipId);
  if (!target) return fail("not_found");
  if (target.user_id === ctx.actorId) return fail("self");
  if (target.role === role) return ok(undefined);

  // Dar el rol de Dueño es dar acceso nuevo: requiere cuenta al día. Bajar de rol siempre se puede.
  if (role === "owner" && !(await canWrite(ctx, orgId))) return fail("read_only");

  const { error } = await ctx.admin.from("memberships").update({ role }).eq("id", target.id).eq("organization_id", orgId);
  if (isLastOwnerError(error)) return fail("last_owner");
  return error ? fail("unexpected") : ok(undefined);
}

export async function removeMember(ctx: PersonnelContext, orgId: string, membershipId: string): Promise<Result> {
  if (!(await isOwnerOf(ctx, orgId))) return fail("forbidden");

  const target = await findTarget(ctx, orgId, membershipId);
  if (!target) return fail("not_found");
  if (target.user_id === ctx.actorId) return fail("self");

  const removed = await ctx.admin.from("memberships").delete().eq("id", target.id).eq("organization_id", orgId);
  if (isLastOwnerError(removed.error)) return fail("last_owner");
  if (removed.error) return fail("unexpected");

  // Sin otro local, la cuenta ya no sirve: se borra (libera el email y corta los refresh tokens).
  // Con otro local, la cuenta se conserva: solo se le quitó este.
  const remaining = await ctx.admin
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("user_id", target.user_id);
  if (!remaining.error && (remaining.count ?? 0) === 0) {
    const deleted = await ctx.admin.auth.admin.deleteUser(target.user_id);
    if (deleted.error) console.error("[personnel] no se pudo borrar la cuenta de una baja", { userId: target.user_id, orgId });
  }

  return ok(undefined);
}

export async function resetMemberPassword(
  ctx: PersonnelContext,
  orgId: string,
  membershipId: string,
  newPassword: string,
): Promise<Result> {
  if (!(await isOwnerOf(ctx, orgId))) return fail("forbidden");

  const weak = validatePassword(newPassword);
  if (weak) return fail(weak);

  const target = await findTarget(ctx, orgId, membershipId);
  if (!target) return fail("not_found");
  if (target.user_id === ctx.actorId) return fail("self");
  if (target.role === "owner") return fail("owner_target");

  // Tomar la cuenta de alguien que también trabaja en otro local sería saltar la frontera entre locales.
  const elsewhere = await membershipsElsewhere(ctx, target.user_id, orgId);
  if (elsewhere === null) return fail("unexpected");
  if (elsewhere > 0) return fail("shared_account");

  const { error } = await ctx.admin.auth.admin.updateUserById(target.user_id, { password: newPassword });
  if (error) return fail(error.code === "weak_password" ? "too_short" : "unexpected");
  return ok(undefined);
}

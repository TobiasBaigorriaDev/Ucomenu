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
 *  - nunca se toma la cuenta de alguien que pertenece a otra organización ni la de un SuperAdmin (contraseña, borrado
 *    de Auth), aunque su membresía acá sea de Staff;
 *  - lo anterior no se decide con un SELECT seguido de la llamada a Auth (la cuenta es global y otra membresía puede
 *    llegar en el medio): `personnel_begin_reset` / `personnel_remove_member` comprueban Y reservan la cuenta en una
 *    transacción, y quien suma membresías (`admin_add_owner`, trigger) espera/se niega mientras dure la reserva;
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
  | "shared_account" // la persona pertenece a otra organización o es de la plataforma (no se distingue)
  | "busy" // otra operación global sobre esa cuenta está en curso
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
  shared_account: "Esta cuenta se usa también fuera de este local: su contraseña y su cuenta no se pueden cambiar desde acá. Podés quitarla de este local.",
  busy: "Hay otra operación en curso sobre esta cuenta. Probá de nuevo en unos segundos.",
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
  /** Pertenece también a otra organización o a la plataforma: no se le puede cambiar la contraseña ni borrar la cuenta desde acá. */
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

  const platform = await ctx.admin.from("platform_admins").select("user_id").in("user_id", data.map((m) => m.user_id));
  if (platform.error) return fail("unexpected");
  const platformIds = new Set(platform.data.map((a) => a.user_id));

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
        sharedAccount: platformIds.has(m.user_id) || elsewhere === null || elsewhere > 0,
      };
    }),
  );

  return ok(
    members
      .filter((m): m is Member => m !== null)
      .sort((a, b) => (a.role === b.role ? a.email.localeCompare(b.email) : a.role === "owner" ? -1 : 1)),
  );
}

export type AuthorInfo = { email: string; role: Role };

/**
 * Para la pantalla del historial de precios (ficha pantalla-historial-de-precios): el email y el rol actual de las
 * personas `userIds` que SIGUEN siendo miembros de `orgId`. Solo el Dueño (comprobado con su sesión, no con la clave
 * de servicio). Quien ya no es miembro de este local queda fuera del resultado aunque su cuenta de Auth exista (trabaja
 * en otro local): nunca se entrega el email de alguien ajeno a esta organización. La membresía se lee con la sesión
 * del Dueño (RLS); `service_role` solo consulta el email de Auth de ids que ya son miembros.
 */
export async function resolveAuthors(
  ctx: PersonnelContext,
  orgId: string,
  userIds: string[],
): Promise<Result<Map<string, AuthorInfo>>> {
  if (!(await isOwnerOf(ctx, orgId))) return fail("forbidden");

  const ids = [...new Set(userIds)];
  if (ids.length === 0) return ok(new Map());

  const { data, error } = await ctx.session
    .from("memberships")
    .select("user_id, role")
    .eq("organization_id", orgId)
    .in("user_id", ids);
  if (error) return fail("unexpected");

  const resolved = await Promise.all(
    data.map(async (m): Promise<[string, AuthorInfo] | null> => {
      if (!isRole(m.role)) return null;
      const user = await ctx.admin.auth.admin.getUserById(m.user_id);
      if (user.error) throw new Error("auth_lookup_failed"); // no confundir una falla con «ya no está en el local»
      return [m.user_id, { email: user.data.user?.email ?? "(sin email)", role: m.role }];
    }),
  ).catch(() => null);
  if (!resolved) return fail("unexpected");
  return ok(new Map(resolved.filter((entry): entry is [string, AuthorInfo] => entry !== null)));
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

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Libera la reserva de la cuenta. Si falla, vence sola (2 minutos): solo se deja constancia. */
async function endOperation(ctx: PersonnelContext, userId: string, token: string) {
  const { error } = await ctx.admin.rpc("personnel_end_operation", { p_user: userId, p_token: token });
  if (error) console.error("[personnel] no se pudo liberar la reserva de una cuenta (vence sola)", { userId });
}

export async function removeMember(ctx: PersonnelContext, orgId: string, membershipId: string): Promise<Result> {
  if (!(await isOwnerOf(ctx, orgId))) return fail("forbidden");

  // Una sola transacción en la base: quita la membresía y, si la cuenta quedó sin ninguna y no es de un SuperAdmin,
  // la reserva para borrarla. Mientras dure la reserva nadie le suma otra membresía (si la sumaron antes, no se borra).
  const { data, error } = await ctx.admin.rpc("personnel_remove_member", {
    p_actor: ctx.actorId,
    p_org: orgId,
    p_membership: membershipId,
  });
  if (isLastOwnerError(error)) return fail("last_owner");
  if (error) return fail(error.code === "42501" ? "forbidden" : "unexpected");
  if (!isRecord(data)) return fail("unexpected");
  if (data.status === "not_found") return fail("not_found");
  if (data.status === "self") return fail("self");
  if (data.status !== "removed") return fail("unexpected");

  if (data.reason === "busy") console.error("[personnel] baja con la cuenta reservada por otra operación: la cuenta queda sin local", { orgId });
  if (data.delete_account !== true) return ok(undefined);
  if (typeof data.user_id !== "string" || typeof data.token !== "string") return fail("unexpected");

  // Sin otro local, la cuenta ya no sirve: se borra (libera el email y corta los refresh tokens). La reserva evita que
  // una membresía nueva quede borrada en cascada. Con otro local o siendo SuperAdmin la cuenta se conserva.
  try {
    const deleted = await ctx.admin.auth.admin.deleteUser(data.user_id);
    if (deleted.error) console.error("[personnel] no se pudo borrar la cuenta de una baja", { userId: data.user_id, orgId });
  } finally {
    await endOperation(ctx, data.user_id, data.token);
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

  // Comprobación definitiva Y reserva de la cuenta, en una transacción (ver la cabecera). Un SELECT aparte no alcanza:
  // la cuenta es global y otro local puede sumarla entre la comprobación y la llamada a Auth.
  const { data, error } = await ctx.admin.rpc("personnel_begin_reset", {
    p_actor: ctx.actorId,
    p_org: orgId,
    p_membership: membershipId,
  });
  if (error) return fail(error.code === "42501" ? "forbidden" : "unexpected");
  if (!isRecord(data)) return fail("unexpected");

  switch (data.status) {
    case "ok":
      break;
    case "not_found":
      return fail("not_found");
    case "self":
      return fail("self");
    case "owner_target":
      return fail("owner_target");
    case "shared_account":
    case "platform_admin": // no se distingue: no se revela quién es del equipo de la plataforma
      return fail("shared_account");
    case "busy":
      return fail("busy");
    default:
      return fail("unexpected");
  }
  if (typeof data.user_id !== "string" || typeof data.token !== "string") return fail("unexpected");

  try {
    const { error: authError } = await ctx.admin.auth.admin.updateUserById(data.user_id, { password: newPassword });
    if (authError) return fail(authError.code === "weak_password" ? "too_short" : "unexpected");
    return ok(undefined);
  } finally {
    await endOperation(ctx, data.user_id, data.token);
  }
}

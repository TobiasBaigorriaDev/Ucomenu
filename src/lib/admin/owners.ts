import { normalizeEmail } from "@/lib/auth/validation";
import { fail, isPlatformAdmin, ok, type AdminContext, type Result } from "./organizations";
import { dbFailure, findOrgId } from "./subscriptions";

/**
 * Sumar una cuenta EXISTENTE como Dueño de una organización (nivel C, ficha dueno-existente).
 *
 * Mismo patrón que el alta y los cambios de plan (ADR 0013): la identidad se prueba con la sesión de la PERSONA (RLS sobre
 * `platform_admins`) antes de usar la clave de servicio, y la escritura es UNA función de base (`admin_add_owner`) que solo
 * ejecuta `service_role`, vuelve a comprobar al actor y escribe membresía y auditoría en una transacción. No se crea, borra
 * ni modifica ninguna cuenta de Auth.
 *
 * Dos pasos con la misma función: sin `confirmed` solo informa (si existe la cuenta y en qué locales ya trabaja) para que el
 * SuperAdmin confirme que es la misma persona; con `confirmed` suma la membresía.
 */

export type Affiliation = { name: string; slug: string; role: "owner" | "staff" | "cook" };

export type AddOwnerOutcome =
  /** Nada se escribió: la cuenta existe y hay que confirmar. `currentRole` = su rol en ESTA organización, si ya trabaja en ella. */
  | { status: "needs_confirmation"; userId: string; currentRole: "staff" | "cook" | null; others: Affiliation[] }
  /** `added` = membresía nueva; `promoted` = era Personal o de cocina de esta organización y pasó a Dueño. */
  | { status: "added" | "promoted"; others: Affiliation[] };

export type AddOwnerInput = {
  slug: unknown;
  email: unknown;
  confirmed: boolean;
  /** `userId` que devolvió el primer paso: la confirmación vale solo para esa cuenta (si el email ahora es de otra, no se escribe). */
  expectedUserId?: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function parseAffiliations(raw: unknown): Affiliation[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!isRecord(item)) return [];
    const { name, slug, role } = item;
    if (typeof name !== "string" || typeof slug !== "string" || (role !== "owner" && role !== "staff" && role !== "cook")) return [];
    return [{ name, slug, role }];
  });
}

export async function addExistingOwner(ctx: AdminContext, input: AddOwnerInput): Promise<Result<AddOwnerOutcome>> {
  if (!(await isPlatformAdmin(ctx))) return fail("forbidden");
  const email = normalizeEmail(input.email);
  if (!email) return fail("invalid_email");
  const org = await findOrgId(ctx, input.slug);
  if (!org.ok) return org;

  const { data, error } = await ctx.admin.rpc("admin_add_owner", {
    p_actor: ctx.actorId,
    p_org: org.data,
    p_email: email,
    p_confirmed: input.confirmed === true,
    ...(input.expectedUserId ? { p_expected_user: input.expectedUserId } : {}),
  });
  if (error) return dbFailure(error);
  if (!isRecord(data)) return fail("unexpected");

  const others = parseAffiliations(data.others);
  switch (data.status) {
    case "no_account":
      return fail("account_not_found");
    case "already_owner":
      return fail("already_owner");
    case "needs_confirmation":
      return typeof data.user_id === "string"
        ? ok({ status: "needs_confirmation", userId: data.user_id, currentRole: data.current_role === "staff" || data.current_role === "cook" ? data.current_role : null, others })
        : fail("unexpected");
    case "added":
    case "promoted":
      return ok({ status: data.status, others });
    default:
      return fail("unexpected");
  }
}

import { asUuid } from "@/lib/carta/validation";
import { fail, isPlatformAdmin, ok, type AdminContext, type AdminError, type Result } from "./organizations";
import { dbFailure } from "./subscriptions";
import { parseReason } from "./validation";

/**
 * Cuentas de Auth que quedaron sin ningún local (ficha cuentas-sin-local; ADR 0032 y 0028). Al borrar una organización sus
 * membresías se van y las cuentas de su personal se conservan; el SuperAdmin las ve y puede borrar una a mano.
 *
 * Mismo patrón que el resto (ADR 0013): la identidad se prueba con la sesión de la PERSONA antes de usar la clave de servicio, y
 * la base es la autoridad. `admin_begin_orphan_delete` vuelve a comprobar todo bajo el lock por cuenta y la RESERVA (la misma
 * que usan el personal y `admin_add_owner`): mientras dura, nadie suma una membresía; después se borra la cuenta en Auth
 * (HTTP, fuera de la transacción), se libera la reserva y se audita.
 */

/**
 * Qué decirle a la persona cuando no se pudo confirmar si la cuenta se borró. Repetir es seguro (una cuenta intacta se borra y se
 * audita; una ya borrada responde «no existe»); la lista NO prueba nada, porque también excluye cuentas con local o reservadas.
 */
export const ORPHAN_UNCERTAIN_MESSAGE =
  "No pudimos confirmar si la cuenta se borró. Repetirlo es seguro: esperá un par de minutos, recargá la lista y, si la cuenta sigue ahí, volvé a borrarla; si dice que no existe, ya se borró (puede que no haya quedado en los movimientos).";

export type OrphanAccount = { userId: string; email: string; createdAt: string; lastSignInAt: string | null };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function parseOrphan(value: unknown): OrphanAccount | null {
  if (!isRecord(value)) return null;
  const { user_id, email, created_at, last_sign_in_at } = value;
  if (typeof user_id !== "string" || typeof email !== "string" || typeof created_at !== "string") return null;
  return { userId: user_id, email, createdAt: created_at, lastSignInAt: typeof last_sign_in_at === "string" ? last_sign_in_at : null };
}

/** Las cuentas sin local (hasta 100, las más nuevas primero). */
export async function listOrphanAccounts(ctx: AdminContext): Promise<Result<OrphanAccount[]>> {
  if (!(await isPlatformAdmin(ctx))) return fail("forbidden");
  const { data, error } = await ctx.admin.rpc("admin_list_orphan_accounts", { p_actor: ctx.actorId });
  if (error) return error.code === "42501" ? fail("forbidden") : fail("unexpected");
  if (!Array.isArray(data)) return fail("unexpected");
  const accounts = data.map(parseOrphan);
  return accounts.every((a): a is OrphanAccount => a !== null) ? ok(accounts) : fail("unexpected");
}

const STATUS_ERROR: Record<string, AdminError> = {
  not_found: "orphan_not_found",
  email_mismatch: "orphan_email_mismatch",
  invalid_reason: "invalid_reason",
  platform_admin: "orphan_not_orphan",
  has_membership: "orphan_not_orphan",
  too_recent: "orphan_too_recent",
  busy: "orphan_busy",
};

export type DeleteOrphanInput = { userId: unknown; confirmEmail: unknown; reason: unknown };

/** Libera la reserva de la cuenta; si falla, vence sola (2 minutos). */
async function endOperation(ctx: AdminContext, userId: string, token: string) {
  const { error } = await ctx.admin.rpc("personnel_end_operation", { p_user: userId, p_token: token });
  if (error) console.error("[admin] no se pudo liberar la reserva de una cuenta (vence sola)", { userId });
}

/** ¿Sigue la cuenta en Auth? `unknown` si no se pudo averiguar. */
async function accountState(ctx: AdminContext, userId: string): Promise<"exists" | "gone" | "unknown"> {
  try {
    const { data, error } = await ctx.admin.auth.admin.getUserById(userId);
    if (data?.user) return "exists";
    // Auth responde 404 `user_not_found` cuando no existe; cualquier otro error (red, 5xx) no prueba nada.
    return error && error.status === 404 ? "gone" : error ? "unknown" : "gone";
  } catch {
    return "unknown";
  }
}

/** Borra de Auth una cuenta sin local. Irreversible: el email queda libre y se cortan sus sesiones. */
export async function deleteOrphanAccount(ctx: AdminContext, input: DeleteOrphanInput): Promise<Result> {
  if (!(await isPlatformAdmin(ctx))) return fail("forbidden");
  const userId = asUuid(input.userId);
  if (!userId) return fail("orphan_not_found");
  if (typeof input.confirmEmail !== "string" || !input.confirmEmail.trim()) return fail("orphan_email_mismatch");
  const reason = parseReason(input.reason);
  if (!reason) return fail("invalid_reason");

  const begun = await ctx.admin.rpc("admin_begin_orphan_delete", {
    p_actor: ctx.actorId,
    p_user: userId,
    p_email: input.confirmEmail,
    p_reason: reason,
  });
  if (begun.error) {
    // Aún no se tocó Auth: aunque se haya perdido la respuesta, no se borró nada (a lo sumo queda la reserva, que vence sola).
    const failure = dbFailure(begun.error);
    return failure.ok || failure.error !== "uncertain_change" ? failure : fail("unexpected");
  }
  if (!isRecord(begun.data)) return fail("unexpected");
  if (begun.data.status !== "ok") return fail(STATUS_ERROR[String(begun.data.status)] ?? "unexpected");
  const token = begun.data.token;
  if (typeof token !== "string") return fail("unexpected");

  // Tras la llamada a Auth, la verdad es si la cuenta sigue o no: un error (también de red, con la respuesta perdida) no lo dice.
  let state: "exists" | "gone" | "unknown";
  try {
    const result = await ctx.admin.auth.admin.deleteUser(userId);
    if (result.error) console.error("[admin] Auth devolvió un error al borrar una cuenta sin local", { userId });
    state = result.error ? await accountState(ctx, userId) : "gone";
  } catch {
    state = await accountState(ctx, userId);
  }
  await endOperation(ctx, userId, token);
  if (state !== "gone") return fail(state === "unknown" ? "uncertain_change" : "unexpected");

  const recorded = await ctx.admin.rpc("admin_record_account_deleted", { p_actor: ctx.actorId, p_user: userId, p_reason: reason });
  // El borrado ya ocurrió: si la constancia falla, la cuenta no vuelve; queda el aviso en el registro del servidor.
  if (recorded.error) console.error("[admin] cuenta sin local borrada pero sin constancia en la auditoría", { userId });
  return ok(undefined);
}

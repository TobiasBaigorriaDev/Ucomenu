import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { CallKind } from "@/lib/sala/types";
import { isAllowedPushEndpoint } from "./endpoint";
import { buildCallPayload } from "./payload";

type Db = SupabaseClient<Database>;

/** Cuánto vale un aviso: pasado esto el servicio de push lo descarta (el llamado ya habrá cambiado de estado). */
export const PUSH_TTL_SECONDS = 120;
/** Un servicio de push que no responde en este tiempo cuenta como fallo; nunca frena a los demás. */
export const PUSH_TIMEOUT_MS = 8_000;
const BATCH = 20;

export type PushTarget = { id: string; endpoint: string; p256dh: string; auth: string };

/** Lo que necesita el envío real (la librería `web-push`); se inyecta para probar sin red. */
export type PushSend = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  options: { TTL: number; urgency: "high"; timeout: number },
) => Promise<unknown>;

export type DispatchSummary = { sent: number; failed: number; dropped: number };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Lee la respuesta de `push_targets_for_call`. Todo lo inesperado es «no avisar» (falla cerrado). */
export function parseTargets(raw: unknown): {
  slug: string;
  tableLabel: string;
  branchName: string;
  multiBranch: boolean;
  subscriptions: PushTarget[];
} | null {
  if (!isRecord(raw)) return null;
  const { slug, table_label: tableLabel, branch_name: branchName, multi_branch: multiBranch, subscriptions } = raw;
  if (typeof slug !== "string" || !/^[a-z0-9-]+$/.test(slug)) return null;
  if (typeof tableLabel !== "string" || typeof branchName !== "string" || typeof multiBranch !== "boolean") return null;
  if (!Array.isArray(subscriptions)) return null;
  const targets: PushTarget[] = [];
  for (const item of subscriptions) {
    if (!isRecord(item)) continue;
    const { id, endpoint, p256dh, auth } = item;
    if (typeof id !== "string" || typeof p256dh !== "string" || typeof auth !== "string") continue;
    // Segunda línea de defensa contra SSRF: aunque la base ya filtra, no se envía a un destino que no esté en la lista.
    if (!isAllowedPushEndpoint(endpoint)) continue;
    targets.push({ id, endpoint, p256dh, auth });
  }
  return { slug, tableLabel, branchName, multiBranch, subscriptions: targets };
}

const statusOf = (error: unknown): number | null => (isRecord(error) && typeof error.statusCode === "number" ? error.statusCode : null);

/**
 * Avisa a los dispositivos suscritos de un llamado que ACABA de crearse (`create_waiter_call` = created). Lee los
 * destinos con `push_targets_for_call` (la base decide a quién: miembros actuales de esa organización, y solo si hay
 * un pendiente reciente de esa mesa), manda el aviso a cada uno y borra las suscripciones que el servicio de push dio
 * por muertas (404 / 410). NUNCA lanza: un fallo del push no puede afectar al comensal ni al sondeo de la sala, que
 * sigue siendo el respaldo. Registra solo recuentos y códigos HTTP, sin direcciones, tokens ni claves.
 */
export async function dispatchCallPush(db: Db, send: PushSend, token: string, kind: CallKind): Promise<DispatchSummary | null> {
  try {
    const { data, error } = await db.rpc("push_targets_for_call", { p_token: token, p_kind: kind });
    if (error) {
      console.error(`push_targets_for_call falló (${error.code ?? "sin código"}): ${error.message}`);
      return null;
    }
    const targets = parseTargets(data);
    if (!targets || targets.subscriptions.length === 0) return null;

    const payload = JSON.stringify(
      buildCallPayload({
        slug: targets.slug,
        kind,
        tableLabel: targets.tableLabel,
        branchName: targets.branchName,
        multiBranch: targets.multiBranch,
      }),
    );

    let sent = 0;
    const gone: string[] = [];
    const failures = new Map<string, number>();
    for (let from = 0; from < targets.subscriptions.length; from += BATCH) {
      const batch = targets.subscriptions.slice(from, from + BATCH);
      const results = await Promise.allSettled(
        batch.map((target) =>
          send({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, payload, {
            TTL: PUSH_TTL_SECONDS,
            urgency: "high",
            timeout: PUSH_TIMEOUT_MS,
          }),
        ),
      );
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          sent += 1;
          return;
        }
        const status = statusOf(result.reason);
        if (status === 404 || status === 410) gone.push(batch[index].id);
        const label = status === null ? "red" : String(status);
        failures.set(label, (failures.get(label) ?? 0) + 1);
      });
    }

    let dropped = 0;
    if (gone.length > 0) {
      const removed = await db.rpc("drop_push_subscriptions", { p_ids: gone });
      if (removed.error) console.error(`drop_push_subscriptions falló (${removed.error.code ?? "sin código"}): ${removed.error.message}`);
      else dropped = removed.data ?? 0;
    }

    const failed = [...failures.values()].reduce((total, count) => total + count, 0);
    if (failed > 0) {
      const detail = [...failures.entries()].map(([code, count]) => `${code}×${count}`).join(", ");
      console.error(`El aviso push falló en ${failed} de ${targets.subscriptions.length} dispositivos (${detail}).`);
    }
    return { sent, failed, dropped };
  } catch (error) {
    console.error(`El aviso push falló: ${error instanceof Error ? error.message : "error desconocido"}`);
    return null;
  }
}

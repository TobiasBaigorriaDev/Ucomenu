"use server";

import { requireMembership, requireUser } from "@/lib/auth/session";
import { createSessionClient } from "@/lib/supabase/server";
import { isAllowedPushEndpoint } from "./endpoint";
import { parseSubscription } from "./subscription";

/**
 * Acciones del aviso con la pestaña cerrada (ADR 0020). Todas usan el cliente de LA PERSONA (RLS y funciones con
 * `auth.uid()`): nadie registra, consulta ni borra dispositivos ajenos, y `service_role` no interviene. La autoridad es
 * la membresía del local pedido y la base vuelve a comprobarla (miembro, plan y cuenta al día).
 */

export type RegisterPushResult =
  | { status: "ok" }
  | { status: "unavailable" } // no es miembro, o el plan / la cuenta no permiten el llamado
  | { status: "invalid" }
  | { status: "limit" }
  | { status: "error" };

export async function registerPushAction(slug: string, subscription: unknown): Promise<RegisterPushResult> {
  const { membership } = await requireMembership(slug, `/sala/${slug}`);
  const parsed = parseSubscription(subscription);
  if (!parsed) return { status: "invalid" };

  try {
    const { data, error } = await (await createSessionClient()).rpc("register_push_subscription", {
      p_org: membership.org.id,
      p_endpoint: parsed.endpoint,
      p_p256dh: parsed.p256dh,
      p_auth: parsed.auth,
    });
    if (error) {
      console.error(`register_push_subscription falló (${error.code ?? "sin código"}): ${error.message}`);
      return { status: "error" };
    }
    return data === "ok" || data === "unavailable" || data === "invalid" || data === "limit" ? { status: data } : { status: "error" };
  } catch (error) {
    console.error(`register_push_subscription falló: ${error instanceof Error ? error.message : "error desconocido"}`);
    return { status: "error" };
  }
}

/** ¿Este dispositivo sigue registrado para este local? `null` si no se pudo saber (la pantalla no cambia nada). */
export async function pushStatusAction(slug: string, endpoint: string): Promise<boolean | null> {
  const { membership } = await requireMembership(slug, `/sala/${slug}`);
  if (!isAllowedPushEndpoint(endpoint)) return false;
  try {
    const { data, error } = await (await createSessionClient()).rpc("push_subscription_registered", {
      p_org: membership.org.id,
      p_endpoint: endpoint,
    });
    return error ? null : data === true;
  } catch {
    return null;
  }
}

/** Quita este dispositivo de UN local (el botón «Desactivar» de la sala). */
export async function unregisterPushAction(slug: string, endpoint: string): Promise<boolean> {
  const { membership } = await requireMembership(slug, `/sala/${slug}`);
  if (typeof endpoint !== "string" || endpoint.length === 0 || endpoint.length > 1000) return false;
  try {
    const { error } = await (await createSessionClient()).rpc("unregister_push_subscription", {
      p_endpoint: endpoint,
      p_org: membership.org.id,
    });
    return !error;
  } catch {
    return false;
  }
}

/** Quita este dispositivo de TODOS los locales de la persona (al cerrar sesión). */
export async function forgetPushDeviceAction(endpoint: string): Promise<boolean> {
  await requireUser("/sala");
  if (typeof endpoint !== "string" || endpoint.length === 0 || endpoint.length > 1000) return false;
  try {
    const { error } = await (await createSessionClient()).rpc("unregister_push_subscription", { p_endpoint: endpoint });
    return !error;
  } catch {
    return false;
  }
}

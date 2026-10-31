"use server";

import { redirect } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { isUuid, parseDate, parseNewReservation, parseView, RESERVATION_MINUTES } from "@/lib/reservas/reservas";
import { createSessionClient } from "@/lib/supabase/server";

/**
 * Acciones de la pantalla «Reservas» de la Sala (ficha reservas-de-mesa). Solo llaman a las funciones de la base con la sesión de la
 * persona: la base decide si puede (rol, plan, pago al día) y valida todo. Después vuelven a la pantalla con el resultado en la
 * dirección (`?ok=` o `?error=`), así funcionan también sin JavaScript. Nunca se redirige a un destino que venga del formulario:
 * la dirección se arma acá con el slug de la sesión y la fecha ya validada.
 */

type Back = { slug: string; date: string | null; branch: string | null; view: "dia" | "proximas" };

function back(b: Back, result: { ok: string } | { error: string }): never {
  const query = new URLSearchParams();
  if (b.view === "proximas") query.set("ver", "proximas");
  else if (b.date) query.set("dia", b.date);
  if (b.branch) query.set("sucursal", b.branch);
  if ("ok" in result) query.set("ok", result.ok);
  else query.set("error", result.error);
  redirect(`/sala/${b.slug}/reservas?${query.toString()}`);
}

/** De dónde vuelve: el `slug` sale de la sesión (se vuelve a exigir membresía), el día y la sucursal del formulario ya validados. */
async function context(form: FormData, slug: string): Promise<Back> {
  const { membership } = await requireMembership(slug, `/sala/${slug}/reservas`);
  const branch = form.get("back_sucursal");
  return {
    slug: membership.org.slug,
    date: parseDate(form.get("back_dia")),
    branch: typeof branch === "string" && /^[a-z0-9-]{1,64}$/.test(branch) ? branch : null,
    view: parseView(form.get("back_ver")),
  };
}

export async function createReservationAction(slug: string, form: FormData): Promise<void> {
  const b = await context(form, slug);
  const input = parseNewReservation(form);
  if (!input) back(b, { error: "invalid_time" });
  const db = await createSessionClient();
  const { error } = await db.rpc("create_reservation", {
    p_branch: input.branch,
    p_name: input.name,
    p_phone: input.phone,
    p_email: input.email,
    p_party: input.party,
    p_date: input.date,
    p_time: input.time,
    p_duration: RESERVATION_MINUTES,
    p_notes: input.notes,
    p_table: input.table as string,
    p_client_key: input.clientKey,
  });
  // Se vuelve al día de la reserva recién cargada para verla.
  back({ ...b, date: input.date }, error ? { error: error.message } : { ok: "creada" });
}

export async function assignTableAction(slug: string, form: FormData): Promise<void> {
  const b = await context(form, slug);
  const reservation = form.get("reservation");
  const table = form.get("table");
  if (!isUuid(reservation) || !isUuid(table)) back(b, { error: "table_not_found" });
  const db = await createSessionClient();
  const { error } = await db.rpc("assign_reservation_table", { p_reservation: reservation, p_table: table });
  back(b, error ? { error: error.message } : { ok: "confirmada" });
}

/** Acción del botón → estado que se pide a la base y aviso de éxito. */
const STATUS_ACTIONS: Record<string, { status: string; ok: string }> = {
  sentar: { status: "seated", ok: "sentada" },
  cancelar: { status: "cancelled", ok: "cancelada" },
  rechazar: { status: "rejected", ok: "rechazada" },
  no_vino: { status: "no_show", ok: "no_vino" },
  soltar: { status: "requested", ok: "suelta" },
};

export async function setReservationStatusAction(slug: string, form: FormData): Promise<void> {
  const b = await context(form, slug);
  const reservation = form.get("reservation");
  const action = form.get("action");
  const step = typeof action === "string" ? STATUS_ACTIONS[action] : undefined;
  if (!isUuid(reservation) || !step) back(b, { error: "invalid_status" });
  const db = await createSessionClient();
  const { error } = await db.rpc("set_reservation_status", { p_reservation: reservation, p_status: step.status });
  back(b, error ? { error: error.message } : { ok: step.ok });
}

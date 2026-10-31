import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { dangerButtonClass, inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "@/components/panel/styles";
import { getEntitlements, requireMembership } from "@/lib/auth/session";
import { loadDay, loadUpcoming, PAGE_LIMIT, UPCOMING_LIMIT } from "@/lib/reservas/cargar";
import {
  dayTitle,
  errorMessage,
  freeTables,
  groupByDay,
  isActive,
  OK_MESSAGE,
  parseDate,
  parseView,
  RESERVATION_MINUTES,
  shiftDate,
  sortForDay,
  STATUS_LABEL,
  tablesKnown,
  timeLabel,
  todayIn,
  type Reservation,
  type ReservationTable,
} from "@/lib/reservas/reservas";
import { onlyAssigned, readBranchAccess } from "@/lib/sucursales/vista";
import { createSessionClient } from "@/lib/supabase/server";
import { assignTableAction, createReservationAction, setReservationStatusAction } from "./actions";

export const metadata: Metadata = { title: "Reservas" };

const pillClass = "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-sm font-medium";
const PILL: Record<Reservation["status"], string> = {
  pending_email: "bg-white/70 text-ink ring-1 ring-ink/25",
  requested: "bg-blush text-ink",
  confirmed: "bg-brand text-white",
  seated: "bg-brand text-white",
  rejected: "bg-sand text-ink ring-1 ring-ink/25",
  cancelled: "bg-sand text-ink ring-1 ring-ink/25",
  no_show: "bg-sand text-ink ring-1 ring-ink/25",
};

type Back = { slug: string; date: string; branch: string; view: "dia" | "proximas" };

/** Un botón de estado; los que no se pueden deshacer piden una segunda confirmación dentro de la misma tarjeta. */
function StatusAction({ back, reservation, action, label, confirmLabel, tone = "secondary" }: { back: Back; reservation: Reservation; action: string; label: string; confirmLabel?: string; tone?: "primary" | "secondary" | "danger" }) {
  const className = tone === "primary" ? primaryButtonClass : tone === "danger" ? dangerButtonClass : secondaryButtonClass;
  const form = (
    <form action={setReservationStatusAction.bind(null, back.slug)} className={confirmLabel ? "mt-2" : ""}>
      <input type="hidden" name="reservation" value={reservation.id} />
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="back_dia" value={back.date} />
      <input type="hidden" name="back_sucursal" value={back.branch} />
      <input type="hidden" name="back_ver" value={back.view} />
      <button type="submit" className={className} data-testid={`reserva-${action}`}>
        {confirmLabel ?? label}
      </button>
    </form>
  );
  if (!confirmLabel) return form;
  return (
    <details className="group">
      <summary className={`${secondaryButtonClass} cursor-pointer list-none`} data-testid={`reserva-${action}-abrir`}>
        {label}
      </summary>
      {form}
    </details>
  );
}

function AssignTable({ back, reservation, free }: { back: Back; reservation: Reservation; free: ReservationTable[] | null }) {
  // `null`: la lectura del día quedó incompleta, así que no se sabe qué mesas están libres: no se ofrece ninguna (revisión de Codex, ronda 2).
  if (free === null) {
    return (
      <p className="text-base text-muted" data-testid="reserva-mesas-incompletas">
        Este día tiene demasiadas reservas para saber qué mesas están libres desde esta pantalla.
      </p>
    );
  }
  if (free.length === 0) {
    return (
      <p className="text-base text-muted" data-testid="reserva-sin-mesas">
        No hay mesas libres a esa hora.
      </p>
    );
  }
  return (
    <form action={assignTableAction.bind(null, back.slug)} className="flex flex-wrap items-end gap-2" data-testid="reserva-asignar">
      <input type="hidden" name="reservation" value={reservation.id} />
      <input type="hidden" name="back_dia" value={back.date} />
      <input type="hidden" name="back_sucursal" value={back.branch} />
      <input type="hidden" name="back_ver" value={back.view} />
      <div>
        <label htmlFor={`mesa-${reservation.id}`} className={labelClass}>
          {reservation.tableId ? "Cambiar de mesa" : "Mesa"}
        </label>
        <select id={`mesa-${reservation.id}`} name="table" required defaultValue={reservation.tableId ?? ""} className={`${inputClass} mt-1 min-w-40`}>
          {reservation.tableId ? null : (
            <option value="" disabled>
              Elegí una mesa
            </option>
          )}
          {free.map((table) => (
            <option key={table.id} value={table.id}>
              {table.label}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className={reservation.tableId ? secondaryButtonClass : primaryButtonClass}>
        {reservation.tableId ? "Cambiar mesa" : "Confirmar con esta mesa"}
      </button>
    </form>
  );
}

function ReservationCard({ reservation, back, timeZone, free, now, readOnly }: { reservation: Reservation; back: Back; timeZone: string; free: ReservationTable[] | null; now: number; readOnly: boolean }) {
  const started = now >= Date.parse(reservation.startsAt);
  return (
    <li className="panel-cell" data-testid="reserva" data-id={reservation.id} data-status={reservation.status}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-display text-3xl leading-none tabular-nums" data-testid="reserva-hora">
          {timeLabel(reservation.startsAt, timeZone)}
        </span>
        <span className="min-w-0 text-lg font-medium break-words" data-testid="reserva-nombre">
          {reservation.guestName}
        </span>
        <span className={`${pillClass} ${PILL[reservation.status]} ml-auto`} data-testid="reserva-estado">
          {STATUS_LABEL[reservation.status]}
        </span>
      </div>
      <p className="mt-2 text-base">
        <span className="tabular-nums" data-testid="reserva-personas">
          {reservation.partySize} {reservation.partySize === 1 ? "persona" : "personas"}
        </span>
        {" · "}
        <a href={`tel:${reservation.guestPhone.replace(/[^0-9+]/g, "")}`} className="font-medium underline underline-offset-4" data-testid="reserva-telefono">
          {reservation.guestPhone}
        </a>
        {reservation.guestEmail ? <span className="break-all text-muted">{` · ${reservation.guestEmail}`}</span> : null}
      </p>
      <p className="mt-1 text-base" data-testid="reserva-mesa">
        {reservation.tableLabel ? `${reservation.tableLabel}${isActive(reservation.status) || reservation.status === "seated" ? "" : " (liberada)"}` : "Sin mesa asignada"}
      </p>
      {reservation.notes ? (
        <p className="mt-1 text-base break-words text-muted" data-testid="reserva-nota">
          {reservation.notes}
        </p>
      ) : null}

      {!readOnly && (reservation.status === "requested" || reservation.status === "confirmed") ? (
        <div className="mt-4 flex flex-col gap-3">
          <AssignTable back={back} reservation={reservation} free={free} />
          <div className="flex flex-wrap items-start gap-2">
            {reservation.status === "confirmed" ? (
              <>
                <StatusAction back={back} reservation={reservation} action="sentar" label="Ya llegaron" tone="primary" />
                {started ? <StatusAction back={back} reservation={reservation} action="no_vino" label="No vino" confirmLabel="Sí, no vino" tone="danger" /> : null}
                <StatusAction back={back} reservation={reservation} action="soltar" label="Soltar la mesa" />
                <StatusAction back={back} reservation={reservation} action="cancelar" label="Cancelar reserva" confirmLabel="Sí, cancelar" tone="danger" />
              </>
            ) : (
              <>
                <StatusAction back={back} reservation={reservation} action="rechazar" label="Rechazar" confirmLabel="Sí, rechazar" tone="danger" />
                <StatusAction back={back} reservation={reservation} action="cancelar" label="Cancelar reserva" confirmLabel="Sí, cancelar" tone="danger" />
              </>
            )}
          </div>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Reservas de una sucursal por día (ficha reservas-de-mesa, ADR 0051), para Dueño y Staff. Las reservas de la fase 1 las carga el
 * personal; el personal les asigna una mesa. Solo con la función `reservations` en el plan. La base vuelve a comprobar todo (rol, plan,
 * pago al día); esta pantalla lo muestra con mensajes claros y no lo reemplaza.
 */
export default async function ReservasPage({ params, searchParams }: PageProps<"/sala/[org]/reservas">) {
  const { org } = await params;
  const { membership } = await requireMembership(org, `/sala/${org}/reservas`);
  const query = await searchParams;
  const orgId = membership.org.id;
  const slug = membership.org.slug;

  const db = await createSessionClient();
  const [ent, branchesResult, access] = await Promise.all([
    getEntitlements(orgId),
    db.from("branches").select("id, slug, name, timezone").eq("organization_id", orgId).eq("is_active", true).order("name"),
    readBranchAccess(db, orgId),
  ]);
  const hasFeature = ent?.features.includes("reservations") === true;
  // En solo lectura o suspendida `org_entitlements` quita la función (no se puede escribir), pero lo ya cargado se sigue pudiendo leer
  // (la política de lectura es de miembros): se muestra la lista sin formularios ni botones (revisión de Codex).
  const readOnlyView = ent !== null && !hasFeature && (ent.state === "read_only" || ent.state === "suspended");
  const canView = hasFeature || readOnlyView;
  const branches = onlyAssigned(branchesResult.data ?? [], access.assigned);
  const requested = typeof query.sucursal === "string" ? query.sucursal : null;
  // Sin `?sucursal=`: la que la persona mira en la Sala si es exactamente una; si no, la primera.
  const branch = branches.find((item) => item.slug === requested) ?? (access.view.length === 1 ? branches.find((item) => item.id === access.view[0]) : undefined) ?? branches[0] ?? null;
  const timeZone = branch?.timezone ?? "America/Argentina/Buenos_Aires";
  const today = todayIn(timeZone);
  const date = parseDate(query.dia) ?? today;
  const mode = parseView(query.ver);

  const data = !(canView && branch) ? null : mode === "proximas" ? await loadUpcoming(db, orgId, branch.id) : await loadDay(db, orgId, branch.id, date, timeZone);
  const now = new Date().getTime();
  const back: Back = { slug, date, branch: branch?.slug ?? "", view: mode };
  const list = data ? sortForDay(data.day) : [];
  const alive = list.filter((reservation) => isActive(reservation.status));
  const people = alive.reduce((sum, reservation) => sum + reservation.partySize, 0);

  /** Las mesas libres de una reserva, o `null` si la lectura quedó incompleta y no se sabe. */
  const freeFor = (reservation: Reservation) => (data && tablesKnown(reservation, data.truncated, data.firstUnloadedStart) ? freeTables(reservation, data.tables, data.around) : null);
  const groups = mode === "proximas" ? groupByDay(list, timeZone) : [];
  const href = (nextDate: string) => `/sala/${slug}/reservas?${new URLSearchParams({ dia: nextDate, ...(branch ? { sucursal: branch.slug } : {}) })}`;
  const chip = (active: boolean) => `inline-flex min-h-11 items-center rounded-full px-4 text-base font-medium ${active ? "bg-brand text-white" : "border border-ink/50 text-ink hover:bg-ink/5"}`;
  const ok = typeof query.ok === "string" ? OK_MESSAGE[query.ok] : undefined;
  const error = typeof query.error === "string" ? errorMessage(query.error) : undefined;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:px-10 lg:py-12">
      <h1 className="font-display text-4xl leading-tight">Reservas</h1>
      <p className="mt-2 max-w-prose text-base text-muted">
        Las reservas de cada sucursal, por día o todas las próximas. Asignale una mesa para confirmarla: cada reserva ocupa su mesa {RESERVATION_MINUTES} minutos.
      </p>

      {!ent ? (
        <p role="status" className="mt-6 max-w-prose text-base text-muted" data-testid="reservas-sin-estado">
          No pudimos comprobar el estado de la cuenta. Probá de nuevo en unos minutos.
        </p>
      ) : !canView ? (
        <p className="panel-cell mt-6 max-w-prose text-base" data-testid="reservas-no-incluida">
          Las reservas están incluidas desde el plan Pro.{" "}
          {membership.role === "owner" ? (
            <>
              Para sumarlas, contactá a UcoMenu: podés ver tu plan en{" "}
              <Link href={`/panel/${slug}/suscripcion`} className="font-medium underline underline-offset-4">
                Suscripción
              </Link>
              .
            </>
          ) : (
            "Consultale al Dueño."
          )}
        </p>
      ) : !branch ? (
        <p className="panel-cell mt-6 max-w-prose text-base" data-testid="reservas-sin-sucursal">
          No hay una sucursal activa para tomar reservas.
        </p>
      ) : (
        <>
          {branches.length > 1 ? (
            <nav aria-label="Sucursal" className="mt-6 flex flex-wrap gap-2" data-testid="reservas-sucursales">
              {branches.map((item) => (
                <Link key={item.id} href={`/sala/${slug}/reservas?${new URLSearchParams({ ...(mode === "proximas" ? { ver: "proximas" } : { dia: date }), sucursal: item.slug })}`} aria-current={item.id === branch.id ? "page" : undefined} className={chip(item.id === branch.id)}>
                  {item.name}
                </Link>
              ))}
            </nav>
          ) : null}

          {readOnlyView ? (
            <p className="panel-cell mt-6 max-w-prose text-base" data-testid="reservas-solo-lectura">
              {ent?.state === "suspended"
                ? "La cuenta está suspendida: podés ver las reservas ya cargadas, pero no cargar ni cambiar ninguna hasta regularizar el pago."
                : "Tu cuenta está en solo lectura: podés ver las reservas ya cargadas, pero no cargar ni cambiar ninguna hasta regularizar el pago."}
            </p>
          ) : null}
          {data?.truncated ? (
            <p role="status" className="mt-6 max-w-prose rounded-3xl border border-danger p-4 text-base font-medium text-danger" data-testid="reservas-truncada">
              {mode === "proximas"
                ? `Mostramos las próximas ${UPCOMING_LIMIT} reservas: hay más. Las mesas libres solo se ofrecen donde se pueden calcular con lo que se muestra.`
                : `Este día tiene más reservas de las que podemos mostrar (${PAGE_LIMIT}): la lista puede estar incompleta. Probá con otra sucursal o consultá a UcoMenu.`}
            </p>
          ) : null}
          {ok ? (
            <p role="status" className="panel-cell mt-6 max-w-prose text-base font-medium" data-testid="reservas-ok">
              {ok}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-6 max-w-prose rounded-3xl border border-danger p-4 text-base font-medium text-danger" data-testid="reservas-error">
              {error}
            </p>
          ) : null}

          <nav aria-label="Vista" className="mt-6 flex flex-wrap gap-2" data-testid="reservas-vistas">
            <Link href={`/sala/${slug}/reservas?${new URLSearchParams({ dia: date, sucursal: branch.slug })}`} aria-current={mode === "dia" ? "page" : undefined} className={chip(mode === "dia")} data-testid="reservas-vista-dia">
              Por día
            </Link>
            <Link href={`/sala/${slug}/reservas?${new URLSearchParams({ ver: "proximas", sucursal: branch.slug })}`} aria-current={mode === "proximas" ? "page" : undefined} className={chip(mode === "proximas")} data-testid="reservas-vista-proximas">
              Próximas
            </Link>
          </nav>

          {mode === "dia" ? (
          <nav aria-label="Día" className="mt-6 flex flex-wrap items-center gap-2" data-testid="reservas-dias">
            <Link href={href(shiftDate(date, -1))} className={secondaryButtonClass} aria-label="Día anterior">
              ← Anterior
            </Link>
            <Link href={href(today)} className={chip(date === today)} aria-current={date === today ? "date" : undefined}>
              Hoy
            </Link>
            <Link href={href(shiftDate(date, 1))} className={secondaryButtonClass} aria-label="Día siguiente">
              Siguiente →
            </Link>
            <form method="get" className="flex items-center gap-2">
              <input type="hidden" name="sucursal" value={branch.slug} />
              <label htmlFor="ir-a-dia" className="sr-only">
                Ir a otro día
              </label>
              <input id="ir-a-dia" type="date" name="dia" defaultValue={date} className={inputClass} />
              <button type="submit" className={secondaryButtonClass}>
                Ir
              </button>
            </form>
          </nav>
          ) : null}

          <h2 className="mt-6 font-display text-3xl leading-tight" data-testid="reservas-titulo-dia">
            {mode === "proximas" ? "Próximas reservas" : dayTitle(date)}
          </h2>
          <p className="mt-1 text-base text-muted" data-testid="reservas-resumen">
            {alive.length === 0 ? (mode === "proximas" ? "No hay reservas próximas." : "Sin reservas pendientes ni confirmadas.") : `${alive.length} ${alive.length === 1 ? "reserva" : "reservas"} · ${people} ${people === 1 ? "persona" : "personas"}.`}
          </p>

          {hasFeature ? (
          <details className="panel-cell mt-6" open={Boolean(error)} data-testid="reservas-nueva">
            <summary className="cursor-pointer text-lg font-medium">Nueva reserva</summary>
            <form action={createReservationAction.bind(null, slug)} className="mt-4 grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="branch" value={branch.id} />
              <input type="hidden" name="clientKey" value={randomUUID()} />
              <input type="hidden" name="back_dia" value={date} />
              <input type="hidden" name="back_sucursal" value={branch.slug} />
              <input type="hidden" name="back_ver" value={mode} />
              <div>
                <label htmlFor="r-nombre" className={labelClass}>
                  Nombre
                </label>
                <input id="r-nombre" name="name" required maxLength={80} autoComplete="off" className={`${inputClass} mt-1`} />
              </div>
              <div>
                <label htmlFor="r-telefono" className={labelClass}>
                  Teléfono
                </label>
                <input id="r-telefono" name="phone" type="tel" required maxLength={30} autoComplete="off" className={`${inputClass} mt-1`} />
              </div>
              <div>
                <label htmlFor="r-email" className={labelClass}>
                  Email (opcional)
                </label>
                <input id="r-email" name="email" type="email" maxLength={120} autoComplete="off" className={`${inputClass} mt-1`} />
              </div>
              <div>
                <label htmlFor="r-personas" className={labelClass}>
                  Personas
                </label>
                <input id="r-personas" name="party" type="number" required min={1} max={50} defaultValue={2} className={`${inputClass} mt-1`} />
              </div>
              <div>
                <label htmlFor="r-fecha" className={labelClass}>
                  Fecha
                </label>
                <input id="r-fecha" name="date" type="date" required defaultValue={mode === "proximas" || date < today ? today : date} min={today} className={`${inputClass} mt-1`} />
              </div>
              <div>
                <label htmlFor="r-hora" className={labelClass}>
                  Hora
                </label>
                <input id="r-hora" name="time" type="time" required defaultValue="21:00" className={`${inputClass} mt-1`} />
              </div>
              <div>
                <label htmlFor="r-mesa" className={labelClass}>
                  Mesa (opcional)
                </label>
                <select id="r-mesa" name="table" defaultValue="" className={`${inputClass} mt-1`}>
                  <option value="">Asignar después</option>
                  {(data?.tables ?? []).map((table) => (
                    <option key={table.id} value={table.id}>
                      {table.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="r-nota" className={labelClass}>
                  Nota (opcional)
                </label>
                <textarea id="r-nota" name="notes" maxLength={300} rows={2} className={`${inputClass} mt-1`} />
                <p className="mt-1 text-sm text-muted">Por ejemplo, un cumpleaños o una silla para bebé. No cargues datos sensibles ni de salud.</p>
              </div>
              <div className="sm:col-span-2">
                <button type="submit" className={primaryButtonClass} data-testid="reservas-crear">
                  Cargar reserva
                </button>
              </div>
            </form>
          </details>
          ) : null}

          {data === null ? (
            <p role="status" className="mt-6 max-w-prose text-base text-muted" data-testid="reservas-lectura-error">
              No pudimos leer las reservas de este día. Probá de nuevo en unos minutos.
            </p>
          ) : list.length === 0 ? (
            <p className="mt-6 max-w-prose text-base text-muted" data-testid="reservas-vacio">
              {mode === "proximas" ? "No hay reservas próximas." : "No hay reservas para este día."}
            </p>
          ) : (
            mode === "proximas" ? (
              <div className="mt-6 flex flex-col gap-8" data-testid="reservas-lista">
                {groups.map((group) => (
                  <section key={group.date} aria-labelledby={`dia-${group.date}`} data-testid="reservas-grupo" data-dia={group.date}>
                    <h3 id={`dia-${group.date}`} className="font-display text-2xl leading-tight">
                      {dayTitle(group.date)}
                      <span className="ml-2 text-base text-muted">{group.items.length === 1 ? "1 reserva" : `${group.items.length} reservas`}</span>
                    </h3>
                    <ul className="mt-3 grid gap-3">
                      {group.items.map((reservation) => (
                        <ReservationCard key={reservation.id} reservation={reservation} back={back} timeZone={timeZone} free={freeFor(reservation)} now={now} readOnly={!hasFeature} />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            ) : (
              <ul className="mt-6 grid gap-3" data-testid="reservas-lista">
                {list.map((reservation) => (
                  <ReservationCard key={reservation.id} reservation={reservation} back={back} timeZone={timeZone} free={freeFor(reservation)} now={now} readOnly={!hasFeature} />
                ))}
              </ul>
            )
          )}
        </>
      )}
    </main>
  );
}

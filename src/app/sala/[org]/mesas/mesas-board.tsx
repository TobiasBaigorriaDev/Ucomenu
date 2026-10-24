"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatArs } from "@/lib/money";
import { orderStatusText, parseMesasState, type MesaCard, type MesasState } from "@/lib/sala/mesas";
import { durationLabel, elapsedLabel, isUrgent, KIND_LABEL, nextPollDelay, VISIBLE_POLL_MS, waitingMs } from "@/lib/sala/types";

/** Una consulta que no responde en este tiempo se corta: cuenta como falla y no frena el sondeo. */
const REQUEST_TIMEOUT_MS = 10_000;

type Connection = "ok" | "offline" | "expired" | "gone";

/** El mismo vocabulario de la Sala de llamados: cada tipo de aviso lleva su banda (verde y rosa); el pedido y la mesa libre, neutras. */
const BAND_CLASS = { bill: "bg-blush text-ink", waiter: "bg-brand text-white", order: "bg-ink/10 text-ink", free: "bg-ink/5 text-muted" } as const;

function bandOf(card: MesaCard): { className: string; label: string } {
  if (card.calls.some((call) => call.kind === "bill")) return { className: BAND_CLASS.bill, label: KIND_LABEL.bill };
  if (card.calls.length > 0) return { className: BAND_CLASS.waiter, label: KIND_LABEL.waiter };
  if (card.order) return { className: BAND_CLASS.order, label: "Con pedido" };
  return { className: BAND_CLASS.free, label: "Libre" };
}

const estadoDe = (card: MesaCard) => (card.calls.some((c) => c.kind === "bill") ? "cuenta" : card.calls.length > 0 ? "llama" : card.order ? "pedido" : "libre");

export function MesasBoard({ slug, initial, isOwner }: { slug: string; initial: MesasState; isOwner: boolean }) {
  const [state, setState] = useState<MesasState>(initial);
  const [now, setNow] = useState(() => Date.parse(initial.serverNow));
  const [lastOk, setLastOk] = useState(() => Date.parse(initial.serverNow));
  const [connection, setConnection] = useState<Connection>("ok");
  // Diferencia entre el reloj del servidor y el del dispositivo: «hace N» sale de la hora del servidor.
  const offset = useRef(0);

  useEffect(() => {
    offset.current = Date.parse(initial.serverNow) - Date.now();
    const timer = setInterval(() => setNow(Date.now() + offset.current), 1_000);
    return () => clearInterval(timer);
  }, [initial.serverNow]);

  // --- Sondeo: cada respuesta reemplaza la lista entera. Una consulta a la vez; se corta lo que no responde.
  useEffect(() => {
    if (!initial.enabled) return;
    let disposed = false;
    let stopped = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let failures = 0;

    type Outcome = { kind: "expired" } | { kind: "gone" } | { kind: "state"; next: MesasState } | { kind: "error" };

    const fetchState = async (signal: AbortSignal): Promise<Outcome> => {
      try {
        const response = await fetch(`/sala/${encodeURIComponent(slug)}/mesas/estado`, {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal,
        });
        if (response.status === 401) return { kind: "expired" };
        if (response.status === 404) return { kind: "gone" };
        const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
        // Un redirect al login (sesión vencida detectada por el proxy) llega como HTML.
        if (response.redirected && !isJson) return { kind: "expired" };
        const next = response.ok && isJson ? parseMesasState(await response.json()) : null;
        return next ? { kind: "state", next } : { kind: "error" };
      } catch {
        return { kind: "error" };
      }
    };

    const poll = async () => {
      if (inFlight || stopped || disposed) return;
      inFlight = true;
      clearTimeout(timer);
      controller = new AbortController();
      const abortTimer = setTimeout(() => controller?.abort(), REQUEST_TIMEOUT_MS);
      const outcome = await fetchState(controller.signal);
      clearTimeout(abortTimer);
      inFlight = false;
      if (disposed) return;

      if (outcome.kind === "expired" || outcome.kind === "gone") {
        setConnection(outcome.kind === "expired" ? "expired" : "gone");
        stopped = true;
        return;
      }
      if (outcome.kind === "error") {
        failures += 1;
        setConnection("offline");
      } else {
        failures = 0;
        setConnection("ok");
        offset.current = Date.parse(outcome.next.serverNow) - Date.now();
        setNow(Date.parse(outcome.next.serverNow));
        setLastOk(Date.parse(outcome.next.serverNow));
        setState(outcome.next);
        // El plan o la cuenta ya no lo permiten: la pantalla muestra el aviso y no se sigue consultando.
        if (!outcome.next.enabled) {
          stopped = true;
          return;
        }
      }
      timer = setTimeout(poll, nextPollDelay(!document.hidden, failures));
    };

    timer = setTimeout(poll, VISIBLE_POLL_MS);
    // Al volver a la pestaña o recuperar la red, se consulta de inmediato (si no hay otra consulta en curso).
    const wake = () => {
      if (!stopped && !document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [slug, initial.enabled]);

  const sinceOk = Math.max(0, now - lastOk);

  if (!state.enabled) {
    return (
      <section aria-labelledby="mesas-aviso" data-testid="mesas-deshabilitada" className="panel-cell mt-6 max-w-prose">
        <h2 id="mesas-aviso" className="font-display text-2xl">
          Los pedidos no están disponibles
        </h2>
        <p className="mt-2 text-lg leading-relaxed text-muted">
          {isOwner
            ? "Están incluidos desde el plan Pro y con la cuenta al día. Mientras tanto acá no se ven pedidos."
            : "Por ahora no están disponibles. Avisale al dueño."}
        </p>
      </section>
    );
  }

  const mirando =
    state.view.length === 0
      ? "todas las sucursales"
      : state.branches
          .filter((branch) => state.view.includes(branch.id))
          .map((branch) => branch.name)
          .join(", ");

  return (
    <section aria-label="Mesas" className="mt-6">
      {connection === "offline" ? (
        <p role="status" data-testid="sin-conexion" className="mb-4 rounded-2xl bg-readonly-bg px-4 py-3 text-base text-readonly-ink ring-1 ring-inset ring-readonly-edge">
          <strong>Sin conexión con el servidor.</strong> Reintentando… Esta lista es de hace {Math.max(1, Math.round(sinceOk / 1000))} s.
        </p>
      ) : null}
      {connection === "expired" ? (
        <p role="alert" data-testid="sesion-vencida" className="mb-4 rounded-2xl bg-suspended-bg px-4 py-3 text-base text-suspended-ink ring-1 ring-inset ring-suspended-edge">
          <strong>Tu sesión venció.</strong> Esta lista ya no se actualiza.{" "}
          <Link href={`/login?next=${encodeURIComponent(`/sala/${slug}/mesas`)}`} className="font-medium underline underline-offset-2">
            Ingresar de nuevo
          </Link>
        </p>
      ) : null}
      {connection === "gone" ? (
        <p role="alert" className="mb-4 rounded-2xl bg-suspended-bg px-4 py-3 text-base text-suspended-ink ring-1 ring-inset ring-suspended-edge">
          <strong>Este local ya no está disponible para tu cuenta.</strong>
        </p>
      ) : null}

      {state.multiBranch ? (
        <p data-testid="mirando" className="mb-4 text-base text-muted">
          Mirando: {mirando}.{" "}
          <Link href={`/sala/${slug}`} className="font-medium underline underline-offset-2">
            Cambiar en Sala en vivo
          </Link>
        </p>
      ) : null}

      {state.mesas.length === 0 ? (
        <p className="panel-cell font-display text-3xl leading-tight text-muted" data-testid="mesas-vacia">
          No hay mesas para mostrar.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3" data-testid="mesas">
          {state.mesas.map((card) => {
            const band = bandOf(card);
            const urgent = card.calls.some((call) => isUrgent(waitingMs(call, now)));
            return (
              <li
                key={card.tableId}
                data-testid="mesa"
                data-mesa={card.tableLabel}
                data-estado={estadoDe(card)}
                className={`flex flex-col overflow-hidden rounded-3xl bg-white ${urgent ? "border-4 border-suspended-edge" : "border border-ink/15"}`}
              >
                <div className={`px-5 py-2.5 ${band.className}`}>
                  <p className="text-lg font-semibold">{band.label}</p>
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <p className="font-display text-[2.75rem] leading-none break-words">{card.tableLabel}</p>
                  {state.multiBranch ? <p className="mt-2 text-sm text-muted">Sucursal {card.branchName}</p> : null}

                  {card.calls.length > 0 ? (
                    <ul className="mt-3 space-y-1" data-testid="llamados-mesa">
                      {card.calls.map((call, index) => (
                        <li key={`${call.kind}-${index}`} className="text-lg" data-kind={call.kind}>
                          <strong>{KIND_LABEL[call.kind]}</strong> · {elapsedLabel(waitingMs(call, now))}
                          {isUrgent(waitingMs(call, now)) ? <strong className="text-suspended-ink"> · Espera hace rato</strong> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {card.order ? (
                    <div className="mt-3" data-testid="pedido">
                      <p className="text-base" data-testid="pedido-estado">
                        {orderStatusText(card.order)}
                      </p>
                      <p className="mt-1 font-display text-3xl leading-none" data-testid="pedido-total" data-centavos={card.order.totalCents}>
                        {formatArs(card.order.totalCents)}
                      </p>
                      <p className="mt-1 text-sm text-muted">Abierto hace {durationLabel(Math.max(0, now - Date.parse(card.order.openedAt)))}</p>
                    </div>
                  ) : (
                    <p className="mt-3 text-base text-muted" data-testid="sin-pedido">
                      Sin pedido abierto.
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-6 text-sm text-muted" data-testid="actualizado">
        Se actualiza sola cada pocos segundos.
      </p>
    </section>
  );
}

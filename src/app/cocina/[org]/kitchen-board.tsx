"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  countUnits,
  isPending,
  isStaleKitchen,
  KITCHEN_TEXT,
  optionsText,
  parseKitchenState,
  sortKitchenOrders,
  type KitchenItem,
  type KitchenOrder,
  type KitchenState,
} from "@/lib/cocina/cocina";
import { activateSound, beepIfOn, rememberedAlerts, silenceSound, useSoundState } from "@/components/panel/sonido-llamados";
import { durationLabel, nextPollDelay, VISIBLE_POLL_MS } from "@/lib/sala/types";
import { markReadyAction } from "./actions";

/** Cuánto dura el resaltado de un plato nuevo. */
const FRESH_MS = 8_000;
/** Una consulta que no responde en este tiempo se corta: cuenta como falla y no frena el sondeo. */
const REQUEST_TIMEOUT_MS = 10_000;
/** Un pedido con algo pendiente desde hace tanto se marca como «espera hace rato». */
const LONG_WAIT_MS = 15 * 60 * 1000;

type Connection = "ok" | "offline" | "expired" | "gone";

const buttonClass =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-ink/50 px-4 py-2 text-base font-medium text-ink hover:bg-ink/5 disabled:opacity-60";
const primaryClass =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-cobalt px-5 py-2 text-base font-medium text-white hover:bg-brand-deep disabled:opacity-60";

const pendingIds = (orders: readonly KitchenOrder[]): string[] => orders.flatMap((order) => order.items.filter(isPending).map((item) => item.id));

export function KitchenBoard({ slug, initial }: { slug: string; initial: KitchenState }) {
  const [state, setState] = useState<KitchenState>(initial);
  const [now, setNow] = useState(() => Date.parse(initial.serverNow));
  const [lastOk, setLastOk] = useState(() => Date.parse(initial.serverNow));
  const [connection, setConnection] = useState<Connection>("ok");
  const [branch, setBranch] = useState<string>("all");
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [hadAlerts, setHadAlerts] = useState(false);
  const sound = useSoundState();

  // Diferencia entre el reloj del servidor y el del dispositivo: «hace N» sale de la hora del servidor.
  const offset = useRef(0);
  // Platos pendientes que la pantalla ya había visto: solo lo que aparece después suena y se anuncia.
  const seen = useRef<Set<string>>(new Set(pendingIds(initial.orders)));
  // Sube con cada toque: una respuesta que salió ANTES de guardar podía traer de vuelta el estado viejo y se descarta.
  const epoch = useRef(0);
  const pollNow = useRef<(() => void) | null>(null);

  useEffect(() => {
    offset.current = Date.parse(initial.serverNow) - Date.now();
    const timer = setInterval(() => setNow(Date.now() + offset.current), 1_000);
    return () => clearInterval(timer);
  }, [initial.serverNow]);

  useEffect(() => {
    const timer = setTimeout(() => setHadAlerts(rememberedAlerts()), 0);
    return () => clearTimeout(timer);
  }, []);

  const pendingTotal = state.orders.reduce((sum, order) => sum + countUnits(order.items).pending, 0);
  useEffect(() => {
    document.title = pendingTotal > 0 ? `(${pendingTotal}) Cocina` : "Cocina";
  }, [pendingTotal]);

  const applyState = useCallback((next: KitchenState) => {
    const ids = pendingIds(next.orders);
    const incoming = ids.filter((id) => !seen.current.has(id));
    for (const id of ids) seen.current.add(id);

    offset.current = Date.parse(next.serverNow) - Date.now();
    setNow(Date.parse(next.serverNow));
    setLastOk(Date.parse(next.serverNow));
    setState({ ...next, orders: sortKitchenOrders(next.orders) });

    if (incoming.length === 0) return;
    setFresh((current) => new Set([...current, ...incoming]));
    setTimeout(() => setFresh((current) => new Set([...current].filter((id) => !incoming.includes(id)))), FRESH_MS);
    setAnnouncement(incoming.length === 1 ? "Plato nuevo en cocina." : `${incoming.length} platos nuevos en cocina.`);
    beepIfOn();
  }, []);

  // --- Sondeo: la base es la fuente de verdad; cada respuesta reemplaza la lista entera.
  useEffect(() => {
    if (!initial.enabled) return;

    let disposed = false;
    let stopped = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let failures = 0;
    let pollAgain = false;

    type Outcome = { kind: "expired" } | { kind: "gone" } | { kind: "state"; next: KitchenState } | { kind: "error" };

    const fetchState = async (signal: AbortSignal): Promise<Outcome> => {
      try {
        const response = await fetch(`/cocina/${encodeURIComponent(slug)}/estado`, {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal,
        });
        if (response.status === 401) return { kind: "expired" };
        if (response.status === 404) return { kind: "gone" };
        const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
        if (response.redirected && !isJson) return { kind: "expired" };
        const next = response.ok && isJson ? parseKitchenState(await response.json()) : null;
        return next ? { kind: "state", next } : { kind: "error" };
      } catch {
        return { kind: "error" };
      }
    };

    const poll = async () => {
      if (inFlight || stopped || disposed) return;
      inFlight = true;
      clearTimeout(timer);
      const epochAtStart = epoch.current;
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
      } else if (epoch.current === epochAtStart) {
        failures = 0;
        setConnection("ok");
        applyState(outcome.next);
        if (!outcome.next.enabled) {
          stopped = true;
          return;
        }
      } else {
        pollAgain = true; // salió antes de un toque: se vuelve a pedir ya
      }
      const again = pollAgain;
      pollAgain = false;
      timer = setTimeout(poll, again ? 0 : nextPollDelay(!document.hidden, failures));
    };

    pollNow.current = () => {
      if (inFlight) pollAgain = true;
      else void poll();
    };
    timer = setTimeout(poll, VISIBLE_POLL_MS);

    const wake = () => {
      if (!stopped && !document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);

    return () => {
      disposed = true;
      pollNow.current = null;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [slug, initial.enabled, applyState]);

  async function mark(item: KitchenItem, target: "ready" | "noted") {
    setBusy(item.id);
    setNotes((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== item.id)));
    try {
      const result = await markReadyAction(slug, { itemId: item.id, target });
      epoch.current += 1;
      if (result.status === "failed") {
        setNotes((current) => ({ ...current, [item.id]: KITCHEN_TEXT[result.reason] }));
        if (isStaleKitchen(result.reason)) pollNow.current?.();
        return;
      }
      setState((current) => ({
        ...current,
        orders: sortKitchenOrders(
          current.orders.map((order) => ({ ...order, items: order.items.map((line) => (line.id === item.id ? { ...line, status: target } : line)) })),
        ),
      }));
      pollNow.current?.();
    } catch {
      setNotes((current) => ({ ...current, [item.id]: "No se pudo comunicar con el servidor. Probá de nuevo." }));
    } finally {
      setBusy(null);
    }
  }

  const sinceOk = Math.max(0, now - lastOk);

  if (!state.enabled) {
    return (
      <section aria-labelledby="cocina-aviso" data-testid="cocina-deshabilitada" className="panel-cell mt-6 max-w-prose">
        <h2 id="cocina-aviso" className="font-display text-2xl">
          La cocina no está disponible
        </h2>
        <p className="mt-2 text-lg leading-relaxed text-muted">
          Los pedidos están incluidos desde el plan Pro y con la cuenta al día. Por ahora no se pueden ver ni marcar. Avisale al dueño.
        </p>
      </section>
    );
  }

  const multiBranch = state.branches.length > 1;
  const visible = branch === "all" ? state.orders : state.orders.filter((order) => order.branchId === branch);

  return (
    <div className="mt-6">
      <p className="sr-only" role="status" aria-live="polite" data-testid="anuncio-cocina">
        {announcement}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        {sound === "on" ? (
          <button type="button" onClick={silenceSound} className={buttonClass} data-testid="silenciar-cocina">
            Silenciar sonido
          </button>
        ) : (
          <button type="button" onClick={() => void activateSound()} className={primaryClass} data-testid="activar-sonido-cocina">
            Activar sonido de platos nuevos
          </button>
        )}
        <p className="max-w-prose text-sm text-muted">
          {sound === "on"
            ? "Suena un pitido cuando entra un plato nuevo, mientras tengas esta pantalla abierta."
            : sound === "blocked"
              ? "Tu navegador no dejó activar el sonido: vas a ver los platos nuevos resaltados."
              : hadAlerts
                ? "Vas a volver a tenerlo con tu próximo toque en esta pantalla, o tocá para activarlo ahora."
                : "Un pitido avisa cuando entra un plato nuevo."}
        </p>
      </div>

      {connection === "offline" ? (
        <p role="status" className="mt-4 text-base font-medium text-danger" data-testid="sin-conexion">
          Sin conexión: los pedidos pueden estar desactualizados (última actualización hace {durationLabel(sinceOk)}). Reintentando…
        </p>
      ) : null}
      {connection === "expired" ? (
        <p role="alert" className="mt-4 text-base font-medium text-danger">
          Tu sesión venció. <a href={`/login?next=${encodeURIComponent(`/cocina/${slug}`)}`} className="underline">Ingresá de nuevo</a>.
        </p>
      ) : null}
      {connection === "gone" ? (
        <p role="alert" className="mt-4 text-base font-medium text-danger">
          Ya no tenés acceso a la cocina de este local.
        </p>
      ) : null}

      {multiBranch ? (
        <div role="group" aria-label="Sucursal" className="mt-4 flex flex-wrap gap-2">
          {[{ id: "all", name: "Todas" }, ...state.branches].map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={branch === option.id}
              onClick={() => setBranch(option.id)}
              className={`${branch === option.id ? "bg-brand text-white" : "bg-blush text-ink hover:bg-sand"} inline-flex min-h-11 items-center rounded-full px-4 text-base font-medium`}
            >
              {option.name}
            </button>
          ))}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <p className="mt-8 text-lg text-muted" data-testid="sin-pedidos">
          No hay pedidos pendientes.
        </p>
      ) : (
        <ul className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="pedidos-cocina">
          {visible.map((order) => {
            const waited = Math.max(0, now - Date.parse(order.openedAt));
            const units = countUnits(order.items);
            const allReady = units.pending === 0;
            const long = !allReady && waited >= LONG_WAIT_MS;
            return (
              <li
                key={order.orderId}
                data-testid="pedido-cocina"
                data-mesa={order.tableLabel}
                data-listo={allReady ? "true" : "false"}
                className={`panel-cell ${allReady ? "opacity-80" : ""}`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h2 className="font-display text-3xl leading-none">{order.tableLabel}</h2>
                  <p className="text-base">
                    {multiBranch ? <span className="text-muted">{order.branchName} · </span> : null}
                    <span data-testid="espera-pedido">hace {durationLabel(waited)}</span>
                    {long ? <strong className="text-suspended-ink"> · Espera hace rato</strong> : null}
                  </p>
                </div>
                {allReady ? (
                  <p className="mt-2 text-base font-medium" data-testid="todo-listo">
                    Todo listo: esperando que lo lleven.
                  </p>
                ) : null}
                <ul className="mt-3 divide-y divide-ink/15">
                  {order.items.map((item) => {
                    const ready = item.status === "ready";
                    const isNew = fresh.has(item.id);
                    return (
                      <li key={item.id} className="py-3" data-testid="linea-cocina" data-estado={ready ? "ready" : "pending"} data-nuevo={isNew ? "true" : "false"}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xl leading-snug break-words">
                              <strong>{item.quantity} ×</strong> {item.name}
                              {isNew ? <strong> · Nuevo</strong> : null}
                            </p>
                            {item.options.length > 0 ? <p className="mt-0.5 text-base text-muted break-words">{optionsText(item.options)}</p> : null}
                            {item.note ? (
                              <p className="mt-0.5 text-base font-medium break-words" data-testid="observacion">
                                Observación: {item.note}
                              </p>
                            ) : null}
                          </div>
                          {ready ? (
                            <div className="flex shrink-0 flex-col items-end gap-1">
                              <p className="text-base font-semibold" data-testid="plato-listo">
                                Listo
                              </p>
                              <button
                                type="button"
                                onClick={() => mark(item, "noted")}
                                disabled={busy === item.id}
                                aria-label={`Deshacer listo: ${item.quantity} × ${item.name}, ${order.tableLabel}`}
                                className="inline-flex min-h-11 items-center px-2 text-base underline underline-offset-4 disabled:opacity-60"
                              >
                                Deshacer
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => mark(item, "ready")}
                              disabled={busy === item.id}
                              aria-label={`Marcar listo: ${item.quantity} × ${item.name}, ${order.tableLabel}`}
                              className={`${primaryClass} shrink-0`}
                            >
                              {busy === item.id ? "Guardando…" : "Listo"}
                            </button>
                          )}
                        </div>
                        {notes[item.id] ? (
                          <p role="alert" className="mt-2 text-base font-medium text-danger">
                            {notes[item.id]}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatArs } from "@/lib/money";
import { flattenCalls, hasCompletedKitchenOrder, orderStatusText, parseMesasState, readyLineIds, sortMesas, tablesWithNewReady, type MesaCall, type MesaCard, type MesasState } from "@/lib/sala/mesas";
import {
  announceableCalls,
  callName,
  durationLabel,
  elapsedLabel,
  isStaleVisit,
  isUrgent,
  KIND_LABEL,
  newCallsAnnouncement,
  nextPollDelay,
  pageTitle,
  VISIBLE_POLL_MS,
  visitAgeMs,
  waitingMs,
} from "@/lib/sala/types";
import { AvisoPush } from "@/components/push/aviso-push";
import { activateSound, beepIfOn, rememberedAlerts, silenceSound, useSoundState } from "@/components/panel/sonido-llamados";
import { attendCallAction, setBranchViewAction } from "../actions";
import { SelectorDeSucursal } from "../selector-sucursal";
import { ResetSheet } from "./[mesa]/anotar/reset-sheet";
import { dangerPrimaryClass } from "./[mesa]/anotar/ui";

/** Cuánto dura el resaltado de un llamado nuevo. */
const FRESH_MS = 8_000;
/** Una consulta que no responde en este tiempo se corta: cuenta como falla y no frena el sondeo. */
const REQUEST_TIMEOUT_MS = 10_000;

type Connection = "ok" | "offline" | "expired" | "gone";
/** Cómo se ven las mesas: tarjetas (más aire) o filas (una debajo de otra, más cómodo en el teléfono). Mismos datos. */
type Layout = "tarjetas" | "filas";

const LAYOUT_KEY = "ucomenu.mesas.vista";

const readLayout = (): Layout => {
  try {
    return window.localStorage.getItem(LAYOUT_KEY) === "filas" ? "filas" : "tarjetas";
  } catch {
    return "tarjetas"; // sin almacenamiento (ventana privada o bloqueado): la preferencia no se recuerda, la pantalla sigue andando
  }
};

const buttonClass =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-ink/50 px-4 py-2 text-base font-medium text-ink hover:bg-ink/5 disabled:opacity-60";
const primaryClass =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-cobalt px-5 py-2 text-base font-medium text-white hover:bg-brand-deep disabled:opacity-60";

/** El mismo vocabulario de siempre: cada tipo de aviso lleva su banda (verde y rosa); el pedido y la mesa libre, neutras. */
const BAND_CLASS = {
  bill: "bg-blush text-ink",
  waiter: "bg-brand text-white",
  ready: "bg-cobalt text-white",
  order: "bg-ink/10 text-ink",
  free: "bg-ink/5 text-muted",
} as const;

function bandOf(card: MesaCard): { className: string; label: string } {
  if (card.calls.some((call) => call.kind === "bill")) return { className: BAND_CLASS.bill, label: KIND_LABEL.bill };
  if (card.calls.length > 0) return { className: BAND_CLASS.waiter, label: KIND_LABEL.waiter };
  if (card.order && card.order.ready > 0) return { className: BAND_CLASS.ready, label: "Listo para entregar" };
  if (card.order) return { className: BAND_CLASS.order, label: "Con pedido" };
  return { className: BAND_CLASS.free, label: "Libre" };
}

const estadoDe = (card: MesaCard) =>
  card.calls.some((c) => c.kind === "bill") ? "cuenta" : card.calls.length > 0 ? "llama" : card.order && card.order.ready > 0 ? "listo" : card.order ? "pedido" : "libre";

export function MesasBoard({
  slug,
  initial,
  isOwner,
  pushPublicKey,
}: {
  slug: string;
  initial: MesasState;
  isOwner: boolean;
  /** Clave pública VAPID; `null` si el aviso con la pestaña cerrada no está configurado en este entorno (no se muestra el bloque). */
  pushPublicKey: string | null;
}) {
  const [state, setState] = useState<MesasState>(initial);
  const [now, setNow] = useState(() => Date.parse(initial.serverNow));
  const [lastOk, setLastOk] = useState(() => Date.parse(initial.serverNow));
  const [connection, setConnection] = useState<Connection>("ok");
  // El sonido vive fuera de la pantalla (módulo compartido con el panel): salir de la sala no lo apaga.
  const alerts = useSoundState();
  const [hadAlerts, setHadAlerts] = useState(false);
  const [layout, setLayout] = useState<Layout>("tarjetas");
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  // Mesas donde la cocina acaba de marcar algo listo (se resaltan unos segundos).
  const [freshReady, setFreshReady] = useState<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [globalNote, setGlobalNote] = useState("");
  const [savingView, setSavingView] = useState(false);
  // Lo que la persona acaba de elegir y la base todavía no devolvió en un sondeo posterior al guardado: se muestra y se usa como base
  // del próximo toque (si no, un segundo toque rápido calcularía sobre la vista vieja y pisaría la primera elección).
  const [pendingView, setPendingView] = useState<string[] | null>(null);
  const savingViewRef = useRef(false);
  // Hora del servidor de la última actualización recibida: con un cambio de vista, solo lo creado después es nuevo (ver announceableCalls).
  const lastSnapshot = useRef(Date.parse(initial.serverNow));
  const [viewNote, setViewNote] = useState("");
  // Mesa cuyo QR se está por reiniciar (hoja de confirmación, la misma de la pantalla de anotar).
  const [resetFor, setResetFor] = useState<{ tableId: string; label: string } | null>(null);

  // Diferencia entre el reloj del servidor y el del dispositivo: «hace N» sale de la hora del servidor.
  const offset = useRef(0);
  const seen = useRef<Set<string>>(new Set(flattenCalls(initial.mesas).map((call) => call.id)));
  // Líneas listas en la última respuesta: una que aparece lista sin estar acá es un plato nuevo (solo lo que pasa después de cargar suena y se anuncia).
  const seenReady = useRef<Set<string>>(new Set(readyLineIds(initial.mesas)));
  // Qué sucursales miraba la última respuesta: si cambia (la persona eligió otras), lo que ya estaba pendiente no suena ni se anuncia.
  const lastView = useRef(initial.view.join(","));
  // Pide un sondeo ya (tras cambiar la vista); lo arma el efecto del sondeo.
  const pollNow = useRef<(() => void) | null>(null);
  const alertsRef = useRef(alerts);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  // Sube cada vez que termina una atención: invalida las consultas que ya estaban en vuelo.
  const attendEpoch = useRef(0);

  const pendingCount = state.mesas.reduce((sum, card) => sum + card.calls.length, 0);

  const requestWakeLock = useCallback(async () => {
    try {
      wakeLock.current = (await navigator.wakeLock?.request("screen")) ?? null;
    } catch {
      wakeLock.current = null; // el navegador no lo soporta o lo rechazó: la alerta sigue funcionando
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    try {
      await wakeLock.current?.release();
    } catch {
      // nada
    }
    wakeLock.current = null;
  }, []);

  // --- Reloj: un tick por segundo para el «hace N».
  useEffect(() => {
    offset.current = Date.parse(initial.serverNow) - Date.now();
    const timer = setInterval(() => setNow(Date.now() + offset.current), 1_000);
    return () => clearInterval(timer);
  }, [initial.serverNow]);

  // --- Preferencia de alertas: se recuerda en el dispositivo, pero el audio exige un toque en cada carga.
  useEffect(() => {
    const timer = setTimeout(() => {
      setHadAlerts(rememberedAlerts());
      setLayout(readLayout()); // la vista elegida se recuerda en el dispositivo
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  function chooseLayout(next: Layout) {
    setLayout(next);
    try {
      window.localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // nada: queda elegida hasta cerrar la pantalla
    }
  }

  // --- Título de la pestaña.
  useEffect(() => {
    document.title = pageTitle(pendingCount);
  }, [pendingCount]);

  // --- Un llamado nuevo: resalta, anuncia y, con las alertas activas, suena. Nunca al cargar los que ya había.
  const applyState = useCallback((next: MesasState) => {
    // Una respuesta que salió después de guardar (las anteriores se descartan) trae la vista real; mientras se guarda, todavía no.
    if (!savingViewRef.current) setPendingView(null);
    const viewChanged = next.view.join(",") !== lastView.current;
    lastView.current = next.view.join(",");
    const calls = flattenCalls(next.mesas);
    // Con otra vista, lo que la pantalla ya había recibido (y la vista anterior ocultaba) es base, sin sonido ni anuncio.
    const incoming = announceableCalls(seen.current, calls, viewChanged, lastSnapshot.current);
    lastSnapshot.current = Date.parse(next.serverNow);
    for (const call of calls) seen.current.add(call.id);

    offset.current = Date.parse(next.serverNow) - Date.now();
    setNow(Date.parse(next.serverNow));
    setLastOk(Date.parse(next.serverNow));
    setState(next);

    // Con otra vista, lo que aparece ahora ya estaba listo (la vista anterior lo ocultaba): es base, sin sonido ni anuncio.
    const justReady = viewChanged ? [] : tablesWithNewReady(seenReady.current, next.mesas);
    // Se REEMPLAZA por lo que está listo ahora: si la cocina deshace un «listo» y lo vuelve a marcar, vuelve a ser un plato nuevo.
    seenReady.current = new Set(readyLineIds(next.mesas));

    if (incoming.length === 0 && justReady.length === 0) return;
    const ids = incoming.map((call) => call.id);
    const readyIds = justReady.map((card) => card.tableId);
    setFresh((current) => new Set([...current, ...ids]));
    setFreshReady((current) => new Set([...current, ...readyIds]));
    setTimeout(() => {
      setFresh((current) => new Set([...current].filter((id) => !ids.includes(id))));
      setFreshReady((current) => new Set([...current].filter((id) => !readyIds.includes(id))));
    }, FRESH_MS);
    const readyText =
      justReady.length === 0
        ? ""
        : justReady.length === 1
          ? `Listo para entregar: ${callName(justReady[0], next.multiBranch)}.`
          : `Hay platos listos para entregar en ${justReady.length} mesas.`;
    setAnnouncement([incoming.length > 0 ? newCallsAnnouncement(incoming, next.multiBranch) : "", readyText].filter(Boolean).join(" "));
    if (hasCompletedKitchenOrder(justReady)) beepIfOn("ready");
    else if (incoming.length > 0) beepIfOn();
  }, []);

  // --- Sondeo: la tabla es la fuente de verdad; cada respuesta reemplaza la lista entera.
  // Una sola consulta a la vez (si no, una respuesta vieja podía pisar a una nueva) y una respuesta que salió ANTES de
  // que terminara una atención se descarta: podía traer de vuelta la tarjeta que acaba de atenderse.
  useEffect(() => {
    if (!initial.enabled) return;

    let disposed = false;
    let stopped = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let failures = 0;
    let pollAgain = false;

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
      const epochAtStart = attendEpoch.current;
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
      } else if (attendEpoch.current === epochAtStart) {
        failures = 0;
        setConnection("ok");
        applyState(outcome.next);
        // El plan o la cuenta ya no lo permiten: la pantalla muestra el aviso y no se sigue consultando.
        if (!outcome.next.enabled) {
          stopped = true;
          return;
        }
      }
      const again = pollAgain;
      pollAgain = false;
      timer = setTimeout(poll, again ? 0 : nextPollDelay(!document.hidden, failures));
    };

    // Tras cambiar la vista: si hay una consulta en vuelo (con la vista vieja) se repite apenas termine.
    pollNow.current = () => {
      if (inFlight) pollAgain = true;
      else void poll();
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
      pollNow.current = null;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [slug, initial.enabled, applyState]);

  // --- Alertas.
  useEffect(() => {
    alertsRef.current = alerts;
  }, [alerts]);

  useEffect(() => {
    // El Wake Lock se pierde al ocultar la pestaña: se vuelve a pedir al volver.
    const again = () => {
      if (alertsRef.current === "on" && document.visibilityState === "visible") void requestWakeLock();
    };
    document.addEventListener("visibilitychange", again);
    again(); // si el sonido ya estaba activado al entrar (venía de otra pantalla del panel), también se mantiene la pantalla encendida
    return () => {
      document.removeEventListener("visibilitychange", again);
      void releaseWakeLock();
    };
  }, [requestWakeLock, releaseWakeLock]);

  async function activateAlerts() {
    if (!(await activateSound())) return;
    await requestWakeLock();
  }

  async function silenceAlerts() {
    silenceSound();
    await releaseWakeLock();
  }

  async function chooseView(ids: string[]) {
    savingViewRef.current = true;
    setSavingView(true);
    setViewNote("");
    setPendingView(ids);
    try {
      const result = await setBranchViewAction(slug, ids);
      if (result !== "ok") {
        setPendingView(null);
        setViewNote("No se pudo guardar tu elección de sucursal. Probá de nuevo.");
        return;
      }
      // Una respuesta que salió ANTES de guardar trae la vista vieja: se descarta (igual que tras atender) y se consulta de nuevo.
      attendEpoch.current += 1;
      pollNow.current?.();
    } catch {
      setPendingView(null);
      setViewNote("No se pudo guardar tu elección de sucursal. Probá de nuevo.");
    } finally {
      savingViewRef.current = false;
      setSavingView(false);
    }
  }

  async function attend(card: MesaCard, call: MesaCall) {
    setBusy(call.id);
    setNotes((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== call.id)));
    try {
      const result = await attendCallAction(slug, call.id);
      attendEpoch.current += 1;
      if (result.status === "unavailable") {
        setNotes((current) => ({ ...current, [call.id]: "No se pudo marcar como atendido: la cuenta o el plan no lo permiten ahora." }));
        return;
      }
      setState((current) => ({
        ...current,
        mesas: sortMesas(current.mesas.map((item) => ({ ...item, calls: item.calls.filter((c) => c.id !== call.id) }))),
      }));
      const name = callName(card, state.multiBranch);
      setGlobalNote(
        result.status === "already_attended"
          ? `${name}: ya lo atendió otra persona.`
          : result.status === "expired"
            ? `${name}: ese llamado ya venció.`
            : result.status === "not_found"
              ? `${name}: ese llamado ya no existe.`
              : `${name}: marcado como atendido.`,
      );
    } catch {
      setNotes((current) => ({ ...current, [call.id]: "No se pudo comunicar con el servidor. Probá de nuevo." }));
    } finally {
      setBusy(null);
    }
  }

  const sinceOk = Math.max(0, now - lastOk);

  // --- Plan o cuenta que no permiten los pedidos (y con ellos, los llamados).
  if (!state.enabled) {
    return (
      <section aria-labelledby="mesas-aviso" data-testid="mesas-deshabilitada" className="panel-cell mt-6 max-w-prose">
        <h2 id="mesas-aviso" className="font-display text-2xl">
          Las mesas y los pedidos no están disponibles
        </h2>
        <p className="mt-2 text-lg leading-relaxed text-muted">
          {isOwner
            ? "Los llamados de las mesas, los pedidos y la cuenta están incluidos desde el plan Pro y con la cuenta al día. Mientras tanto los comensales no ven los botones y acá no llegan avisos."
            : "Por ahora no están disponibles. Avisale al dueño."}
        </p>
      </section>
    );
  }

  /** Los llamados de una mesa, con «Atendido». Iguales en ambas vistas; `compact` solo cambia la disposición. */
  function renderCalls(card: MesaCard, compact: boolean) {
    if (card.calls.length === 0) return null;
    return (
      <ul className={compact ? "mt-2 space-y-2" : "mt-3 space-y-3"} data-testid="llamados-mesa">
        {card.calls.map((call) => {
          const waited = waitingMs(call, now);
          const callUrgent = isUrgent(waited);
          const isNew = fresh.has(call.id);
          const visitAge = visitAgeMs(call);
          const stale = visitAge !== null && isStaleVisit(visitAge);
          const attendButton = (
            <button
              type="button"
              onClick={() => attend(card, call)}
              disabled={busy === call.id}
              aria-label={`Marcar como atendido: ${callName(card, state.multiBranch)}, ${KIND_LABEL[call.kind].toLowerCase()}`}
              className={compact ? `${primaryClass} shrink-0` : `${primaryClass} mt-2 w-full sm:w-auto`}
            >
              {busy === call.id ? "Guardando…" : "Atendido"}
            </button>
          );
          const info = (
            <div className="min-w-0">
              <p className={compact ? "text-base" : "text-lg"} data-testid="espera">
                <strong>{KIND_LABEL[call.kind]}</strong> · {isNew ? <strong>Nuevo · </strong> : null}
                {elapsedLabel(waited)}
                {callUrgent ? <strong className="text-suspended-ink"> · Espera hace rato</strong> : null}
              </p>
              {visitAge !== null ? (
                <p className="mt-1 text-sm text-muted" data-testid="escaneo" data-vieja={stale ? "true" : "false"}>
                  Escaneó el QR {durationLabel(visitAge)} antes del aviso
                  {stale ? <strong className="text-ink"> · Hace mucho: confirmá que siga en la mesa</strong> : null}
                </p>
              ) : null}
            </div>
          );
          return (
            <li key={call.id} data-testid="llamado" data-mesa={card.tableLabel} data-kind={call.kind} data-nuevo={isNew ? "true" : "false"} data-urgente={callUrgent ? "true" : "false"}>
              {compact ? (
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  {info}
                  {attendButton}
                </div>
              ) : (
                <>
                  {info}
                  {attendButton}
                </>
              )}
              {notes[call.id] ? (
                <p role="alert" className="mt-2 text-base font-medium text-danger">
                  {notes[call.id]}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }

  /** El pedido abierto de una mesa (o «Sin pedido abierto»). Los mismos datos en ambas vistas. */
  function renderOrder(card: MesaCard, compact: boolean) {
    if (!card.order) {
      return (
        <p className={`${compact ? "mt-2" : "mt-3"} text-base text-muted`} data-testid="sin-pedido">
          Sin pedido abierto.
        </p>
      );
    }
    const opened = <p className="text-sm text-muted">Abierto hace {durationLabel(Math.max(0, now - Date.parse(card.order.openedAt)))}</p>;
    const status = (
      <p className="text-base" data-testid="pedido-estado">
        {orderStatusText(card.order)}
        {card.order.ready > 0 ? <strong data-testid="pedido-listo"> · Listo para entregar</strong> : null}
      </p>
    );
    const total = (
      <p className={`font-display leading-none ${compact ? "text-2xl" : "mt-1 text-3xl"}`} data-testid="pedido-total" data-centavos={card.order.totalCents}>
        {formatArs(card.order.totalCents)}
      </p>
    );
    return compact ? (
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1" data-testid="pedido">
        {status}
        {total}
        {opened}
      </div>
    ) : (
      <div className="mt-3" data-testid="pedido">
        {status}
        {total}
        <div className="mt-1">{opened}</div>
      </div>
    );
  }

  return (
    <section aria-label="Mesas en vivo" className="mt-6">
      {/* Un solo anuncio para lectores de pantalla (esta región viva). El aviso visible de abajo repite el texto SIN ser una región
          viva y queda fuera del árbol de accesibilidad: dos regiones con el mismo texto lo anunciarían dos veces. */}
      <div aria-live="polite" data-testid="anuncio" className="sr-only">
        {announcement}
      </div>
      {(fresh.size > 0 || freshReady.size > 0) && announcement ? (
        <p aria-hidden="true" data-testid="aviso-nuevo" className="mb-4 rounded-2xl bg-tile px-4 py-3 text-lg font-semibold ring-2 ring-inset ring-cobalt">
          {announcement}
        </p>
      ) : null}

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

      <SelectorDeSucursal branches={state.branches} view={pendingView ?? state.view} saving={savingView} onChange={chooseView} />
      {viewNote ? (
        <p role="alert" className="mb-4 text-base font-medium text-danger">
          {viewNote}
        </p>
      ) : null}
      {state.othersPending > 0 ? (
        // Red de seguridad: lo de las sucursales que no se miran no suena ni avisa, pero se sabe que existe. Sin región viva.
        <p data-testid="otras-sucursales" className="mb-4 rounded-2xl bg-readonly-bg px-4 py-3 text-base text-readonly-ink ring-1 ring-inset ring-readonly-edge">
          {state.othersPending === 1
            ? "Hay 1 llamado pendiente en otra sucursal que no estás mirando."
            : `Hay ${state.othersPending} llamados pendientes en otras sucursales que no estás mirando.`}{" "}
          <button type="button" disabled={savingView} onClick={() => chooseView([])} className="font-medium underline underline-offset-2">
            Ver todas
          </button>
        </p>
      ) : null}

      <div className="panel-cell mb-4 flex flex-wrap items-center gap-3 !py-4">
        {alerts === "on" ? (
          <>
            <p className="text-base font-medium" data-testid="alertas-activas">
              Alertas activadas (sonido y pantalla encendida)
            </p>
            <button type="button" onClick={silenceAlerts} className={buttonClass}>
              Silenciar alertas
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={activateAlerts} className={primaryClass}>
              Activar alertas
            </button>
            <p className="max-w-prose text-sm text-muted">
              {alerts === "blocked"
                ? "Tu navegador no dejó activar el sonido: vas a ver los avisos en pantalla."
                : hadAlerts
                  ? "Tocá para volver a activar el sonido en este dispositivo."
                  : "Activá el sonido para enterarte sin mirar la pantalla."}
            </p>
          </>
        )}
      </div>

      <AvisoPush slug={slug} publicKey={pushPublicKey} where="sala" />

      {pendingCount > 0 ? (
        <p className="mb-3 font-display text-2xl leading-tight" data-testid="resumen-llamados">
          {pendingCount === 1 ? "1 llamado pendiente" : `${pendingCount} llamados pendientes`}
        </p>
      ) : null}

      {state.mesas.length > 0 ? (
        <div role="group" aria-label="Cómo ver las mesas" data-testid="vista-mesas" className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-muted">Ver como</span>
          {(["tarjetas", "filas"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={layout === option}
              onClick={() => chooseLayout(option)}
              className={`inline-flex min-h-11 items-center rounded-full px-4 text-base font-medium ${
                layout === option ? "bg-brand text-white" : "border border-ink/50 text-ink hover:bg-ink/5"
              }`}
            >
              {option === "tarjetas" ? "Tarjetas" : "Filas"}
            </button>
          ))}
        </div>
      ) : null}

      {state.mesas.length === 0 ? (
        <p className="panel-cell font-display text-3xl leading-tight text-muted" data-testid="mesas-vacia">
          No hay mesas para mostrar.
        </p>
      ) : (
        <ul className={layout === "filas" ? "space-y-2" : "grid gap-3 sm:grid-cols-2 2xl:grid-cols-3"} data-testid="mesas" data-vista={layout}>
          {state.mesas.map((card) => {
            const band = bandOf(card);
            const urgent = card.calls.some((call) => isUrgent(waitingMs(call, now)));
            const isNewCard = card.calls.some((call) => fresh.has(call.id)) || freshReady.has(card.tableId);
            const border = urgent ? "border-4 border-suspended-edge" : isNewCard ? "border-4 border-cobalt" : "border border-ink/15";
            const anotar = (
              <Link
                href={`/sala/${slug}/mesas/${card.tableId}/anotar`}
                data-testid="anotar"
                aria-label={`${card.order ? "Ver pedido y anotar" : "Anotar pedido"}: ${card.tableLabel}`}
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-ink/50 px-5 py-2 text-base font-medium text-ink hover:bg-ink/5"
              >
                {card.order ? "Ver pedido y anotar" : "Anotar pedido"}
              </Link>
            );

            const reiniciar = (
              <button
                type="button"
                data-testid="abrir-reinicio"
                aria-label={`Reiniciar QR: ${card.tableLabel}`}
                onClick={() => setResetFor({ tableId: card.tableId, label: card.tableLabel })}
                className={buttonClass}
              >
                Reiniciar QR
              </button>
            );

            if (layout === "filas") {
              return (
                <li key={card.tableId} data-testid="mesa" data-mesa={card.tableLabel} data-estado={estadoDe(card)} className={`flex overflow-hidden rounded-2xl bg-white ${border}`}>
                  <div aria-hidden="true" className={`w-2 shrink-0 ${band.className}`} />
                  <div className="min-w-0 flex-1 px-3 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <p className="font-display text-3xl leading-none break-words">{card.tableLabel}</p>
                      <span className={`rounded-full px-3 py-0.5 text-sm font-semibold ${band.className}`}>{band.label}</span>
                      {state.multiBranch ? <span className="text-sm text-muted">Sucursal {card.branchName}</span> : null}
                    </div>
                    {renderCalls(card, true)}
                    {renderOrder(card, true)}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {anotar}
                      {reiniciar}
                      {card.order ? (
                        <Link href={`/sala/${slug}/mesas/${card.tableId}/anotar?accion=cerrar`} data-testid="cerrar-desde-mesas" aria-label={`Cerrar o anular pedido: ${card.tableLabel}`} className={dangerPrimaryClass}>
                          Cerrar o anular pedido…
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            }

            return (
              <li key={card.tableId} data-testid="mesa" data-mesa={card.tableLabel} data-estado={estadoDe(card)} className={`flex flex-col overflow-hidden rounded-3xl bg-white ${border}`}>
                <div className={`px-5 py-2.5 ${band.className}`}>
                  <p className="text-lg font-semibold">{band.label}</p>
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <p className="font-display text-[2.75rem] leading-none break-words">{card.tableLabel}</p>
                  {state.multiBranch ? <p className="mt-2 text-sm text-muted">Sucursal {card.branchName}</p> : null}
                  {renderCalls(card, false)}
                  {renderOrder(card, false)}
                  <div className="mt-auto flex flex-wrap gap-2 pt-4">
                    {anotar}
                    {reiniciar}
                    {card.order ? (
                      <Link href={`/sala/${slug}/mesas/${card.tableId}/anotar?accion=cerrar`} data-testid="cerrar-desde-mesas" aria-label={`Cerrar o anular pedido: ${card.tableLabel}`} className={dangerPrimaryClass}>
                        Cerrar o anular pedido…
                      </Link>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {globalNote ? (
        <p role="status" data-testid="nota-sala" className="mt-4 text-base text-muted">
          {globalNote}
        </p>
      ) : null}
      <p className="mt-6 text-sm text-muted" data-testid="actualizado">
        Se actualiza sola cada pocos segundos.
      </p>
      {resetFor ? <ResetSheet key={resetFor.tableId} slug={slug} tableId={resetFor.tableId} label={resetFor.label} onClose={() => setResetFor(null)} /> : null}
    </section>
  );
}

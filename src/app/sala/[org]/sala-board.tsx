"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  durationLabel,
  elapsedLabel,
  isStaleVisit,
  callName,
  isUrgent,
  KIND_LABEL,
  newCalls,
  newCallsAnnouncement,
  nextPollDelay,
  pageTitle,
  parseSalaState,
  VISIBLE_POLL_MS,
  visitAgeMs,
  waitingMs,
  type SalaCall,
  type SalaState,
} from "@/lib/sala/types";
import { AvisoPush } from "@/components/push/aviso-push";
import { activateSound, beepIfOn, rememberedAlerts, silenceSound, useSoundState } from "@/components/panel/sonido-llamados";
import { attendCallAction } from "./actions";

/** Cuánto dura el resaltado de un llamado nuevo. */
const FRESH_MS = 8_000;
/** Una consulta que no responde en este tiempo se corta: cuenta como falla y no frena el sondeo. */
const REQUEST_TIMEOUT_MS = 10_000;

type Connection = "ok" | "offline" | "expired" | "gone";

const buttonClass =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-ink/50 px-4 py-2 text-base font-medium text-ink hover:bg-ink/5 disabled:opacity-60";
const primaryClass =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-cobalt px-5 py-2 text-base font-medium text-white hover:bg-brand-deep disabled:opacity-60";
/** Cada tipo de aviso lleva su propio tono en la banda de la tarjeta (el mismo vocabulario de la carta: verde y rosa). */
const BAND_CLASS = { waiter: "bg-brand text-white", bill: "bg-blush text-ink" } as const;

export function SalaBoard({
  slug,
  initial,
  isOwner,
  pushPublicKey,
}: {
  slug: string;
  initial: SalaState;
  isOwner: boolean;
  /** Clave pública VAPID; `null` si el aviso con la pestaña cerrada no está configurado en este entorno (no se muestra el bloque). */
  pushPublicKey: string | null;
}) {
  const [state, setState] = useState<SalaState>(initial);
  const [now, setNow] = useState(() => Date.parse(initial.serverNow));
  const [lastOk, setLastOk] = useState(() => Date.parse(initial.serverNow));
  const [connection, setConnection] = useState<Connection>("ok");
  // El sonido vive fuera de la pantalla (módulo compartido con el panel): salir de la sala no lo apaga.
  const alerts = useSoundState();
  const [hadAlerts, setHadAlerts] = useState(false);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [globalNote, setGlobalNote] = useState("");

  // Diferencia entre el reloj del servidor y el del dispositivo: «hace N» sale de la hora del servidor.
  const offset = useRef(0);
  const seen = useRef<Set<string>>(new Set(initial.calls.map((call) => call.id)));
  const alertsRef = useRef(alerts);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  // Sube cada vez que termina una atención: invalida las consultas que ya estaban en vuelo.
  const attendEpoch = useRef(0);

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
    const timer = setTimeout(() => setHadAlerts(rememberedAlerts()), 0);
    return () => clearTimeout(timer);
  }, []);

  // --- Título de la pestaña.
  useEffect(() => {
    document.title = pageTitle(state.calls.length);
  }, [state.calls.length]);

  // --- Un llamado nuevo: resalta, anuncia y, con las alertas activas, suena. Nunca al cargar los que ya había.
  const applyState = useCallback((next: SalaState) => {
    const incoming = newCalls(seen.current, next.calls);
    for (const call of next.calls) seen.current.add(call.id);

    offset.current = Date.parse(next.serverNow) - Date.now();
    setNow(Date.parse(next.serverNow));
    setLastOk(Date.parse(next.serverNow));
    setState(next);

    if (incoming.length === 0) return;
    const ids = incoming.map((call) => call.id);
    setFresh((current) => new Set([...current, ...ids]));
    setTimeout(() => {
      setFresh((current) => new Set([...current].filter((id) => !ids.includes(id))));
    }, FRESH_MS);
    setAnnouncement(newCallsAnnouncement(incoming, next.multiBranch));
    beepIfOn();
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

    type Outcome = { kind: "expired" } | { kind: "gone" } | { kind: "state"; next: SalaState } | { kind: "error" };

    const fetchState = async (signal: AbortSignal): Promise<Outcome> => {
      try {
        const response = await fetch(`/sala/${encodeURIComponent(slug)}/estado`, {
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
        const next = response.ok && isJson ? parseSalaState(await response.json()) : null;
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

  async function attend(call: SalaCall) {
    setBusy(call.id);
    setNotes((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== call.id)));
    try {
      const result = await attendCallAction(slug, call.id);
      attendEpoch.current += 1;
      if (result.status === "unavailable") {
        setNotes((current) => ({ ...current, [call.id]: "No se pudo marcar como atendido: la cuenta o el plan no lo permiten ahora." }));
        return;
      }
      setState((current) => ({ ...current, calls: current.calls.filter((c) => c.id !== call.id) }));
      const name = callName(call, state.multiBranch);
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

  // --- Plan o cuenta que no permiten el llamado.
  if (!state.enabled) {
    return (
      <section aria-labelledby="sala-aviso" data-testid="sala-deshabilitada" className="panel-cell mt-6 max-w-prose">
        <h2 id="sala-aviso" className="font-display text-2xl">
          El llamado al mozo no está disponible
        </h2>
        <p className="mt-2 text-lg leading-relaxed text-muted">
          {isOwner
            ? "Está incluido desde el plan Pro y con la cuenta al día. Mientras tanto los comensales no ven los botones y acá no llegan avisos."
            : "Por ahora no está disponible. Avisale al dueño."}
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Llamados pendientes" className="mt-6">
      {/* Un solo anuncio para lectores de pantalla (esta región viva). El aviso visible de abajo repite el texto SIN ser una región
          viva y queda fuera del árbol de accesibilidad: dos regiones con el mismo texto lo anunciarían dos veces. */}
      <div aria-live="polite" data-testid="anuncio" className="sr-only">
        {announcement}
      </div>
      {fresh.size > 0 && announcement ? (
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
          <Link href={`/login?next=${encodeURIComponent(`/sala/${slug}`)}`} className="font-medium underline underline-offset-2">
            Ingresar de nuevo
          </Link>
        </p>
      ) : null}
      {connection === "gone" ? (
        <p role="alert" className="mb-4 rounded-2xl bg-suspended-bg px-4 py-3 text-base text-suspended-ink ring-1 ring-inset ring-suspended-edge">
          <strong>Este local ya no está disponible para tu cuenta.</strong>
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

      {state.calls.length === 0 ? (
        <p className="panel-cell font-display text-3xl leading-tight text-muted" data-testid="sala-vacia">
          No hay llamados pendientes.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3" data-testid="llamados">
          {state.calls.map((call) => {
            const waited = waitingMs(call, now);
            const urgent = isUrgent(waited);
            const isNew = fresh.has(call.id);
            const visitAge = visitAgeMs(call);
            const stale = visitAge !== null && isStaleVisit(visitAge);
            return (
              <li
                key={call.id}
                data-testid="llamado"
                data-mesa={call.tableLabel}
                data-kind={call.kind}
                data-nuevo={isNew ? "true" : "false"}
                data-urgente={urgent ? "true" : "false"}
                className={`flex flex-col overflow-hidden rounded-3xl bg-white ${
                  urgent ? "border-4 border-suspended-edge" : isNew ? "border-4 border-cobalt" : "border border-ink/15"
                }`}
              >
                <div className={`px-5 py-2.5 ${BAND_CLASS[call.kind]}`}>
                  <p className="text-lg font-semibold">{KIND_LABEL[call.kind]}</p>
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <p className="font-display text-[2.75rem] leading-none break-words">{call.tableLabel}</p>
                  {state.multiBranch ? <p className="mt-2 text-sm text-muted">Sucursal {call.branchName}</p> : null}
                  <p className="mt-3 text-xl" data-testid="espera">
                    {isNew ? <strong>Nuevo · </strong> : null}
                    {elapsedLabel(waited)}
                    {urgent ? <strong className="text-suspended-ink"> · Espera hace rato</strong> : null}
                  </p>
                  {visitAge !== null ? (
                    <p className="mt-1 text-sm text-muted" data-testid="escaneo" data-vieja={stale ? "true" : "false"}>
                      Escaneó el QR {durationLabel(visitAge)} antes del aviso
                      {stale ? <strong className="text-ink"> · Hace mucho: confirmá que siga en la mesa</strong> : null}
                    </p>
                  ) : null}
                  <div className="mt-auto pt-4">
                    <button
                      type="button"
                      onClick={() => attend(call)}
                      disabled={busy === call.id}
                      aria-label={`Marcar como atendido: ${callName(call, state.multiBranch)}, ${KIND_LABEL[call.kind].toLowerCase()}`}
                      className={`${primaryClass} w-full sm:w-auto`}
                    >
                      {busy === call.id ? "Guardando…" : "Atendido"}
                    </button>
                  </div>
                  {notes[call.id] ? (
                    <p role="alert" className="mt-2 text-base font-medium text-danger">
                      {notes[call.id]}
                    </p>
                  ) : null}
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
    </section>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { setPendingCalls } from "./llamados-pendientes";
import { KIND_LABEL, nextPollDelay, parseSalaState, sortOldestFirst, type SalaCall } from "@/lib/sala/types";

/**
 * Aviso de llamados DENTRO del panel (ficha aviso-push-desde-el-panel): quien edita la carta u otra pantalla del panel ve
 * arriba, sin salir, que una mesa llamó. Consulta el mismo estado que la sala (`/sala/{slug}/estado`, con la sesión y RLS)
 * cada ~3 s con la pestaña a la vista. El aviso del sistema (Web Push) cubre el caso de pestaña oculta o cerrada; el
 * service worker no lo muestra si hay un panel a la vista y con foco, porque este cartel ya avisa. Sin sonido: para eso
 * está la sala en vivo.
 */
export function LlamadosBanner({ slug }: { slug: string }) {
  const [calls, setCalls] = useState<SalaCall[]>([]);
  const [multiBranch, setMultiBranch] = useState(false);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    let disposed = false;
    let inFlight = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    const schedule = () => {
      if (disposed || stopped.current) return;
      clearTimeout(timer);
      timer = setTimeout(poll, nextPollDelay(document.visibilityState === "visible", failures));
    };

    const poll = async () => {
      if (inFlight || disposed || stopped.current) return;
      inFlight = true;
      controller = new AbortController();
      const abort = setTimeout(() => controller?.abort(), 10_000);
      try {
        const response = await fetch(`/sala/${encodeURIComponent(slug)}/estado`, {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        // Sesión vencida o local inexistente: el panel se ocupa de redirigir; este cartel solo deja de consultar.
        if (response.status === 401 || response.status === 404) {
          stopped.current = true;
          return;
        }
        const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
        const next = response.ok && isJson && !response.redirected ? parseSalaState(await response.json()) : null;
        if (!next) throw new Error("respuesta inválida");
        if (!next.enabled) {
          // El plan o la cuenta no permiten el llamado: no hay nada que mostrar ni que consultar.
          setCalls([]);
          setPendingCalls(0);
          stopped.current = true;
          return;
        }
        failures = 0;
        if (!disposed) {
          setCalls(next.calls);
          setPendingCalls(next.calls.length); // la navegación marca «Sala en vivo» mientras haya pendientes, estén o no ocultos en el cartel
          setMultiBranch(next.multiBranch);
        }
      } catch {
        failures += 1; // sin conexión: se espacia el sondeo y el cartel queda como estaba
      } finally {
        clearTimeout(abort);
        inFlight = false;
        schedule();
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible" && !inFlight && !stopped.current) void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    void poll();
    return () => {
      disposed = true;
      setPendingCalls(0);
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [slug]);

  const shown = sortOldestFirst(calls.filter((call) => !hidden.has(call.id)));
  // El nodo `status` existe siempre: así el lector de pantalla anuncia lo que aparece después.
  return (
    <div role="status" aria-live="polite" data-testid="llamados-aviso" className="sticky top-0 z-40 print:hidden">
      {shown.length > 0 ? (
        <section className="border-b border-blush bg-blush text-ink shadow-sm" aria-label="Llamados pendientes">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-8 lg:px-10">
            <p className="basis-full font-display text-xl leading-snug sm:basis-auto" data-testid="llamados-aviso-titulo">
              {shown.length === 1 ? "Una mesa necesita atención" : `${shown.length} mesas necesitan atención`}
            </p>
            <ul className="flex min-w-0 basis-full flex-wrap gap-x-4 gap-y-1 text-base sm:flex-1 sm:basis-0" data-testid="llamados-aviso-lista">
              {shown.slice(0, 4).map((call) => (
                <li key={call.id} className="break-words">
                  <span className="font-medium">{call.tableLabel}</span>
                  {multiBranch ? ` (${call.branchName})` : ""} · {KIND_LABEL[call.kind].toLowerCase()}
                </li>
              ))}
              {shown.length > 4 ? <li>y {shown.length - 4} más</li> : null}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/sala/${slug}`}
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-ink px-5 py-2 text-base font-medium text-white"
              >
                Ir a la sala en vivo
              </Link>
              <button
                type="button"
                onClick={() => setHidden((current) => new Set([...current, ...shown.map((call) => call.id)]))}
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-ink/50 px-4 py-2 text-base font-medium text-ink hover:bg-ink/5"
              >
                Ocultar
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { barPercent, callsOf, hourRange, peakHours, plural, type HourCalls } from "@/lib/analitica/lectura";

/**
 * Gráfico de llamados por hora (ficha analitica-basica). Cada columna de las 24 horas se puede señalar: con el mouse, al
 * pasar el cursor; en el teléfono, al tocarla (se queda hasta tocar otra o tocar afuera); con el teclado, con las
 * flechas. Muestra la hora exacta y cuántos llamaron al mozo y cuántos pidieron la cuenta. Barras de CSS, sin librerías.
 */

const verbs = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Dónde va el cartel respecto de la columna: centrado, salvo en los bordes, para que no se corte. */
function tooltipPosition(hour: number): CSSProperties {
  if (hour <= 3) return { left: `${(hour / 24) * 100}%` };
  if (hour >= 20) return { right: `${((23 - hour) / 24) * 100}%` };
  return { left: `${((hour + 0.5) / 24) * 100}%`, transform: "translateX(-50%)" };
}

export function HoursChart({ hours }: { hours: HourCalls[] }) {
  const peak = peakHours(hours)[0]?.hour ?? 0;
  const [active, setActive] = useState<number | null>(null);
  const [tabbable, setTabbable] = useState(peak); // una sola columna entra con Tab; las demás, con flechas
  const root = useRef<HTMLDivElement>(null);
  const columns = useRef<(HTMLButtonElement | null)[]>([]);
  const max = Math.max(0, ...hours.map(callsOf));
  const current = active === null ? null : hours[active];

  // En el teléfono el cartel se queda al soltar el dedo: se cierra al tocar fuera del gráfico o con Escape.
  useEffect(() => {
    if (active === null) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setActive(null);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setActive(null);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [active]);

  function move(from: number, to: number) {
    const next = Math.min(23, Math.max(0, to));
    if (next === from) return;
    setTabbable(next);
    columns.current[next]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, hour: number) {
    const target = { ArrowLeft: hour - 1, ArrowRight: hour + 1, Home: 0, End: 23 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    move(hour, target);
  }

  return (
    <div ref={root} className="panel-cell mt-4">
      {/* Con el mouse, el cartel se va al sacar el cursor; con el dedo (táctil) se queda hasta tocar fuera. */}
      <div className="relative pt-[7rem]" onPointerLeave={(event) => event.pointerType !== "touch" && setActive(null)}>
        {current ? (
          <div
            role="status"
            data-testid="tooltip-hora"
            className="pointer-events-none absolute top-0 z-10 w-max max-w-[15rem] rounded-xl bg-ink px-3 py-2 text-sm leading-snug text-white shadow-lg"
            style={tooltipPosition(current.hour)}
          >
            <p className="font-medium">{hourRange(current.hour)}</p>
            {callsOf(current) === 0 ? (
              <p>Sin llamados</p>
            ) : (
              <>
                <p>{verbs(current.waiter, "llama al mozo", "llaman al mozo")}</p>
                <p>{verbs(current.bill, "pide la cuenta", "piden la cuenta")}</p>
                <p className="mt-0.5 border-t border-white/30 pt-0.5">{plural(callsOf(current), "llamado", "llamados")} en total</p>
              </>
            )}
          </div>
        ) : null}

        <div
          data-testid="grafico-horas"
          role="group"
          aria-label="Llamados por hora del día. Con las flechas recorrés las horas."
          className="flex h-44 items-end gap-[3px] sm:gap-1"
        >
          {hours.map((hour) => (
            <button
              key={hour.hour}
              ref={(element) => {
                columns.current[hour.hour] = element;
              }}
              type="button"
              data-hora={hour.hour}
              data-total={callsOf(hour)}
              data-activo={active === hour.hour ? "true" : undefined}
              tabIndex={tabbable === hour.hour ? 0 : -1}
              aria-label={`${hourRange(hour.hour)}: ${verbs(hour.waiter, "llama al mozo", "llaman al mozo")}, ${verbs(hour.bill, "pide la cuenta", "piden la cuenta")}`}
              onPointerEnter={() => setActive(hour.hour)}
              onFocus={() => {
                setActive(hour.hour);
                setTabbable(hour.hour);
              }}
              onBlur={() => setActive((now) => (now === hour.hour ? null : now))}
              onKeyDown={(event) => onKeyDown(event, hour.hour)}
              className={`flex h-full min-w-0 flex-1 cursor-default flex-col justify-end rounded-sm outline-offset-2 focus-visible:outline-2 focus-visible:outline-ink ${
                active === hour.hour ? "bg-ink/10" : "hover:bg-ink/5"
              }`}
            >
              <span className="block w-full rounded-t-sm bg-blush ring-1 ring-ink/25 ring-inset" style={{ height: `${barPercent(hour.bill, max)}%` }} />
              <span className="block w-full bg-brand" style={{ height: `${barPercent(hour.waiter, max)}%` }} />
            </button>
          ))}
        </div>
      </div>

      <div aria-hidden className="mt-2 flex justify-between text-xs text-muted tabular-nums">
        {[0, 6, 12, 18].map((hour) => (
          <span key={hour}>{hour} h</span>
        ))}
        <span>24 h</span>
      </div>
      <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-2">
          <i className="size-3 bg-brand" /> Llaman al mozo
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="size-3 bg-blush ring-1 ring-ink/25 ring-inset" /> Piden la cuenta
        </span>
      </p>
      <p className="mt-2 text-sm text-muted">Pasá el cursor o tocá una barra para ver la hora y la cantidad.</p>
    </div>
  );
}

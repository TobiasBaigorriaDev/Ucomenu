"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { barPercent } from "@/lib/analitica/lectura";

/**
 * Gráfico de barras con detalle (ficha analitica-de-pedidos): cada columna se puede señalar. Con el mouse, al pasar el cursor;
 * en el teléfono, al tocarla (el cartel se queda hasta tocar otra o tocar afuera); con el teclado, con las flechas. Barras de
 * CSS, sin librerías. El detalle de cada columna viene armado desde el servidor (`lines`), así que esto no sabe de pesos ni de fechas.
 */

export type Bar = {
  key: string;
  value: number;
  /** Texto de la columna para lectores de pantalla. */
  label: string;
  /** Líneas del cartel; la primera va en negrita. */
  lines: string[];
};

/** Dónde va el cartel respecto de la columna: centrado, salvo en los bordes, para que no se corte. */
function tooltipPosition(index: number, count: number): CSSProperties {
  const edge = Math.max(2, Math.round(count * 0.15));
  if (index < edge) return { left: `${(index / count) * 100}%` };
  if (index >= count - edge) return { right: `${((count - 1 - index) / count) * 100}%` };
  return { left: `${((index + 0.5) / count) * 100}%`, transform: "translateX(-50%)" };
}

export function BarsChart({
  bars,
  groupLabel,
  testId,
  axis,
  hint,
}: {
  bars: Bar[];
  groupLabel: string;
  testId: string;
  /** Rótulos del eje: el primero a la izquierda, el último a la derecha y los demás repartidos. */
  axis: string[];
  hint: string;
}) {
  const max = Math.max(0, ...bars.map((bar) => bar.value));
  const peak = Math.max(0, bars.findIndex((bar) => bar.value === max));
  const [active, setActive] = useState<number | null>(null);
  const [tabbable, setTabbable] = useState(peak); // una sola columna entra con Tab; las demás, con flechas
  const root = useRef<HTMLDivElement>(null);
  const columns = useRef<(HTMLButtonElement | null)[]>([]);
  const current = active === null ? null : bars[active];

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
    const next = Math.min(bars.length - 1, Math.max(0, to));
    if (next === from) return;
    setTabbable(next);
    columns.current[next]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const target = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: bars.length - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    move(index, target);
  }

  return (
    <div ref={root} className="panel-cell mt-4">
      {/* Con el mouse, el cartel se va al sacar el cursor; con el dedo (táctil) se queda hasta tocar fuera. */}
      <div className="relative pt-[6.5rem]" onPointerLeave={(event) => event.pointerType !== "touch" && setActive(null)}>
        {current ? (
          <div
            role="status"
            data-testid={`${testId}-cartel`}
            className="pointer-events-none absolute top-0 z-10 w-max max-w-[15rem] rounded-xl bg-ink px-3 py-2 text-sm leading-snug text-white shadow-lg"
            style={tooltipPosition(active!, bars.length)}
          >
            {current.lines.map((line, index) => (
              <p key={index} className={index === 0 ? "font-medium" : undefined}>
                {line}
              </p>
            ))}
          </div>
        ) : null}

        <div data-testid={testId} role="group" aria-label={groupLabel} className={`flex h-44 items-end ${bars.length > 31 ? "gap-px" : "gap-[3px] sm:gap-1"}`}>
          {bars.map((bar, index) => (
            <button
              key={bar.key}
              ref={(element) => {
                columns.current[index] = element;
              }}
              type="button"
              data-indice={index}
              data-valor={bar.value}
              data-activo={active === index ? "true" : undefined}
              tabIndex={tabbable === index ? 0 : -1}
              aria-label={bar.label}
              onPointerEnter={() => setActive(index)}
              onFocus={() => {
                setActive(index);
                setTabbable(index);
              }}
              onBlur={() => setActive((now) => (now === index ? null : now))}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={`flex h-full min-w-0 flex-1 cursor-default flex-col justify-end rounded-sm outline-offset-2 focus-visible:outline-2 focus-visible:outline-ink ${
                active === index ? "bg-ink/10" : "hover:bg-ink/5"
              }`}
            >
              <span className="block w-full rounded-t-sm bg-brand" style={{ height: `${barPercent(bar.value, max)}%` }} />
            </button>
          ))}
        </div>
      </div>

      <div aria-hidden className="mt-2 flex justify-between text-xs text-muted tabular-nums">
        {axis.map((text, index) => (
          <span key={index}>{text}</span>
        ))}
      </div>
      <p className="mt-2 text-sm text-muted">{hint}</p>
    </div>
  );
}

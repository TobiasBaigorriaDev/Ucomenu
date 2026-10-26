"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { hourSpan, slotLevel, slotMax, WEEKDAYS, WEEKDAYS_SHORT, type SlotCell } from "@/lib/analitica/ventas";
import { formatArs } from "@/lib/money";
import { plural } from "@/lib/analitica/lectura";

/**
 * Mapa de calor de pedidos por día de la semana y hora de apertura (ficha analitica-de-pedidos). Cada celda se puede señalar:
 * con el mouse, al pasar el cursor; en el teléfono, al tocarla; con el teclado, con las flechas (arriba y abajo cambian de
 * día; izquierda y derecha, de hora). El detalle va en una línea fija debajo, así nunca se corta en los bordes. La intensidad
 * es un tramo del máximo, y el color es el verde del local con distinta opacidad (nunca solo color: el detalle lo dice con números).
 */

const LEVELS = ["bg-ink/[0.06]", "bg-brand/25", "bg-brand/50", "bg-brand/75", "bg-brand"] as const;

export function Heatmap({ slots }: { slots: SlotCell[][] }) {
  const max = slotMax(slots);
  const [active, setActive] = useState<[number, number] | null>(null);
  const [tabbable, setTabbable] = useState<[number, number]>(() => {
    for (let day = 0; day < 7; day += 1) {
      const hour = slots[day].findIndex((cell) => cell.orders === max && max > 0);
      if (hour >= 0) return [day, hour];
    }
    return [0, 12];
  });
  const root = useRef<HTMLDivElement>(null);
  const cells = useRef<Map<string, HTMLButtonElement>>(new Map());
  const current = active ? slots[active[0]][active[1]] : null;

  useEffect(() => {
    if (!active) return;
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

  function move(day: number, hour: number) {
    const next: [number, number] = [Math.min(6, Math.max(0, day)), Math.min(23, Math.max(0, hour))];
    setTabbable(next);
    cells.current.get(`${next[0]}-${next[1]}`)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, day: number, hour: number) {
    const target: Record<string, [number, number]> = {
      ArrowLeft: [day, hour - 1],
      ArrowRight: [day, hour + 1],
      ArrowUp: [day - 1, hour],
      ArrowDown: [day + 1, hour],
      Home: [day, 0],
      End: [day, 23],
    };
    const next = target[event.key];
    if (!next) return;
    event.preventDefault();
    move(next[0], next[1]);
  }

  return (
    <div ref={root} className="panel-cell mt-4">
      <div
        className="grid gap-px"
        style={{ gridTemplateColumns: "2rem repeat(24, minmax(0, 1fr))" }}
        data-testid="mapa-de-calor"
        role="group"
        aria-label="Pedidos por día y hora. Con las flechas recorrés las franjas."
        onPointerLeave={(event) => event.pointerType !== "touch" && setActive(null)}
      >
        {slots.map((row, day) => (
          <div key={day} className="contents">
            <span aria-hidden className="flex items-center text-xs text-muted">
              {WEEKDAYS_SHORT[day]}
            </span>
            {row.map((cell, hour) => (
              <button
                key={hour}
                ref={(element) => {
                  if (element) cells.current.set(`${day}-${hour}`, element);
                  else cells.current.delete(`${day}-${hour}`);
                }}
                type="button"
                data-dia={day + 1}
                data-hora={hour}
                data-pedidos={cell.orders}
                data-nivel={slotLevel(cell.orders, max)}
                data-activo={active?.[0] === day && active[1] === hour ? "true" : undefined}
                tabIndex={tabbable[0] === day && tabbable[1] === hour ? 0 : -1}
                aria-label={`${WEEKDAYS[day]}, ${hourSpan(hour)}: ${plural(cell.orders, "pedido", "pedidos")}`}
                onPointerEnter={() => setActive([day, hour])}
                onFocus={() => {
                  setActive([day, hour]);
                  setTabbable([day, hour]);
                }}
                onBlur={() => setActive((now) => (now && now[0] === day && now[1] === hour ? null : now))}
                onKeyDown={(event) => onKeyDown(event, day, hour)}
                className={`h-6 min-w-0 cursor-default rounded-[3px] outline-offset-1 focus-visible:outline-2 focus-visible:outline-ink ${LEVELS[slotLevel(cell.orders, max)]} ${
                  active?.[0] === day && active[1] === hour ? "ring-2 ring-ink" : ""
                }`}
              />
            ))}
          </div>
        ))}
      </div>

      <div aria-hidden className="mt-1 grid text-xs text-muted tabular-nums" style={{ gridTemplateColumns: "2rem repeat(24, minmax(0, 1fr))" }}>
        <span />
        {Array.from({ length: 24 }, (_, hour) => (
          <span key={hour} className="overflow-visible whitespace-nowrap">
            {hour % 6 === 0 ? `${hour} h` : ""}
          </span>
        ))}
      </div>

      <p role="status" data-testid="mapa-detalle" className="mt-3 min-h-[3rem] text-base">
        {active && current ? (
          current.orders === 0 ? (
            <>
              <strong className="font-medium">
                {WEEKDAYS[active[0]]}, {hourSpan(active[1])}
              </strong>
              : sin pedidos.
            </>
          ) : (
            <>
              <strong className="font-medium">
                {WEEKDAYS[active[0]]}, {hourSpan(active[1])}
              </strong>
              : {plural(current.orders, "pedido", "pedidos")}, {formatArs(current.revenueCents)} en total.
            </>
          )
        ) : (
          <span className="text-muted">Pasá el cursor o tocá una franja para ver el día, la hora y la cantidad de pedidos.</span>
        )}
      </p>

      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted">
        Menos
        {LEVELS.map((level, index) => (
          <i key={index} aria-hidden className={`size-4 rounded-[3px] ring-1 ring-ink/15 ring-inset ${level}`} />
        ))}
        Más
      </p>
    </div>
  );
}

"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { SHEET_WIDTH, sheetScale } from "./sheet";

/**
 * Visor de la hoja: una página de ancho fijo (`SHEET_WIDTH`) sobre un fondo gris, escalada para entrar entera en el ancho de la
 * pantalla, como un PDF recién abierto. La persona la amplía con los dedos (el viewport no bloquea el zoom) y se desplaza. Sin
 * JavaScript la página queda a tamaño real y el visor se desplaza de costado; por eso no se oculta nada ahí (`noscript`).
 */
export function SheetFit({ children }: { children: ReactNode }) {
  const viewer = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number>();
  useLayoutEffect(() => {
    const el = viewer.current;
    if (!el) return;
    const fit = () => {
      const style = getComputedStyle(el);
      const available = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      if (available > 0) setScale(sheetScale(available));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={viewer} data-testid="hoja-visor" className="sheet-viewer overflow-x-auto p-1.5 sm:p-5">
      <div className="sheet-paper mx-auto" data-fit={scale ? "" : undefined} style={{ width: SHEET_WIDTH, zoom: scale }}>
        {children}
      </div>
      <noscript>
        <style>{".sheet-paper{opacity:1 !important}"}</style>
      </noscript>
    </div>
  );
}

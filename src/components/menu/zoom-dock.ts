/** Lo que informa `window.visualViewport`: la parte de la página que se ve, que con el zoom de pellizco es menor que la pantalla. */
export type ViewportBox = { scale: number; offsetLeft: number; offsetTop: number; height: number };

/** Por debajo de esto el zoom no se nota y el dock queda donde lo deja el CSS. */
const ZOOM_EPSILON = 1.01;

/**
 * Estilo que mantiene un dock fijo abajo de lo que se ve y del mismo tamaño en pantalla con el zoom de pellizco. Un elemento `fixed`
 * se ancla al viewport de diseño, no al visible: al ampliar queda fuera de la vista o enorme. Se lo ancla arriba a la izquierda, se
 * lo lleva a la esquina inferior del viewport visible y se lo achica en la misma proporción en que la página se agranda (`scale(1/z)`).
 * Sin zoom devuelve `null`: se deja el CSS de siempre.
 */
export function zoomDockStyle(viewport: ViewportBox, dockHeight: number): { top: string; bottom: string; transformOrigin: string; transform: string } | null {
  if (viewport.scale < ZOOM_EPSILON) return null;
  const y = viewport.offsetTop + viewport.height - dockHeight / viewport.scale;
  return {
    top: "0px",
    bottom: "auto",
    transformOrigin: "0 0",
    transform: `translate(${viewport.offsetLeft}px, ${y}px) scale(${1 / viewport.scale})`,
  };
}

/**
 * Hace que `element` siga al viewport visible mientras la persona amplía y se desplaza (ver `zoomDockStyle`). Devuelve la función que
 * lo deja como estaba. Sin `visualViewport` (navegadores viejos) no hace nada.
 */
export function followVisualViewport(element: HTMLElement): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  let frame = 0;
  const reset = () => {
    element.style.removeProperty("top");
    element.style.removeProperty("bottom");
    element.style.removeProperty("transform-origin");
    element.style.removeProperty("transform");
  };
  const update = () => {
    frame = 0;
    const style = zoomDockStyle(viewport, element.offsetHeight);
    if (!style) return reset();
    element.style.top = style.top;
    element.style.bottom = style.bottom;
    element.style.transformOrigin = style.transformOrigin;
    element.style.transform = style.transform;
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  viewport.addEventListener("resize", schedule);
  viewport.addEventListener("scroll", schedule);
  window.addEventListener("scroll", schedule, { passive: true });
  const observer = new ResizeObserver(schedule);
  observer.observe(element);
  schedule();
  return () => {
    viewport.removeEventListener("resize", schedule);
    viewport.removeEventListener("scroll", schedule);
    window.removeEventListener("scroll", schedule);
    observer.disconnect();
    cancelAnimationFrame(frame);
    reset();
  };
}

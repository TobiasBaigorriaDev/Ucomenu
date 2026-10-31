"use client";

import { useEffect, useRef, useState } from "react";
import { secondaryButtonClass } from "@/components/panel/styles";

type State = "idle" | "copied" | "failed";

/**
 * Copia la dirección de la carta de una sucursal (ficha resumen-del-panel). El estado se dice en texto, no solo con el cambio del
 * botón: una región `aria-live` anuncia «Enlace copiado» o, si el navegador no deja copiar, la dirección para copiarla a mano.
 */
export function CopiarEnlace({ url, branchName }: { url: string; branchName: string }) {
  const [state, setState] = useState<State>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      ok = false;
    }
    setState(ok ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    if (ok) timer.current = setTimeout(() => setState("idle"), 2500);
  }

  return (
    <>
      <button type="button" onClick={copy} className={secondaryButtonClass} aria-label={`Copiar el enlace de la carta de ${branchName}`} data-testid="carta-copiar">
        {state === "copied" ? "Copiado" : "Copiar enlace"}
      </button>
      <span role="status" className={state === "failed" ? "basis-full text-sm break-all" : "sr-only"} data-testid="carta-copiar-estado">
        {state === "copied" ? "Enlace copiado" : state === "failed" ? `No pudimos copiarlo. La dirección es ${url}` : ""}
      </span>
    </>
  );
}

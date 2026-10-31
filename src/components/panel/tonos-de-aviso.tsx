"use client";

import { useEffect } from "react";
import { toneOrDefault } from "@/lib/sala/tonos";
import { setAlertTones } from "./sonido-llamados";

/**
 * Fija los tonos de aviso del local (ficha tonos-de-aviso) para los sonidos de esta pantalla. No dibuja nada; lo renderiza
 * el layout de cada área, así que cada carga de panel, sala o cocina arranca con lo que el Dueño eligió.
 */
export function TonosDeAviso({ call, ready }: { call: string; ready: string }) {
  useEffect(() => {
    setAlertTones({ call: toneOrDefault(call, "call"), ready: toneOrDefault(ready, "ready") });
  }, [call, ready]);
  return null;
}

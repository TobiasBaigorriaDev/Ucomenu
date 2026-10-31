"use client";

import { useEffect } from "react";
import { toneOrDefault } from "@/lib/sala/tonos";
import { vibrationOrDefault } from "@/lib/sala/vibracion";
import { setAlertTones, setAlertVibration } from "./sonido-llamados";

/**
 * Fija los tonos y la vibración de aviso del local (fichas tonos-de-aviso y vibracion-de-aviso) para esta pantalla. No dibuja
 * nada; lo renderiza el layout de cada área, así que cada carga de panel, sala o cocina arranca con lo que el Dueño eligió.
 */
export function TonosDeAviso({ call, ready, vibration }: { call: string; ready: string; vibration: string }) {
  useEffect(() => {
    setAlertTones({ call: toneOrDefault(call, "call"), ready: toneOrDefault(ready, "ready") });
    setAlertVibration(vibrationOrDefault(vibration));
  }, [call, ready, vibration]);
  return null;
}

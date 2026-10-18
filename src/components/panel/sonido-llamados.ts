"use client";

import { useSyncExternalStore } from "react";
import { createBeeper, type Beeper } from "@/lib/sala/beep";

/**
 * Sonido de los llamados, compartido por la sala en vivo y el panel (ficha aviso-push-desde-el-panel). Vive a nivel de
 * módulo, no de pantalla: al salir de la sala hacia otra pantalla del panel (navegación sin recargar) el audio ya
 * desbloqueado se conserva y el cartel del panel sigue haciendo sonar los llamados nuevos. Al RECARGAR la página el
 * navegador vuelve a exigir un gesto: si la persona lo había dejado activado, se vuelve a armar con su primer toque o tecla.
 */
export type SoundState = "off" | "on" | "blocked";

const PREFERENCE_KEY = "ucomenu:sala:alertas";

let state: SoundState = "off";
let beeper: Beeper | null = null;
let arming = false;
const listeners = new Set<() => void>();

function set(next: SoundState) {
  if (next === state) return;
  state = next;
  for (const listener of listeners) listener();
}

export function rememberedAlerts(): boolean {
  try {
    return window.localStorage.getItem(PREFERENCE_KEY) === "1";
  } catch {
    return false;
  }
}

function remember(on: boolean) {
  try {
    window.localStorage.setItem(PREFERENCE_KEY, on ? "1" : "0");
  } catch {
    // Sin almacenamiento (ventana privada, bloqueado): la preferencia simplemente no se recuerda.
  }
}

/** Desbloquea el audio (hay que llamarla desde un toque) y lo deja activado. `confirm` hace sonar un pitido de prueba. */
export async function activateSound(confirm = true): Promise<boolean> {
  beeper ??= createBeeper();
  const unlocked = await beeper.unlock();
  if (!unlocked) {
    set("blocked");
    return false;
  }
  set("on");
  remember(true);
  if (confirm) beeper.beep();
  return true;
}

export function silenceSound() {
  set("off");
  remember(false);
}

/** Un doble pitido si el sonido está activado. */
export function beepIfOn() {
  if (state === "on") beeper?.beep();
}

/**
 * Tras recargar, si la persona había dejado el sonido activado, lo vuelve a armar con su primer toque o tecla (el navegador
 * no deja sonar sin un gesto). Una sola vez por carga; si ya está activado o lo silenció, no hace nada.
 */
export function armSoundOnFirstGesture() {
  if (arming || state !== "off" || !rememberedAlerts()) return;
  arming = true;
  const events = ["pointerdown", "keydown"] as const;
  const onGesture = () => {
    for (const name of events) document.removeEventListener(name, onGesture, true);
    arming = false;
    if (state === "off" && rememberedAlerts()) void activateSound(false);
  };
  for (const name of events) document.addEventListener(name, onGesture, true);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useSoundState(): SoundState {
  return useSyncExternalStore(subscribe, () => state, () => "off");
}

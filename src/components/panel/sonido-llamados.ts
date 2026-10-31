"use client";

import { useSyncExternalStore } from "react";
import { createBeeper, type Beeper } from "@/lib/sala/beep";
import { DEFAULT_TONES, type AlertTones, type ToneId } from "@/lib/sala/tonos";
import { DEFAULT_VIBRATION, vibrationPattern, type VibrationEvent, type VibrationLevel } from "@/lib/sala/vibracion";

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
let tones: AlertTones = { ...DEFAULT_TONES };
let vibration: VibrationLevel = DEFAULT_VIBRATION;
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

/** Desbloquea el audio (hay que llamarla desde un toque) y lo deja activado. `confirm` reproduce el aviso de prueba. */
export async function activateSound(confirm = true): Promise<boolean> {
  beeper ??= createBeeper();
  const unlocked = await beeper.unlock();
  if (!unlocked) {
    set("blocked");
    return false;
  }
  set("on");
  remember(true);
  if (confirm) beeper.beep(tones.call);
  return true;
}

export function silenceSound() {
  beeper?.stop();
  set("off");
  remember(false);
}

/** Los tonos que eligió el Dueño para el local (ficha tonos-de-aviso); los fija el layout en cada carga. */
export function setAlertTones(next: AlertTones) {
  tones = next;
}

/** La intensidad de vibración que eligió el Dueño (ficha vibracion-de-aviso); la fija el layout en cada carga. */
export function setAlertVibration(next: VibrationLevel) {
  vibration = next;
}

/** Hace vibrar el dispositivo con un patrón. `false` si el navegador no sabe vibrar (iPhone, escritorio) o el patrón está vacío. */
export function vibrateNow(pattern: number[]): boolean {
  try {
    if (pattern.length === 0 || typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return false;
    return navigator.vibrate(pattern);
  } catch {
    return false;
  }
}

/** Prueba un nivel de vibración con el patrón de un llamado al mozo (el Dueño lo toca para sentirlo). */
export const previewVibration = (level: VibrationLevel) => vibrateNow(vibrationPattern(level, "waiter"));

/**
 * Avisa si el sonido está activado: suena el tono y vibra el celular con la intensidad elegida. `notification` es un llamado
 * de mesa (y un plato nuevo en cocina) y `ready` un pedido terminado; cada uno suena con el tono que eligió el Dueño.
 * `kind` distingue «Pedir la cuenta» (`bill`) de «Llamar al mozo» (`waiter`): vibran distinto para reconocerlos sin mirar.
 */
export function beepIfOn(event: "notification" | "ready" = "notification", kind: "waiter" | "bill" = "waiter") {
  if (state !== "on") return;
  beeper?.beep(event === "ready" ? tones.ready : tones.call);
  const shape: VibrationEvent = event === "ready" ? "ready" : kind;
  vibrateNow(vibrationPattern(vibration, shape));
}

/** Escucha un tono sin activar los avisos (el Dueño lo prueba al elegirlo). Hay que llamarla desde un toque. */
export async function previewTone(id: ToneId): Promise<boolean> {
  beeper ??= createBeeper();
  if (!(await beeper.unlock())) return false;
  beeper.beep(id);
  return true;
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

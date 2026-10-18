/**
 * Detección de iPhone y iPad para el aviso con la app cerrada (ficha aviso-push-iphone). Apple solo entrega Web Push a una
 * app web INSTALADA en la pantalla de inicio (iOS/iPadOS 16.4 o superior): en una pestaña de Safari no existe `PushManager`.
 * Puro: se prueba en `push.test.ts`. El resto del navegador se detecta por funciones (`serviceWorker`, `PushManager`), no por UA.
 */

/** iPhone, iPod y iPad. El iPadOS reciente se presenta como «Macintosh»: se lo reconoce por la pantalla táctil. */
export function isAppleMobile(userAgent: string, maxTouchPoints: number): boolean {
  if (/\b(iPhone|iPad|iPod)\b/.test(userAgent)) return true;
  return /\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1;
}

/** ¿Corre como app instalada? `navigator.standalone` es de Safari; `display-mode` es el estándar. */
export function isInstalledApp(standaloneFlag: boolean | undefined, displayModeStandalone: boolean): boolean {
  return standaloneFlag === true || displayModeStandalone;
}

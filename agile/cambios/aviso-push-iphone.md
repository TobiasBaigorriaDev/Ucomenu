# Cambio: Aviso de llamados en iPhone y iPad (la sala como app instalada)
Estado: implementado y probado en local; falta probarlo en un iPhone real (instalar la app desde staging) y la integración a `main`
Nivel: M (no cambia autorización, esquema, permisos ni el envío por la API; suma un manifiesto, íconos, instrucciones en pantalla y una regla del *service worker* para Apple. La lista de destinos ya incluye `*.push.apple.com`)

## Objetivo
Que el personal con iPhone o iPad (iOS/iPadOS 16.4 o superior) reciba el aviso de llamados con la app cerrada. Apple solo lo permite si el sitio está **instalado en la pantalla de inicio** como app web: hace falta un manifiesto, íconos y que la persona sepa cómo instalarla. Se parte del aviso con la pestaña cerrada ([ADR 0020](../../docs/decisiones/0020-aviso-de-llamados-por-web-push.md)); no se cambia su diseño.

## Reglas de Apple que condicionan el diseño (fuentes: webkit.org, «Web Push for Web Apps on iOS and iPadOS» y «Meet Web Push»)
- Solo funciona desde la app instalada (manifiesto con `display: standalone`), nunca desde una pestaña de Safari: ahí `PushManager` no existe.
- El permiso y la suscripción se piden desde un toque de la persona, dentro de la app instalada.
- **Cada push debe terminar en una notificación visible** («la API de Web Push no es una invitación a trabajar en segundo plano»; si se rompe la promesa, la suscripción se **revoca**). Hoy el *service worker* NO muestra el aviso si la sala o el panel están a la vista y con foco: en Apple eso arriesga perder la suscripción.
- Los destinos son `*.push.apple.com` (ya permitidos en la base y en el servidor).

## Decisiones
- **Manifiesto solo para el personal:** `public/sala.webmanifest`, enlazado desde los *layouts* de `/sala` y `/panel` (no desde la carta pública ni el login), con `start_url: /sala`, `scope: /` (el panel y la sala quedan dentro de la app), `display: standalone`. Íconos PNG 192/512 (+ 512 *maskable*) y `apple-touch-icon` de 180, generados desde la marca de UcoMenu con `tools/generar-iconos.mjs` (sin dependencias nuevas: usa Playwright).
- **Instrucciones en pantalla, no una página aparte:** en el bloque «avisarme…» (sala y Resumen del panel) un estado nuevo `install`: iPhone/iPad (también iPadOS, que se presenta como Mac) en una pestaña de Safari. Explica los pasos: Compartir → «Agregar a pantalla de inicio» → abrir desde el ícono y activar ahí. Sin botón de activar (no serviría). Si ya es la app instalada y aun así no hay `PushManager`, el mensaje pide iOS 16.4 o superior.
- **Apple siempre muestra:** en el *service worker*, si la suscripción es de `push.apple.com`, el aviso se muestra aunque la sala o el panel estén a la vista (un aviso repetido es mejor que una suscripción revocada). El resto (Chrome, Edge, Firefox) no cambia.
- **Android:** al estar el manifiesto, Chrome puede ofrecer instalar la app; es opcional y no cambia el aviso.

## Aceptación
- [x] `/sala` y `/panel` enlazan el manifiesto y el `apple-touch-icon`; la carta pública, el login y `/t/{token}` no. El manifiesto es JSON válido y los íconos responden como PNG.
- [x] En un iPhone/iPad en Safari (sin instalar) el bloque explica cómo instalar la app y no ofrece un botón que no funcione; ya instalada, ofrece activar como en el resto.
- [x] En iOS/iPadOS sin soporte (anterior a 16.4) el mensaje lo dice.
- [x] Con suscripción de `push.apple.com` el *service worker* muestra siempre el aviso; con la de Chrome sigue sin duplicar.
- [x] Sin regresiones en la sala y el panel (pruebas del aviso, del cartel y del sonido).
- [ ] Probado en un iPhone real con la app instalada desde staging (**requiere al usuario**).

## Fuera de alcance
- App nativa, *badge* en el ícono y avisos de otros eventos; pantalla propia de «cómo instalar» fuera del bloque; sonido propio.

## Evidencia
Ejecutado el 2026-10-18 sobre la rama `feat/aviso-iphone` (base local en seed):
- `pnpm typecheck` OK · `pnpm lint` OK · `pnpm build` OK · `pnpm test` **555/555** (nuevas: detección de iPhone/iPad e instalada en `push.test.ts`; *service worker* con suscripción de Apple —muestra aunque la sala esté a la vista, también con `push.apple.com` sin subdominio—, host que solo se parece al de Apple y falla al leer la suscripción en `sala-sw.test.ts`). **Mutación:** con la defensa de Apple anulada (`true &&` en lugar de `!apple &&`) fallan 2 pruebas; restaurada, pasan.
- `playwright test e2e/aviso-iphone.spec.ts --workers=1`: **5/5** (la sala y el panel —y sus pantallas de entrada— enlazan el manifiesto y el `apple-touch-icon`, el login y la mesa no; el manifiesto es válido y los íconos responden PNG; Safari de iPhone sin instalar: instrucciones en la sala y en el Resumen, sin botón y sin desborde a 390 px; app instalada sin `PushManager`: pide iOS 16.4; app instalada con Push: activa como en el resto).
- Regresión con `--workers=1`: `sala`, `sala-push`, `panel-push` y `panel-llamados-aviso` **38/38**.
- Íconos: `tools/generar-iconos.mjs` (Playwright, sin dependencias nuevas) → `public/icons/` (192, 512, 512 *maskable*, 180 de Apple); revisada la imagen de 512.
- Fuentes de las reglas de Apple: webkit.org «Web Push for Web Apps on iOS and iPadOS» y «Meet Web Push».
- **No ejecutado / no verificable acá:** un iPhone real: instalar la app, el permiso, la suscripción a `push.apple.com`, el aviso con la app cerrada, que `clients.openWindow` abra la app al tocar el aviso y que Apple acepte el contacto VAPID del entorno. Tampoco se comprobó que Apple no exija más (p. ej. que el `VAPID_SUBJECT` de staging sea aceptado): **lo prueba el usuario con un iPhone contra staging.**

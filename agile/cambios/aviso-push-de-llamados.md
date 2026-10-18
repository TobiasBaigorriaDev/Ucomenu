# Cambio: Aviso de llamados con la pestaña cerrada (Web Push, Android y Windows)
Estado: en curso — implementado y probado en local; falta la revisión independiente (Codex), la prueba del usuario en sus dispositivos y la aprobación humana (C)
Nivel: C (envía a servicios externos a partir de datos que registra el cliente —SSRF—, guarda secretos por dispositivo y decide quién se entera de qué local: exposición de información entre organizaciones y autorización)

## Objetivo
Que el personal reciba una notificación del sistema cuando alguien llama al mozo o pide la cuenta **aunque haya cerrado la pestaña de la sala o salido de Chrome**. Ver [ADR 0020](../../docs/decisiones/0020-aviso-de-llamados-por-web-push.md).

## Decisiones
- *(usuario, 2026-10-17)* Primero Android y Windows. El aviso desde el panel y iPhone son ítems aparte del tablero. *(usuario, 2026-10-18)* Instalar `web-push`.
- **Registro por local y dispositivo** (no «por sucursal»: la sala y la membresía son por organización).
- **Sin tabla legible:** `push_subscriptions` no da ningún permiso (ni a `service_role`); todo por funciones `SECURITY DEFINER`. Detalle en el ADR.
- **El texto del aviso:** título = tipo («Llama al mozo» / «Pide la cuenta»), cuerpo = mesa (+ sucursal si hay varias), toca → `/sala/{slug}`. Una notificación por mesa y tipo (`tag`), que no se cierra sola (`requireInteraction`).
- **Pantalla:** un bloque debajo de «Activar alertas» en `/sala/{slug}`: «Avisarme aunque cierre la sala» → «Avisos activados en este dispositivo» + «Desactivar avisos». Solo se muestra si el servidor tiene `VAPID_PUBLIC_KEY`. El estado se pregunta al servidor (no solo al navegador).
- **Service worker** `public/sala-sw.js` con alcance `/sala/`, sin caché ni `fetch`. Trata el contenido como no confiable (solo rutas `/sala/...`, textos acotados).

## Aceptación
- [x] Con la sala cerrada y un llamado nuevo, el dispositivo suscrito muestra la notificación con el tipo y la mesa (probado con Chrome real, ver Evidencia).
- [x] Solo un miembro del local registra su dispositivo, con plan y cuenta al día; otro local, `anon` o plan Básico/suspendida: «no disponible» y no queda nada.
- [x] Nadie lee ni escribe `push_subscriptions` por la API (ni `service_role`); `unregister` y `registered` solo ven lo propio.
- [x] Direcciones fuera de FCM/WNS/Mozilla/Apple (http, otros hosts, IP internas, credenciales en la URL, puertos, barra invertida, sufijos engañosos) se rechazan en la base y otra vez antes de enviar.
- [x] Quitar la membresía o la cuenta borra las suscripciones; un llamado solo avisa a los dispositivos de **ese** local y de miembros actuales.
- [x] `push_targets_for_call` solo la ejecuta `service_role`, solo con un pendiente de menos de 2 minutos de esa mesa y tipo, y no devuelve ids.
- [x] Si el envío falla (404/410 se borra; otros códigos o red se registran sin direcciones) el llamado y el sondeo no se ven afectados.
- [x] Con la sala a la vista y con foco no se duplica la notificación; oculta, sin foco o de otro local, sí.
- [x] Desactivar quita el dispositivo de ese local; **Salir** lo suelta de todos.
- [x] Sin claves VAPID el aviso queda apagado y la pantalla no lo ofrece; `pnpm prod:check` avisa o marca error si están a medias.
- [x] 390 px sin desborde; el botón es de 44 px como el resto.

## Fuera de alcance
- Aviso desde `/panel` (ítem propio), iPhone/PWA (ítem propio), purga programada de suscripciones muertas, sonido o vibración propios, avisos de otros eventos.

## Evidencia
Ejecutado el 2026-10-18 sobre la rama `feat/aviso-push-de-llamados` (base local reseteada con la migración `20261025100000`):
- `pnpm typecheck` OK · `pnpm lint` OK · `pnpm build` OK.
- `pnpm test` **537/537** con el árbol confirmado (nuevas: `src/lib/push` —destinos permitidos, suscripción, texto, claves VAPID, envío con doble: éxito, 404/410, destino fuera de la lista, sin destinatarios, nunca lanza, sin direcciones en el log—, `tests/unit/sala-sw.test.ts` —el service worker en un contexto aislado— y `verificar-produccion` extendido). Con cambios sin confirmar en `.env.example`, `revision-codex.test.ts › --uncommitted --dry-run omite los secretos` falla (el diff de la plantilla trae la línea vacía `SUPABASE_SERVICE_ROLE_KEY=` de contexto); con el árbol limpio pasa.
- `pnpm test:rls` completo **679/679** (29 archivos). `push.rls.test.ts`: **33/33** (tabla cerrada, registro, SSRF por la API y por SQL directo, claves mal formadas, tope, cambio de cuenta, estado y baja propios, baja de membresía/cuenta, destinos por local, ventana de 2 minutos, mesa/sucursal/organización inactivas, plan y mora, tokens inválidos, limpieza). `acl.rls.test.ts` **18/18** con las funciones y la tabla nuevas.
- **Mutaciones sobre las funciones de base: 12 defensas rotas de a una, 12 detectadas** (registrar sin plan; sin ser miembro; sin pasar el dispositivo a quien lo usa; sin tope; sin lista de hosts en la función; quitar dispositivos ajenos; estado visible para otros; destinos de otros locales; sin ventana de 2 minutos; avisar un llamado ya atendido; avisar sin plan; avisar de una sucursal inactiva).
- `pnpm exec playwright test e2e/sala-push.spec.ts`: **6/6** (activar con permiso y que sobreviva a recargar; Dueño y por-local; permiso bloqueado; navegador sin Push; plan Básico sin el bloque; Salir suelta el dispositivo). El servicio de push se sustituye por un doble; el servidor de pruebas recibe solo una clave pública de pruebas y nunca la privada.
- **Prueba con Chrome real (instalado en la máquina del desarrollo), HTTP local, claves VAPID efímeras:** el Staff activa el aviso (suscripción real a FCM), se cierra la pestaña, el «comensal» llama desde `/t/{token}` y el service worker deja la notificación `Llama al mozo | Mesa 9` (`registration.getNotifications()`), pasando por `after()` → `web-push` → FCM → Chrome. Se repitió: **2 corridas completas OK** (más 3 envíos directos con 201 recibidos). Otras corridas fallaron **por el entorno automatizado** (el Chrome de Playwright con perfil nuevo a veces no consigue suscribirse, o FCM responde 410 a un token recién creado); en ese caso la pantalla muestra «El navegador no pudo activar el aviso…» (tiempo máximo de 20 s) y, si es el envío, la suscripción se borra sola. Es un riesgo conocido de ese tipo de prueba, no se automatiza en la suite.
- **E2E completo** (`pnpm build` + `playwright test`): con todos los *workers* y con 3, el servidor de pruebas de esta máquina cayó bajo carga (fallos de login que pasan de a uno; inestabilidad de Windows ya registrada en `ahora.md`). Con `--workers=2`: **260 pasaron, 1 omitida, 3 fallaron por tiempo** (`branch-slugs:71`, `carta:164`, `carta:329`) y **las 3 pasan al repetirlas solas**. Total sin fallos reales: 263 + 1 omitida.
- **No ejecutado:** prueba en un Android y en la PC del salón con el servidor desplegado (HTTPS, staging); Edge/WNS y Firefox reales.

## (C) Invariantes
1. Un dispositivo solo recibe avisos de un local si hay una suscripción **vigente de un miembro actual** de ese local (FK compuesta a `memberships`; el envío no mira más que esa tabla y la organización de la mesa).
2. Nadie —ni el Dueño, ni `service_role` por la API— lee `endpoint`/claves; los destinos solo salen por `push_targets_for_call` hacia el servidor, y solo por un llamado pendiente reciente.
3. El servidor nunca hace un POST a un host fuera de la lista (base + servidor).
4. El aviso no contiene ids ni datos del comensal y nunca bloquea ni cambia el resultado del llamado.
5. Un fallo del push no deja de dar el aviso por sondeo: el push no es la fuente de verdad.

## (C) Fallos y recuperación
- **Servicio de push caído o lento:** cada envío tiene 8 s de tope y TTL de 2 minutos; los fallos se cuentan en el log (códigos, sin direcciones). El comensal no espera (`after()`).
- **404/410:** `drop_push_subscriptions` borra esas filas; el dispositivo ve «activar» en su próxima visita (el estado sale del servidor).
- **Claves VAPID rotadas o faltantes:** sin las tres variables no se envía y la pantalla no ofrece el aviso; cambiar el par invalida las suscripciones (envían 403/410 y se limpian) y cada dispositivo vuelve a activar. `pnpm prod:check` marca las claves a medias.
- **Rollback:** `git revert` de la rama y, en una base con datos, los `drop` del comentario inicial de la migración (solo se pierden suscripciones). La pantalla vuelve a ser la de antes.
- **Suscripciones huérfanas** (dispositivo que desaparece): quedan hasta el próximo 404/410; sin purga programada (anotado en el ADR).

## (C) Revisión y aprobación
- Revisión independiente (Codex, una ronda, solo lectura): pendiente.
- Aprobación humana (despliegue a staging con las claves VAPID de staging y prueba en dispositivos reales): pendiente.

## Aprendizajes
- Chromium sin interfaz informa `Notification.permission = "denied"` aunque se haya concedido: las pruebas lo sustituyen por un doble con el ciclo real.
- Playwright evalúa su configuración en cada proceso: generar claves en el archivo de configuración da un par distinto al servidor y a los *workers* (el 403 de FCM de las primeras pruebas reales venía de ahí).
- `pushManager.subscribe` puede no responder nunca (sin conexión con el servicio de push): se corta a los 20 s y se explica en pantalla.

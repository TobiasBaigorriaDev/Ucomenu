# 0020 — Aviso de llamados con la pestaña cerrada: Web Push desde el servidor

- Estado: aceptada
- Fecha: 2026-10-18

## Contexto
El panel de sala (ADR 0011) se entera de los llamados por sondeo, y el sondeo vive dentro de la pestaña: si el personal la cierra o sale de Chrome, no llega ningún aviso. El ADR 0011 lo dejó como limitación aceptada («se recomienda un dispositivo dedicado»). En producción resultó insuficiente: el personal cierra la sala.

## Decisión
*(El usuario pidió el incremento el 2026-10-17: Android y Windows primero; iPhone y el aviso desde el panel, después.)*
1. **Web Push estándar** (service worker + Push API + VAPID). El navegador de cada dispositivo se suscribe; cuando se crea un llamado, **el servidor** cifra y envía el aviso al servicio de push del navegador (FCM en Chrome/Android, WNS en Edge, Mozilla, Apple). Sin cliente de Supabase en el navegador: sigue vigente el ADR 0007.
2. **El sondeo no cambia y sigue siendo la fuente de verdad.** El push es solo un aviso: si falla o no llega, la sala se entera igual al abrirse. Nada de lo que decide el negocio (atender, vencer a los 30 minutos) depende del push.
3. **Las suscripciones son un secreto sin acceso por la API** (`push_subscriptions`, sin permisos para `anon`, `authenticated` ni `service_role`). Se escriben y leen solo con funciones de base: un miembro registra y quita **las suyas** (`auth.uid()`), con el plan y la cuenta al día y solo hacia servicios de push conocidos; el servidor obtiene los destinos con `push_targets_for_call`, que exige un llamado pendiente de menos de 2 minutos de esa mesa. Una clave foránea compuesta a `memberships` borra las suscripciones de quien deja el local.
4. **Anti-SSRF:** el servidor hace un POST a una dirección que registró un cliente. Solo se aceptan `https` y los hosts de FCM, WNS, Mozilla y Apple, validados **en la base** (restricción `CHECK` + la función de registro) y **otra vez en el servidor antes de cada envío**.
5. **`service_role` en una ruta pública, acotado:** el aviso sale de `after()` en la acción pública del comensal, que no tiene sesión. Usa la clave de servicio **solo** para `push_targets_for_call` y `drop_push_subscriptions` (EXECUTE solo para `service_role`; validan adentro y no devuelven ids de mesa ni de organización). La escritura del llamado sigue entrando con `anon` (ADR 0010).
6. **Por local y por dispositivo:** la suscripción del navegador es una por dispositivo, pero se registra por local; activarla en un local no la activa en otro. Tope de 10 dispositivos por persona y local.
7. **No duplicar:** si esa sala está a la vista **y con foco**, el service worker no muestra la notificación (ya suena sola). En cualquier otro caso la muestra: mejor un aviso repetido que uno perdido.
8. **Cerrar sesión suelta el dispositivo** (baja en el servidor y `unsubscribe()` del navegador). Si falla, la base ya no manda nada a quien deja de ser miembro.
9. **Claves VAPID por entorno**, en variables de servidor (`VAPID_PRIVATE_KEY` es un secreto; la pública llega a la pantalla en tiempo de ejecución, no se incrusta al construir). Sin ellas el aviso queda apagado y la pantalla no lo ofrece. `pnpm push:claves` las genera.

## Alternativas consideradas
- **Supabase Realtime** — no resuelve el problema: sigue necesitando una pestaña abierta.
- **Notificaciones locales desde la pestaña** — mueren con la pestaña.
- **App nativa o PWA instalada solamente** — exige instalación; Web Push funciona desde el navegador en Android y escritorio.
- **Llamar al servicio de push desde un trigger de base** (`pg_net`/Edge Function) — no está en el Supabase local del proyecto y esconde la lógica de envío; el servidor ya procesa la acción del comensal.
- **Escribir el cifrado RFC 8291 a mano** — se descartó por no mantener criptografía propia; se usa `web-push` (aprobado por el usuario el 2026-10-18).

## Consecuencias
- **Límites del navegador, no del código:** en Windows el aviso solo llega si Chrome/Edge siguen en ejecución (en segundo plano; con «Seguir ejecutando aplicaciones en segundo plano» activo, que es lo habitual); en Android llega aunque Chrome esté cerrado. **iPhone** exige instalar la sala como PWA (iOS 16.4+): queda como ítem aparte.
- **Latencia** de segundos y de entrega no garantizada (el servicio de push puede demorar o descartar; el aviso lleva TTL de 2 minutos para no llegar tarde). El sondeo cubre el hueco.
- **Una dependencia nueva de producción** (`web-push` 3.6.7, con sus sub-dependencias) y un secreto nuevo por entorno (cambiarlo invalida las suscripciones: cada dispositivo vuelve a activar el aviso).
- **El texto del aviso** (tipo, mesa y, con varias sucursales, cuál) viaja cifrado de punta a punta; los servicios de push ven solo el destino y el tamaño.
- Una suscripción que el servicio de push da por muerta (404/410) se borra sola al enviar. Un dispositivo que desaparece sin avisar queda registrado hasta entonces (sin costo salvo un envío fallido por llamado); no hay purga programada.
- Quien sume otro aviso «con la app cerrada» debe seguir este patrón: suscripciones solo por funciones, destinos filtrados por membresía actual y lista cerrada de hosts de push.

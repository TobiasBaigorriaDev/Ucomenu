# Cambio: Likes anónimos desde la mesa
Estado: **implementado y verificado en local** (2026-10-22); falta la revisión independiente y la aprobación del usuario para subir y desplegar (la migración `20261114100000` no está en staging). Sigue al [feed de videos](feed-de-videos.md); los comentarios (ítem siguiente del tablero) reutilizan la entrada por la mesa que prueba este.
Nivel: **C** — abre una **escritura pública anónima** (`anon` → función de base), la condiciona al plan Premium y a la mora (dinero) y guarda un identificador pseudónimo del comensal en su dispositivo y en la base (exposición de datos personales).

## Objetivo
Que quien está en una mesa pueda marcar «me gusta» en un video del feed, una vez por dispositivo y video y sin dejar ningún dato que lo identifique, y que el feed muestre el conteo a todos. Reglas de producto: `docs/producto.md`, «Feed de videos cortos»; decisión: [ADR 0031](../../docs/decisiones/0031-feed-de-videos-cortos.md) (enmienda de esta ficha).

## Decisiones (particulares de esta ficha; revisables)
1. **Una sola puerta de escritura**: `public.set_video_like(p_token, p_video, p_liked, p_device, p_rate, p_visit_started_at)` (`SECURITY DEFINER`, como `create_waiter_call`). `anon` no escribe en ninguna tabla; `video_likes` no tiene permisos ni políticas para la API. La *server action* valida el formato y el **ticket de visita** (3 horas) antes de llegar a la base; la base valida todo lo demás.
2. **Por intención, no por alternancia**: `p_liked = true` pone el like (si ya estaba, no hace nada) y `false` lo quita. Repetir un pedido no cambia el resultado: sirve ante reintentos y dispositivos con el almacenamiento borrado.
3. **«Dispositivo» = un código aleatorio de 128 bits que el navegador guarda al primer toque en «me gusta»** (`localStorage`), con la lista de videos que ya marcó (para pintar el corazón al volver). **Aprobado por el usuario (2026-10-22)** frente a «un like por mesa» e «IP + navegador»: el Wi‑Fi del local comparte la IP, así que nada derivado de la conexión distingue a los comensales. El código viaja a la *server action*, que guarda solo su HMAC (`device_key`, 32 hex, con el secreto del servidor y un prefijo propio): el código crudo no llega a la base. Borrar los datos del sitio o cambiar de navegador permite votar otra vez (aceptado: es un contador, no una elección). Si el navegador no deja guardar, el código vive en memoria hasta cerrar la página.
4. **Cambia la promesa de `/privacidad`** («la carta no guarda información en tu dispositivo»): se reescribe para decir que *solo si tocás «me gusta»* se guarda un código aleatorio y los videos marcados. El resto de la carta sigue sin guardar nada. La revisión legal de los textos sigue siendo el ítem S «textos legales».
5. **Conteo denormalizado**: `menu_videos.like_count` (entero ≥ 0), mantenido por un *trigger* sobre `video_likes` (alta suma, baja resta). `anon` lo lee como columna pública del feed; Dueño y Staff no pueden escribirlo (no está en el permiso de `UPDATE`). Alternativa descartada: dar lectura de `video_likes` (expondría las claves) o contar en cada lectura.
6. **Quién puede dar o quitar un like**: la mesa existe, está activa y su sucursal también (leída con `FOR SHARE`, como el llamado: una desactivación en curso espera); la organización está activa; `has_feature(org, 'video_feed')` **y** `org_can_write(org)` (en solo lectura se apagan los likes, regla de producto; suspendida, nada); el video es de **esa** organización y está publicado y listo. Cualquier otra cosa → `unavailable`, sin decir por qué. Una mesa **silenciada** sí puede dar likes (el silencio es del llamado).
7. **Sesión cerrada** como en el llamado: si el personal atendió «Pedir la cuenta» después de emitido el ticket y pasaron más de 10 minutos, responde `session_closed` (la app muestra «Esta sesión venció»). Se reutiliza el mismo texto.
8. **Límite por cliente**: 60 altas nuevas por `rate_key` (HMAC de la IP con prefijo propio, distinto del `client_key` del llamado para que no se crucen) cada 10 minutos, con `rate_limited` y `retry_after_seconds`. Es alto a propósito: todo un local comparte la IP. Quitar un like no cuenta; un pedido repetido de un like ya puesto tampoco. Sin IP utilizable no hay límite (como el llamado).
9. **El identificador de la IP no se conserva**: `rate_key` se pone en `NULL` pasada 1 hora, de forma oportunista (cada alta limpia hasta 500 filas vencidas de cualquier organización, con `SKIP LOCKED`). No hay tarea programada. Limitación conocida: si nadie da likes en horas, las últimas filas conservan su `rate_key` hasta el próximo like en cualquier local; el valor es un HMAC sin el secreto irreversible y sin relación con ninguna mesa.
10. **Qué NO se guarda**: ni la mesa, ni la sucursal, ni la IP, ni el ticket, ni el navegador. Una fila es (video, organización, `device_key`, `rate_key` temporal, fecha).
11. **Pantalla**: en cada video del feed, un corazón con el conteo en la columna de botones de la derecha. Desde la mesa (`/t/{token}/videos`) es un botón (`aria-pressed`) con respuesta inmediata y vuelve atrás si falla. Sin mesa (`/m/…/videos`), o si la mesa no puede dar likes, es solo el conteo, sin botón y sin aparecer si es 0. La base informa si la mesa puede dar likes (`resolve_table_qr` suma `likes_enabled`), así que la pantalla no ofrece un botón que va a fallar; igual todo se vuelve a verificar en la función.
12. **Textos** en es/en/pt como el resto del feed.

## Aceptación
- [x] Desde la mesa, tocar el corazón suma 1 al conteo y lo deja marcado; volver a tocarlo lo quita. Recargar mantiene el corazón marcado (mismo dispositivo) y el conteo real.
- [x] Dos dispositivos distintos con la **misma IP** suman 2; el mismo dispositivo repetido no pasa de 1 por video.
- [x] Sin mesa (link directo de la carta) el conteo se ve pero no hay botón; con 0 likes no se muestra nada.
- [x] Plan que no es Premium, cuenta en solo lectura o suspendida, mesa o sucursal desactivada, video no publicado o de otra organización: la función responde `unavailable` y no escribe nada.
- [x] Ticket vencido, falso o de otra mesa: la acción responde «Esta sesión venció» sin llegar a la base; sesión cerrada por la cuenta: lo mismo desde la base.
- [x] Más de 60 altas por `rate_key` en 10 minutos: `rate_limited`, y el like no se crea.
- [x] `anon` no puede leer ni escribir `video_likes`, ni escribir `like_count`; Dueño y Staff tampoco.
- [x] `like_count` siempre coincide con las filas de `video_likes` (altas, bajas, borrado del video).
- [x] a 390 px sin desborde (E2E); es/en/pt por prueba unitaria de textos (sin E2E en en/pt); el corazón es un `<button>` nativo (teclado) y no anima, así que `prefers-reduced-motion` no cambia nada.

## Fuera de alcance
Comentarios (ítem siguiente), ver o moderar likes desde el panel, ranking de videos, notificar al local, tarea programada de purga.

## (C) Invariantes
1. Un dispositivo (`device_key`) tiene a lo sumo un like por video.
2. Un like solo existe para un video publicado y listo de una organización con el feed vigente y la cuenta que escribe, y se creó desde una mesa y sucursal activas de **esa** organización.
3. `anon` y `authenticated` no tienen ningún permiso sobre `video_likes`; el único camino de escritura es `set_video_like`.
4. `like_count` = cantidad de filas de `video_likes` del video, siempre.
5. Ningún dato de la mesa ni del comensal queda en la fila; el `rate_key` desaparece a la hora.
6. Plan, mora y baja se evalúan en vivo en cada pedido.

## (C) Fallos y recuperación
| Falla | Resultado |
| --- | --- |
| La base o la red fallan | La acción responde «no disponible»; el corazón vuelve a su estado anterior. Nada que reparar. |
| Dos pedidos simultáneos del mismo dispositivo y video | La clave primaria deja uno; el otro responde igual que si ya estuviera. El conteo sale del *trigger*, así que no se desfasa. |
| El local baja de plan, entra en mora o suspende | Los likes dejan de aceptarse y el conteo deja de verse con el feed; los datos quedan y vuelven con el plan. |
| Se borra el video o la organización | Las filas se borran en cascada. |
| El navegador no guarda el código | El like vale mientras dure la página; al recargar se puede repetir y la base responde «ya estaba» (sin sumar). |
| Se rota `WAITER_CALL_CLIENT_SECRET` | Cambian `device_key` y `rate_key`: cada dispositivo puede volver a votar una vez; los likes ya contados quedan. |

## Evidencia
Local (Supabase local + build de producción en :3100), sobre el árbol de trabajo previo al commit de esta ficha:
- `pnpm test`: 876/876 (nuevas: `likes` —claves, respuesta, llamada a la base—, `likes-local`, acción de servidor con ticket falso/vencido/de otra mesa y mensajes por resultado, `parseResolvedTable`). `pnpm typecheck` y `pnpm lint` en verde; `pnpm build` en verde.
- RLS: `video-likes` 27/27 (alta y baja, un like por dispositivo, misma conexión = 2 likes, concurrencia, `like_count` = filas, disponibilidad por plan/mora/mesa/sucursal/video/organización/baja, sesión cerrada y sus bordes, límite de 60 y su ventana, `rate_key` borrado a la hora, sin permisos directos sobre `video_likes` ni sobre `like_count`, `resolve_table_qr.likes_enabled`). Suite completa: 1067 pruebas, 1066 en verde; la restante (`owner-lectura`, una restricción de `audit_log` que chocó con filas de otros archivos en paralelo) **es ajena** y pasa sola 13/13.
- E2E (`likes-feed`, 5/5 a 390 px): el corazón suma y resta, recuerda el estado al recargar y no guarda nada ni cookies antes del primer toque; dos dispositivos con la misma conexión suman 2 y un código repetido no suma de más; si el servidor falla vuelve atrás y avisa; solo lectura = conteo sin botón; link directo = conteo sin botón y nada con 0. Suite completa: 402 verdes y 1 saltada; 1 falla **ajena** (`videos-mux.spec:145`, un contador compartido del Mux de mentira entre pruebas en paralelo) que pasa sola.
- Mutaciones, todas detectadas por una prueba que falla sin la defensa: sin `org_can_write`, sin `has_feature`, sin sucursal activa, sin mesa activa, video no publicado, video de otra organización, sin sesión cerrada, sin límite por cliente, límite 61, sin limpiar `rate_key`, sin idempotencia del «ya estaba». **Mutante equivalente:** quitar «listo» del video no cambia nada porque el CHECK `menu_videos_check1` ya prohíbe publicar algo no listo.
- No probado: teléfono real (Safari/iOS, Android), Firefox; el feed con varios videos y likes con Mux real; staging (no se subió ni se desplegó nada).

## (C) Revisión y aprobación
(a completar)

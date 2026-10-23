# Cambio: Comentarios con aprobación previa en el feed
Estado: **implementado y verificado en local; pendiente de la revisión independiente de Codex** (2026-10-23). Sin subir a staging. Sigue a los [likes](likes-del-feed.md): reutiliza la entrada por la mesa (`resolve_table_qr`, ticket de visita, claves HMAC, función pública única).
Nivel: **C** — abre una **escritura pública anónima de texto libre** (contenido de un tercero que termina en la carta del local), la condiciona al plan Premium y a la mora (dinero), guarda texto y un alias que pueden contener datos personales (exposición) y agrega una **purga irreversible** de lo rechazado.

## Objetivo
Que quien está en una mesa pueda dejar un comentario (con alias opcional) en un video del feed; que **no se vea** hasta que el Dueño o el Staff lo aprueben desde el panel; y que lo rechazado se borre solo pasado un plazo. Reglas de producto: `docs/producto.md`, «Feed de videos cortos»; decisión: [ADR 0031](../../docs/decisiones/0031-feed-de-videos-cortos.md) (enmienda de esta ficha).

## Decisiones (particulares de esta ficha; revisables)
1. **Una sola puerta de escritura pública**: `public.submit_video_comment(p_token, p_video, p_body, p_alias, p_rate, p_visit_started_at)` (`SECURITY DEFINER`, como `set_video_like`). `anon` no escribe en ninguna tabla; `video_comments` no tiene permisos de escritura para `anon`. La *server action* valida el ticket de visita (3 horas) y el formato antes de llegar a la base; la base valida todo.
2. **Siempre entra «pendiente»**: la fila nace `pending`; el comensal nunca elige el estado. Pendiente y rechazado **no se leen** por la API pública (política: solo `approved` de un video publicado y listo con el feed vigente).
3. **Texto**: comentario de 1 a 280 caracteres y alias opcional de hasta 30 (producto), sin caracteres de control (la acción colapsa los espacios y saltos de línea en uno; la base lo exige con `CHECK`). Se muestra como texto plano (React escapa; no hay enlaces ni formato). Un alias vacío es «sin alias» y se muestra «Anónimo» (según el idioma).
4. **Quién puede comentar** (igual que los likes): mesa y sucursal activas (`FOR SHARE`), organización activa, `has_feature(org, 'video_feed')` **y** `org_can_write(org)` (en solo lectura se apagan los comentarios), video de **esa** organización publicado y listo. Cualquier otra cosa → `unavailable`. Mesa silenciada: sí puede (el silencio es del llamado). **Sesión cerrada** (cuenta atendida hace más de 10 minutos tras emitido el ticket) → `session_closed`, mismo texto que el llamado.
5. **Límite por conexión**: 10 comentarios por `rate_key` (HMAC de la IP con prefijo propio `comment-ip`, distinto del de likes y llamados) cada 10 minutos → `rate_limited` con `retry_after_seconds`. Sin IP utilizable no hay límite (como el llamado). Un reenvío idéntico (mismo video, texto y alias, misma conexión) en 10 minutos responde `ok` sin crear otra fila: sirve ante doble toque y reintentos.
6. **Tope de pendientes**: 100 por organización → `queue_full`. Acota lo que un tercero puede acumular en la base del local; los pendientes de más de 30 días se purgan (decisión 10).
7. **El `rate_key` no se conserva**: pasada 1 hora se pone en `NULL` (oportunista en cada envío, 500 filas con `SKIP LOCKED`, como los likes). No se guarda dispositivo, mesa, sucursal, IP ni ticket: una fila es (video, organización, texto, alias, estado, `rate_key` temporal, fechas). Sin identificador por dispositivo: los comentarios no necesitan «uno por dispositivo» y así no hay nada que guardar en el teléfono.
8. **Moderación** (Dueño y Staff, `is_org_member`): lee todos los comentarios de su organización (sin `rate_key`) y solo puede cambiar `status` entre `approved` y `rejected` (`pending` es solo el inicio). Se puede **retirar** un publicado y **recuperar** un rechazado mientras no se haya purgado. **Aprobar** exige `org_can_write` (en solo lectura no se publica nada nuevo); **rechazar o retirar** nunca se bloquea por mora: contenido ajeno que ya está en la carta tiene que poder sacarse. Un trigger fija `moderated_at` y rechaza cualquier otro cambio de la fila (texto, alias, video).
9. **Conteo público**: `menu_videos.comment_count` (solo aprobados), mantenido por un *trigger* sobre `video_comments`; `anon` lo lee como columna pública del feed, nadie lo escribe por la API. Los comentarios aprobados se leen con una *server action* que pide 20 por página (más nuevos primero) al cliente `anon`; la autoridad de qué se ve es la política de lectura.
10. **Retención** (la decisión que el producto dejó para acá): los **rechazados se borran a los 7 días** de rechazados (piso 1 día) y los **pendientes sin moderar a los 30 días** de enviados (piso 7 días), con `public.purge_video_comments(p_rejected_retention, p_pending_retention, p_batch)` — mismo molde que `purge_waiter_calls` (ADR 0014): por lotes, `SKIP LOCKED`, solo `service_role`, validada sobre la fecha de corte efectiva. Los aprobados no se purgan (viven con el video; si se retira, pasa a rechazado y sigue el plazo). **No se programa** en esta ficha: es infraestructura de producción (`docs/produccion.md`, paso nuevo). Siete días alcanzan para que el local note un rechazo equivocado y lo recupere; más tiempo sería conservar sin necesidad texto de un tercero que el local ya descartó.
11. **Pantalla (mesa)**: en la columna de botones de cada video, un botón de comentarios con el conteo; abre una hoja inferior con la lista de aprobados y, solo desde la mesa con el comentario habilitado (`comments_enabled` de `resolve_table_qr`), el formulario (alias opcional + comentario con contador). Tras enviar: «Gracias. Tu comentario se publicará cuando el local lo apruebe.» Sin mesa: se leen los aprobados, sin formulario; con 0 comentarios y sin mesa el botón no aparece. Las flechas y Escape de la hoja no mueven el feed.
12. **Pantalla (panel)**: `/panel/{slug}/comentarios`, para Dueño y Staff: Pendientes (aprobar o rechazar), Publicados (retirar) y Rechazados (aprobar de nuevo, con el día en que se borran). Cada lista, hasta 50 filas, más nuevas primero.
13. **Textos** en es/en/pt como el resto del feed. Los textos legales (términos y privacidad) son el ítem S aparte del tablero y **bloquean habilitarlo en producción**; no se tocan acá.

## Aceptación
- [ ] Desde la mesa se envía un comentario con y sin alias; queda `pending` y no aparece en la carta ni para `anon`.
- [ ] El Dueño y el Staff lo ven en el panel, lo aprueban y aparece en el feed (y suma 1 a `comment_count`); retirarlo lo saca y resta.
- [ ] Rechazar lo oculta; se puede recuperar; la purga borra los rechazados de más de 7 días y los pendientes de más de 30, nunca los aprobados ni lo más reciente.
- [ ] Comentario vacío, de más de 280 caracteres, alias de más de 30 o con caracteres de control: se rechaza sin escribir.
- [ ] Plan que no es Premium, cuenta en solo lectura o suspendida, mesa o sucursal desactivada, video no publicado o de otra organización: `unavailable`, sin escribir. Ticket vencido o falso, o sesión cerrada: «Esta sesión venció».
- [ ] Más de 10 envíos por conexión en 10 minutos: `rate_limited`; el reenvío idéntico no duplica; más de 100 pendientes: `queue_full`.
- [ ] Otra organización no ve ni modera mis comentarios; `anon` no lee pendientes ni rechazados ni `rate_key`; nadie escribe `comment_count`, texto ni estado `pending` por la API.
- [ ] `comment_count` coincide siempre con los aprobados (aprobar, retirar, recuperar, borrar el video).
- [ ] a 390 px sin desborde; teclado (la hoja se cierra con Escape y no mueve el feed); es/en/pt por prueba unitaria.

## Fuera de alcance
Responder a comentarios, editar o borrar el propio comentario, reportes de comensales, avisos al local de comentarios nuevos (push/contador en el menú), moderación automática, programar la purga, textos legales.

## (C) Invariantes
1. Un comentario solo se **crea** `pending`, desde una mesa y sucursal activas de la organización, para un video publicado y listo de **esa** organización con el feed vigente y la cuenta que escribe.
2. `anon` solo lee comentarios `approved` de videos públicos; nunca lee `rate_key`. `anon` y `authenticated` no insertan ni borran: el único camino de alta es `submit_video_comment`.
3. Un miembro cambia solo `status` y solo en su organización; ningún cambio vuelve a `pending`; el texto, el alias y el video son inmutables (también para `service_role`).
4. Aprobar exige cuenta que escribe; retirar o rechazar no.
5. `comment_count` = cantidad de comentarios `approved` del video, siempre.
6. El `rate_key` desaparece a la hora; ningún dato de la mesa ni del dispositivo queda en la fila.
7. La purga nunca borra un aprobado ni una fila más nueva que el piso, y no la puede ejecutar nadie salvo `service_role`.

## (C) Fallos y recuperación
| Falla | Resultado |
| --- | --- |
| La base o la red fallan al enviar | La acción responde «no disponible»; el formulario conserva el texto para reintentar. No hay nada que reparar. |
| Doble envío / reintento | Un reenvío idéntico en 10 minutos no crea otra fila. |
| El local rechaza por error | Lo recupera desde «Rechazados» dentro de los 7 días. Pasado el plazo se borró (irreversible, sin respaldo; es contenido de un tercero ya descartado). |
| El local baja de plan, entra en mora o suspende | Los envíos se apagan y el feed deja de mostrarse; los datos quedan y vuelven con el plan. Retirar sigue permitido. |
| Se borra el video o la organización | Los comentarios se borran en cascada. |
| La purga no está programada | Pendientes y rechazados se acumulan hasta el tope de 100 pendientes; no hay pérdida, solo retención de más. Programarla es requisito de producción. |
| Se rota `WAITER_CALL_CLIENT_SECRET` | Cambian los `rate_key` nuevos; los comentarios no se afectan. |

## Evidencia
Local (Supabase local + build de producción en :3100), sobre el árbol de trabajo previo al commit:
- `pnpm test`: 903/903 (nuevas: `comentarios` —texto, claves, respuesta, llamada a la base, lectura por páginas—, `comment-action` —ticket, texto normalizado, mensajes por resultado—, `parseResolvedTable`). `pnpm typecheck`, `pnpm lint` y `pnpm build` en verde.
- RLS: `video-comments` 41/41 (nace pendiente, lo que ve `anon`, moderación de Dueño y Staff, aislamiento entre organizaciones, inmutabilidad y «nada vuelve a pendiente», solo lectura y suspendida, disponibilidad en vivo, sesión cerrada, límite por conexión, reenvío, tope de pendientes con altas simultáneas, `rate_key` a la hora, purga y sus pisos, sin permisos directos). Suite completa: 1109/1109 (`acl` y `tables` actualizadas para las funciones y la clave nuevas).
- E2E (`comentarios-feed`, 12/12 a 390 px): envío con alias y estado pendiente sin cookies ni almacenamiento local, aprobar en el panel y verlo en la mesa y en el link directo, retirar y recuperar, límite de 280, teclado dentro de la hoja (las flechas no mueven el feed, Escape cierra la hoja y devuelve el foco), fallo del servidor conserva el texto, reenvío sin duplicar, solo lectura, lectura sin mesa y por páginas, Staff, otro local y solo lectura en el panel. Suite completa: 413 verdes y 1 saltada; 2 fallas **ajenas** (`sala.spec:327`, sondeo lento, y `videos-mux.spec:145`, contador del Mux de mentira) que pasan solas. Una primera corrida completa se cortó a mitad porque el servidor de pruebas dejó de responder (`ERR_CONNECTION_REFUSED`); se repitió una vez.
- Mutaciones (36 sobre `submit_video_comment`, las políticas, los triggers y `purge_video_comments`, aplicadas a la base local y restauradas): **35 detectadas por una prueba que falla sin la defensa** (sin `org_can_write`, sin `has_feature`, sin sucursal ni mesa activa, video no publicado o de otra organización, sin sesión cerrada, límite 11 y sin límite, sin deduplicar, cola 101 y sin cola, sin los dos locks, sin limpiar `rate_key`, largo 281, alias 31, sin control, sin recortar, lectura pública sin estado o sin video público, miembros que leen todo, aprobar sin cuenta, rechazar exigiendo cuenta, sin inmutables, volver a pendiente, `moderated_at` sin fijar, conteo sin baja y contando pendientes, sin `has_feature` en `video_is_public`, purga sin pisos, que borra aprobados, por fecha de envío o sin pendientes). **Sobrevive 1, equivalente:** `using (true)` en la política de moderación (`moderar-cualquier-org`): otra organización sigue sin poder moderar porque `WITH CHECK` exige `is_org_member` y la política de lectura no le deja ver la fila.
- El bloque de `cron` de `docs/produccion.md` (paso 4.b) se ejecutó a mano como `postgres` en la base local (`DO`); `cron.schedule` en sí no (la extensión no está en local).
- No probado: teléfono real (teclado en pantalla de iOS y Android con la hoja abierta), Firefox, Safari de escritorio; staging (no se subió ni se desplegó nada); los textos legales (ítem S aparte): **hasta que existan, no habilitar comentarios en producción**.

## (C) Revisión y aprobación
(pendiente: revisión independiente de Codex)

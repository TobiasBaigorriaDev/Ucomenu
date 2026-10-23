# Cambio: Feed vertical de videos en la carta pública
Estado: **en staging** (Fly + migración, aprobado por el usuario); probado con Chrome real contra Mux; aprobado por Codex en 3 rondas; falta la prueba en Safari/iPhone. Sigue a la [carga y publicación de videos](videos-mux-parte-b.md) (hecha y en staging).
Nivel: **C** — el tablero lo traía como M, pero abre **lectura pública (`anon`)** de una tabla que hasta hoy era privada y la condiciona al plan y a la mora (exposición de información a anónimos y dinero: el feed es de Premium). La parte de pantalla es M.

## Objetivo
Que el comensal vea los videos publicados del local en un feed vertical (un video a la vez, como Reels), entrando desde la carta, sin que la carta pese más ni cargue nada de video hasta que se pide. Reglas de producto: `docs/producto.md`, «Feed de videos cortos»; decisión: [ADR 0031](../../docs/decisiones/0031-feed-de-videos-cortos.md). Quedan fuera: likes y comentarios (necesitan la mesa y el ticket de visita: ítems siguientes).

## Decisiones (particulares de esta ficha; revisables)
1. **Lectura pública por política de base**, no por el servidor: `anon` (y `authenticated`) leen un video solo si `status = 'published'`, `mux_status = 'ready'` y `private.video_feed_visible(organization_id)`, un envoltorio `SECURITY DEFINER` de `has_feature(org, 'video_feed')`: plan Premium y cuenta no suspendida (en **solo lectura se sigue viendo**, regla de producto; **suspendida o dada de baja, no**). Un cambio de plan o de mora lo oculta en el acto: no hay caché de videos.
2. **Columnas públicas mínimas**: `id`, `organization_id`, `product_id`, `title`, `mux_playback_id`, `duration_seconds`, `sort_order`, `created_at`. `anon` no lee `status`, `mux_status`, `mux_error`, `mux_asset_id` ni `mux_upload_id`; `mux_playback_id` es público por diseño (ADR 0031: las URL de reproducción de lo publicado son como las fotos de los platos).
3. **Ruta `/m/{org}/{sucursal}/videos`** (la misma resolución de organización y sucursal que la carta: mismos alias, mismo «no disponible» si la cuenta está suspendida o la sucursal desactivada, mismo 404). Los videos son de la organización y se ven en todas sus sucursales, en el orden `sort_order, created_at`.
4. **La carta no carga nada del feed**: solo suma una consulta en vivo en paralelo (¿hay publicados?) y, si los hay, un enlace «Videos» **sin precarga**. `hls.js` no se baja hasta entrar al feed y solo si el navegador no reproduce HLS nativo (Safari y iOS sí; Chrome y Firefox no).
5. **Reproductor**: `scroll-snap` vertical, un video a la vez, **mudo y en bucle** (el autoplay lo exige), botón de sonido que se recuerda entre videos, toque para pausar/reanudar. Solo se prepara el video visible y el siguiente; los demás muestran el póster de Mux (`thumbnail.jpg`). Con `prefers-reduced-motion: reduce` nada arranca solo: hay un botón de reproducir. Si un video no se puede reproducir, se ve el póster con un aviso, sin romper el feed.
6. **«Ver plato»**: solo si el plato del video **sigue visible en esa sucursal** (la carta ya lo filtra por plato oculto, categoría inactiva y ajustes de sucursal); abre un panel dentro del feed con nombre, precio y descripción, sin salir. Un plato oculto no se revela nunca.
7. **Dependencia nueva, aprobada por el usuario (2026-10-22): `hls.js` 1.7.3** (Apache-2.0, sin dependencias propias), importada de forma dinámica. Se descartó `mux-player` (más pesado y trae analítica propia).
8. **Idiomas**: los textos fijos del feed van en es/en/pt como el resto de la carta; el título de cada video no se traduce.
9. **Sin videos publicados** la ruta muestra un aviso con el enlace a la carta (no un 404: el enlace puede estar guardado).
10. **El feed desde la mesa (agregado 2026-10-22, por la prueba del usuario):** al entrar al feed desde la carta de una mesa (`/t/{token}`) desaparecía el llamado al mozo, porque el feed vivía solo bajo `/m/…`. Ahora existe `/t/{token}/videos`: misma resolución, mismos estados y mismo 404 que `/t/{token}`, y la **misma barra de llamado** (`CallBar`, con un ticket de visita emitido en esa carga). El enlace «Ver videos» de la carta de mesa apunta ahí y «Volver» regresa a la carta de la mesa. El feed termina donde empieza la barra (no la tapa); sin llamado (mesa desactivada o silenciada, plan sin llamados) no hay barra. La pantalla se comparte entre ambas rutas (`FeedScreen`). No cambia lo que lee `anon` ni los permisos.

## Aceptación
- [x] `anon` lee un video solo si está publicado y listo y su organización tiene el feed vigente; nunca borradores, con error, en borrado ni sin procesar; nunca los identificadores internos de Mux ni el estado.
- [x] Bajar de Premium, suspender o dar de baja oculta los videos al instante; en solo lectura siguen viéndose; nada cruza entre organizaciones.
- [x] La carta muestra «Videos» solo con videos publicados y no hace ninguna petición de video, de `hls.js` ni a Mux al cargarse.
- [x] El feed muestra los videos en orden, uno a la vez; solo el visible y el siguiente piden su stream; los otros, solo el póster.
- [x] «Ver plato» aparece solo con un plato visible en esa sucursal y abre su nombre, precio y descripción.
- [x] Desde la mesa, el feed conserva la barra de llamado (llamar al mozo y pedir la cuenta funcionan), no la tapa y «Volver» regresa a la carta de la mesa; sin mesa no hay barra.
- [x] Funciona en es/en/pt, con `prefers-reduced-motion`, a 390 px y por teclado (flechas, espacio, Esc); cuenta suspendida y sucursal desactivada dan el mismo «no disponible» que la carta.
- [ ] Reproducción real comprobada en Safari/iPhone (HLS nativo) y en Chrome (`hls.js`) con un asset de Mux de staging. *(Chrome hecho; falta iPhone.)*

## Fuera de alcance
Likes y comentarios, reordenar videos, subtítulos, estadísticas de reproducción, precarga más agresiva o CDN propio.

## (C) Invariantes
1. Lo que `anon` puede leer de `menu_videos` son solo videos publicados y listos de organizaciones con el feed vigente, con las columnas públicas listadas; nada más.
2. Plan, mora y baja se evalúan en vivo en cada lectura (sin caché de videos): un cambio los oculta de inmediato.
3. Un video se muestra solo en las sucursales de SU organización.
4. Cargar la carta no pide video ni `hls.js` ni nada a Mux.
5. «Ver plato» nunca muestra un plato que la carta de esa sucursal no muestra.

## (C) Fallos y recuperación
| Falla | Resultado |
| --- | --- |
| La base falla al leer los videos | El feed da el error de la ruta (`/m/error`); la carta, que no depende de esto, sigue (si la consulta «¿hay videos?» falla, la carta no muestra el enlace y sigue). |
| Mux o la red fallan al reproducir | El video muestra su póster y un aviso; el resto del feed sigue. |
| Un video pasa a borrador, se borra o se baja el plan mientras se mira | Al recargar desaparece; la reproducción en curso termina de cargar lo que ya pidió. |
| El navegador no soporta HLS ni MSE | Póster con aviso, sin romper la página. |
| Se bloquea el autoplay | Queda el póster con un botón de reproducir. |

## Evidencia
Local (Supabase local + `next dev` en :3200 con los hosts de Mux interceptados), sobre el árbol de trabajo previo al commit de esta ficha:
- `pnpm test`: 855/855. `pnpm typecheck`, `pnpm lint` y `pnpm build` en verde (la ruta `/m/[org]/[branch]/videos` aparece dinámica).
- RLS: `videos-publico` 11/11 (anon solo publicado + listo + feed vigente; columnas; plan, mora, suspensión manual y baja; aislamiento; sin escritura), `acl` 21/21 (el envoltorio `video_feed_visible` entra en la matriz), `videos` y los demás de videos en verde. Se actualizó `videos.rls` (la afirmación «anon no lee nada» pasó a «anon no ve borradores ni el estado»).
- E2E `feed-videos` 9/9 a 390 px: enlace solo con publicados y la carta no pide nada a Mux ni a `hls.js`; Pro/suspendida; orden; solo el visible y el siguiente piden stream; teclado; «Ver plato»; stream caído; `reduced-motion`; sin desborde; vacío y 404. Con ellos pasan 49 E2E vecinos (carta, idiomas, videos, videos-mux) y 64 de carta por sucursal, buscador, ticket, slugs, legal y mesas, salvo 2 de `mesas.spec` **ajenos**: uno espera el puerto 3100 y el otro depende de que la «Mesa 3 (fuera de servicio)» esté inactiva, y en la base local quedó activa.
- Mutaciones, todas detectadas por una prueba que falla sin la defensa: política sin «publicado», sin plan/mora, `video_feed_visible` siempre verdadero, `anon` con `status`/`mux_asset_id`/`mux_error`, `anon` con UPDATE, preparar todos los videos (unitaria y E2E), «¿hay videos?» que lanza, enlace siempre visible, «Ver plato» con plato oculto. **Mutante equivalente:** quitar «listo» de la política no cambia nada porque el CHECK `menu_videos_check1` ya prohíbe publicar algo no listo (defensa en profundidad, no hay prueba que pueda distinguirlos).
- **Staging (2026-10-22, con aprobación del usuario):** migración `20261113100000` aplicada con `db push` y app desplegada en Fly. Con la clave pública, un anónimo lee las columnas públicas del video publicado y recibe `42501` al pedir `status`. Para probar se **publicó el único video** (borrador listo de 4,3 s, «Vhkkk») de `cafe-de-ensayo` (Premium); se despublica desde el panel.
- **Hallazgo de la prueba real (Chrome 155):** el navegador responde «maybe» a `canPlayType` de HLS, descarga el manifiesto y los segmentos, pero el video falla con `MEDIA_ERR_SRC_NOT_SUPPORTED` (el feed mostraba el aviso de error). Corregido: se intenta HLS nativo y, si el video da error, se suelta la fuente y se reintenta con `hls.js`. Regresión E2E (falla sin el fallback, comprobado); `feed-videos` 11/11.
- **Chrome 155 real contra Mux, tras el arreglo:** el video avanza (3,1 s), 480×854, sin error; la carta sola no hace ningún pedido a Mux.
- No probado todavía: Safari/iPhone (HLS nativo) y Firefox.

## (C) Revisión y aprobación
- Ronda 1 (Codex, sobre `737df04`, informe `output/revisiones/2026-10-22T03-53-33-commit-HEAD.md`): aprobar con cambios; un hallazgo **importante**: tras un `NotAllowedError` del arranque solo, el primer toque en «Reproducir» no volvía a llamar a `play()` (el botón desaparecía con el video pausado). Corregido: `play()` se pide dentro del gesto del toque (también lo exige Safari/iOS) y sigue «bloqueado» hasta que el navegador acepte. Regresión E2E «si el navegador bloquea el arranque solo…» (falla sin el arreglo, comprobado). `feed-videos` queda en 10/10.
- Ronda 2 (Codex, verificación sobre `2223b32`, informe `output/revisiones/2026-10-22T03-59-43-commit-HEAD.md`): **APROBAR**, sin hallazgos nuevos; el hallazgo previo queda corregido.
- Ronda 3 (Codex, verificación sobre `5c052c6`, informe `output/revisiones/2026-10-22T04-12-32-commit-HEAD.md`): **APROBAR**, sin hallazgos; cubre el fallback a `hls.js` (ejecución única, cancelación y limpieza al cambiar de video).
- Ronda 4 (Codex, sobre `0a52a84`, el feed bajo `/t/{token}/videos`; informe `output/revisiones/2026-10-23T00-36-40-commit-HEAD.md`): aprobar con cambios; un hallazgo **importante**: la barra de llamado crece al mostrar su confirmación y, con el alto reservado fijo, invadía el pie del video. Corregido midiendo la barra real (`ResizeObserver`); la prueba ahora también comprueba el estado con mensaje (falla sin la medición, comprobado). Ronda 5 (verificación sobre `62b250e`, informe `output/revisiones/2026-10-23T00-42-45-commit-HEAD.md`): **APROBAR**, sin hallazgos.
- Despliegue a staging: aprobado por el usuario el 2026-10-22. Aprobación final del ítem: a la espera de la prueba en iPhone.

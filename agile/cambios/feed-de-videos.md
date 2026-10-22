# Cambio: Feed vertical de videos en la carta pública
Estado: **implementado en local; pendiente revisión independiente, `db push`/despliegue a staging y la prueba con un asset real**. Sigue a la [carga y publicación de videos](videos-mux-parte-b.md) (hecha y en staging).
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

## Aceptación
- [x] `anon` lee un video solo si está publicado y listo y su organización tiene el feed vigente; nunca borradores, con error, en borrado ni sin procesar; nunca los identificadores internos de Mux ni el estado.
- [x] Bajar de Premium, suspender o dar de baja oculta los videos al instante; en solo lectura siguen viéndose; nada cruza entre organizaciones.
- [x] La carta muestra «Videos» solo con videos publicados y no hace ninguna petición de video, de `hls.js` ni a Mux al cargarse.
- [x] El feed muestra los videos en orden, uno a la vez; solo el visible y el siguiente piden su stream; los otros, solo el póster.
- [x] «Ver plato» aparece solo con un plato visible en esa sucursal y abre su nombre, precio y descripción.
- [x] Funciona en es/en/pt, con `prefers-reduced-motion`, a 390 px y por teclado (flechas, espacio, Esc); cuenta suspendida y sucursal desactivada dan el mismo «no disponible» que la carta.
- [ ] Reproducción real comprobada en Safari/iPhone (HLS nativo) y en Chrome (`hls.js`) con un asset de Mux de staging.

## Fuera de alcance
Likes y comentarios, `/t/{token}/videos` (el feed desde la mesa llega con ellos), reordenar videos, subtítulos, estadísticas de reproducción, precarga más agresiva o CDN propio.

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
- No probado todavía: reproducción real en Safari/iPhone y en Chrome (`hls.js`) con un asset de Mux de staging; la migración `20261113100000` no está aplicada en staging.

## (C) Revisión y aprobación
- Ronda 1 (Codex, sobre `737df04`, informe `output/revisiones/2026-10-22T03-53-33-commit-HEAD.md`): aprobar con cambios; un hallazgo **importante**: tras un `NotAllowedError` del arranque solo, el primer toque en «Reproducir» no volvía a llamar a `play()` (el botón desaparecía con el video pausado). Corregido: `play()` se pide dentro del gesto del toque (también lo exige Safari/iOS) y sigue «bloqueado» hasta que el navegador acepte. Regresión E2E «si el navegador bloquea el arranque solo…» (falla sin el arreglo, comprobado). `feed-videos` queda en 10/10.
- Verificación de la corrección: pendiente.
- Aprobación humana del despliegue a staging: pendiente.

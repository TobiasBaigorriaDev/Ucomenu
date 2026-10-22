# Cambio: Videos del feed — base de datos y panel (parte A de «Carga y publicación de videos»)
Estado: **implementado en local; pendiente de la revisión independiente (C) y de la aprobación.** Migración `20261111100000` aplicada solo en la base local. La parte B (Mux real: subida directa, webhook, borrado del asset y prueba en teléfonos) espera las credenciales del usuario.
Nivel: C (autorización: quién crea, publica y borra; dinero: el cupo `videos_published` del plan; exposición: qué columnas de Mux ve cada rol)

## Objetivo
Que el local pueda tener videos en la base con sus reglas de fondo ya cerradas —tabla `menu_videos`, estados, permisos, cupo del plan, pantalla del panel— sin depender todavía de Mux. Mux queda detrás de una interfaz (`src/lib/videos/mux.ts`) y la parte B la conecta. Reglas de producto: `docs/producto.md`, «Feed de videos cortos»; decisión: [ADR 0031](../../docs/decisiones/0031-feed-de-videos-cortos.md).

## Decisiones (particulares de esta ficha; revisables salvo lo marcado)
1. **Una tabla `menu_videos`** (migración `20261111100000_videos_del_feed.sql`): `organization_id`, `product_id` opcional (clave foránea compuesta con la organización; si se borra el plato, el video queda y pierde el enlace), `title` (1–80), `status` (`draft` | `published` | `deleting`), `mux_status` (`awaiting_upload` | `processing` | `ready` | `errored`), `mux_upload_id`, `mux_asset_id`, `mux_playback_id` (únicos), `duration_seconds`, `sort_order`.
2. **Dos dimensiones de estado.** `mux_status` lo escribe solo el servidor (webhook de la parte B); `status` lo elige la persona. Una fila solo puede ser `published` si su `mux_status` es `ready` y `ready` exige asset, playback y duración: son `CHECK`, valen también para `service_role`.
3. **Quién escribe qué (columnas).** Dueño y Staff: crean (`organization_id`, `product_id`, `title`, `sort_order`) y actualizan (`product_id`, `title`, `status`, `sort_order`), con la cuenta al día (`org_can_write`); crear exige además `has_feature('video_feed')`. Los campos de Mux, la duración y `mux_status` no los escribe ninguna cuenta: solo `service_role`. Así nadie apunta su video al `playback_id` de otro local. Leen todo menos `mux_asset_id` y `mux_upload_id` (identificadores internos de administración). **`anon` no accede a nada** hasta el incremento del feed.
4. **Cupo al publicar** (`private.enforce_video_publish`, `BEFORE UPDATE OF status`, bajo un *advisory lock* por organización): pasar a `published` exige `has_feature('video_feed')` (42501 `feature_unavailable:video_feed`) y que los publicados sean menos que `org_limit(org, 'videos_published')` (53400 `limit_exceeded:videos_published`). Despublicar y renombrar no se bloquean por el plan. Bajar de Premium no borra nada (regla de producto).
5. **Tope técnico** de 50 videos por organización contando borradores y los que se están borrando (54000), para que una cuenta no acumule assets sin límite en Mux. *Supuesto nuevo.*
6. **Borrado en dos pasos, para que Mux no quede con huérfanos.** La persona no tiene `DELETE`: pide el borrado poniendo `status = 'deleting'` (estado terminal, no se publica ni cuenta para el cupo). El servidor borra el asset en Mux y recién entonces borra la fila con `service_role`; si Mux falla, la fila queda en `deleting` y la pantalla ofrece reintentar. El borrado de una organización (cascada) no pasa por acá: **la parte B tiene que limpiar los assets antes** (hoy no hay ninguno).
7. **`org_entitlements.usage.videos_published`** cuenta los publicados; el panel muestra «N de M publicados».
8. **Playback `public`.** El `playback_id` se crea público al terminar el procesamiento (parte B): un borrador es invisible porque la aplicación no se lo da a `anon`, pero la URL funciona para quien la tenga. Es lo que permite previsualizar sin firmar. *A confirmar con el usuario en la parte B.*
9. **Duración:** tope en la base 30,5 s (tolerancia de redondeo de Mux sobre los 30 s de la regla de producto). **Peso 50 MB:** Mux no lo informa en el asset, así que no hay columna; se valida en el navegador y en la subida (parte B). *A decidir en la parte B.*
10. **Sin lectura pública todavía y alta por un envoltorio.** La política de alta consulta `private.can_create_video(org)` (miembro + cuenta que escribe + feed en el plan): `has_feature` es interna y no tiene `EXECUTE` para `authenticated`, igual que `can_attend_calls` en la sala. El tope técnico y las transiciones son triggers *invoker*; solo el de publicación es `SECURITY DEFINER` (lee el plan y la mora).
11. **Pantalla `/panel/{slug}/videos`** (Dueño y Staff, solo con `video_feed` en el plan): lista con estado de procesamiento, estado de publicación, cupo, publicar/despublicar, renombrar, enlazar a un plato, borrar/reintentar. Sin botón de subida hasta la parte B. «Borrar» y «Reintentar el borrado» son la misma acción (repetirla es segura); un video en «Eliminando» solo muestra el reintento. Aparece «Videos» en el menú de todos los locales (como «Llamados»): sin el feed en el plan, la pantalla lo explica.

## Aceptación
- [x] Un miembro de una organización Premium al día crea un borrador; Básico/Pro, solo lectura, suspendida, no miembro y anon no (y sin dejar fila).
- [x] Nadie con sesión escribe `mux_*`, `duration_seconds`, `mux_status` ni `organization_id`; ni lee `mux_asset_id` / `mux_upload_id`; ni borra.
- [x] Publicar exige `mux_status = ready`; un borrador sin procesar no se publica (23514).
- [x] Cupo: con 10 publicados el 11.º se rechaza (53400); despublicar uno libera lugar; diez publicaciones simultáneas sobre un cupo restante dejan exactamente el cupo.
- [x] Bajar de plan: los publicados se conservan, no se puede publicar otro y sí despublicar; `null` en `plans.max_videos_published` es sin límite.
- [x] `deleting` es terminal, no cuenta como publicado y libera el cupo.
- [x] Aislamiento: nadie ve ni toca los videos de otra organización; el `product_id` de otra organización se rechaza; borrar un plato deja el video sin enlace.
- [x] `org_entitlements` informa `usage.videos_published` y `limits.videos_published`.
- [x] Panel: la lista y las acciones funcionan, el cupo se ve, los errores son claros, no desborda a 390 px; sin `video_feed` la pantalla lo explica.

## Fuera de alcance (parte B y siguientes)
Mux real (cliente, subida directa, webhook, firma, borrado del asset, limpieza al borrar una organización), validación de peso y formato, prueba en iPhone y Android; el feed público; likes y comentarios.

## (C) Invariantes
1. Solo el servidor escribe lo que viene de Mux; la persona nunca elige un `playback_id`.
2. Hay como máximo `videos_published` filas `published` por organización, con la concurrencia serializada.
3. `published` ⇒ `ready` ⇒ asset, playback y duración presentes (`CHECK`).
4. Nadie sin `video_feed` crea ni publica; nadie en solo lectura o suspendida escribe.
5. `anon` no lee la tabla; los identificadores internos de Mux no llegan a Dueño ni Staff.
6. Un video en `deleting` nunca vuelve a otro estado.

## (C) Fallos y recuperación
| Falla | Resultado |
| --- | --- |
| El cupo se alcanza entre dos pedidos | El *advisory lock* serializa: el segundo recibe 53400, nada a medias. |
| Mux falla al borrar el asset | La fila queda en `deleting`, sin cupo ni lugar en la carta; «Reintentar» repite el borrado (idempotente). |
| Se pierde la respuesta de la base | «No pudimos confirmar…»: recargar y mirar; repetir es seguro. |
| Se baja de Premium con publicados | No se borra nada; no se ve el feed (incremento del feed) y no se publica más. |

## Evidencia
Base local con las migraciones hasta `20261111100000` (aplicada con `supabase migration up`, sin `db:reset`, para conservar los escenarios locales), 2026-10-22. Árbol sin commit; mis cambios: la migración, `src/lib/videos/`, `src/app/panel/[org]/videos/`, el ítem «Videos» del menú, `tests/rls/{videos,videos-modulo,acl}`, `e2e/videos.spec.ts`, `database.types.ts` (regenerado) y `docs/`.
- `pnpm lint` y `pnpm typecheck` limpios · `pnpm test` **816/816** (11 nuevas en `src/lib/videos/videos.test.ts`).
- RLS: `videos.rls` **28/28** (quién crea, columnas, CHECKs, publicación y cupo —con una prueba determinista de dos sesiones de `psql` sobre el último lugar—, bajar de plan, solo lectura, `deleting`, tope técnico, aislamiento, plato enlazado, entitlements), `videos-modulo.rls` **13/13** (el módulo contra la base con un Mux de mentira: renombrar, publicar, borrado en dos pasos y su reintento), `acl` 21/21 (cuatro funciones nuevas declaradas). Corrida completa: 977 pasan y **fallan 15, las mismas de siempre** por los escenarios locales (`catalog`, `tenancy`, `opciones`, `tables`, `push`).
- E2E (servidor `next dev` aparte en el puerto 3200 con `E2E_BASE_URL`, para no pisar el `.next` de los servidores del usuario): `videos.spec` **8/8** a 390 px (vacío, flujo de publicar/renombrar/despublicar, cupo lleno con el Staff, borrar con y sin asset, Pro, solo lectura, desborde, aislamiento); encontró un desborde real (la tarjeta se ensanchaba con un nombre largo sin espacios), corregido. Suite completa: 362 pasan y 10 fallan **sin relación con videos**: `acceso` espera el plan Básico de `cafe-ejemplo` (en esta base está en Pro), `menu` ×4 y `mesas` ×3 dependen del seed puro, `panel-llamados-aviso` y `sala:663` dependen de los datos del local, y `sala:327` falla por un error del propio manejador de rutas de la prueba (`route.continue: Route is already handled`), ya presente. No se repitieron sobre una base limpia (`db:reset` borraría los escenarios locales).
- **Mutaciones** (defensas rotas de a una en la base local, restauradas y con control en verde): 14 probadas, **14 detectadas** — publicar sin cupo, sin feature y sin lock (esta última **no** se detectaba al principio: la concurrencia por la API pasaba por orden de llegada; se agregó la prueba de dos sesiones y ahora falla sin el lock), sin trigger de transición, sin tope de 50, la persona escribiendo `mux_playback_id` / `mux_status` o leyendo `mux_asset_id`, borrando por la API, `anon` leyendo la tabla, alta sin el feed, actualizar sin la cuenta al día, publicado sin exigir procesado (CHECK) y `EXECUTE` del trigger de cupo para `authenticated`.
- **No probado / límites:** Mux real (nada se subió ni se reprodujo: parte B); el borrado de una organización con assets (hoy no hay ninguno); `pnpm build` (reemplazaría el `.next` de los servidores del usuario; typecheck, lint y las pantallas en `next dev` sí); staging y producción no se tocaron; lector de pantalla y teléfono real.

## (C) Revisión y aprobación
Pendiente.

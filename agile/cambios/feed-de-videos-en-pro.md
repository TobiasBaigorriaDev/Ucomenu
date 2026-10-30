# Cambio: El feed de videos pasa a Pro y Premium deja de ofrecerse
Estado: implementado y verificado en local; revisión independiente hecha (aprobar con cambios, aplicados); falta la aprobación del usuario para staging
Nivel: C  <!-- toca planes y límites (dinero): qué función concede cada plan -->

## Objetivo
Que el plan Pro incluya el feed de videos cortos (con cupo de 10 videos publicados) y que la portada ofrezca solo Básico y Pro, sin
mencionar Premium ni poner «Pronto». Premium queda en la base, sin venderse, para retomarlo con juegos, más videos, Wallet, etc.

## Decisiones
- Decisión del usuario, 2026-10-29. Motivos y alternativas en el [ADR 0049](../../docs/decisiones/0049-feed-de-videos-en-pro.md).
- Cambio de **datos**, no de reglas de código: migración `20261210100000` sobre `plans` (Pro suma `video_feed` y cupo 10). El acceso
  ya se decide por función (`private.has_feature`), no por el nombre del plan.
- Premium **no se borra** (descartado: unos 49 archivos, `check` de `plans.code`, organizaciones de staging).
- Los textos del panel que decían «plan Premium» pasan a «plan Pro»; el SuperAdmin conserva la opción Premium para las organizaciones
  que ya lo tienen.
- Portada: sin tarjeta Premium (la grilla de planes pasa a dos tarjetas), el feed figura en la lista de Pro y la celda «Videos cortos»
  deja de decir «Pronto» y dice «Pro».
- Fuera de alcance: precios (la portada ya muestra pesos y `docs/producto.md` sigue en dólares: se reconcilia aparte), borrar Premium,
  las funciones futuras de Premium, y aplicar la migración en staging o producción.

## Aceptación
- [x] Dado un local en Pro al día, cuando el Dueño o el Staff abre Videos, entonces sube, publica y ve el cupo «0 de 10».
- [x] Dado un local en Pro, cuando alguien escanea el QR de la mesa, entonces ve los videos publicados y puede dar like y comentar
  (el comentario sigue pendiente hasta que el local lo aprueba).
- [x] Dado un local en Básico, entonces no tiene el feed, no lo ve el público y el panel dice que está incluido en el plan Pro.
- [x] Dado un local en Premium, entonces conserva el feed y su cupo.
- [x] La portada no menciona Premium ni «Pronto», muestra dos planes y el feed dentro de Pro.
- [x] Pro en gracia conserva el feed; en solo lectura se ve pero no se escribe; suspendida, nada (igual que Premium).

## Evidencia
Aplicado solo en el Supabase local (`pnpm exec supabase migration up --local`, sin `db:reset` para no borrar datos de desarrollo). No se
tocó staging ni producción.
- **RLS (con la base local):** corridas de `videos`, `video-likes`, `video-comments`, `vistas-previas`, `billing`, `acl`, `planes-pagos`,
  `limits`, `retiro-webar`, `owner-lectura`, `addons-y-baja`, `sucursal-adicional`, `promociones` y `pedidos`. La primera corrida tras la
  migración dio **17 fallas, todas** afirmaciones de que Pro no tenía el feed; se reescribieron a «Básico no / Pro y Premium sí» y se
  agregaron pruebas positivas de Pro (crear, cupo de 10, público, likes, comentarios, `resolve_table_qr`, catálogo). **Resultado final:
  22 archivos verdes** (569 casos en la corrida larga; `pedidos-opciones` cayó una vez por el cierre inesperado del *worker* de Windows
  `0xC0000409`, ajeno al cambio, y al repetirlo pasó 18 de 18).
- **Unitarias, tipos y lint:** `pnpm test` (79 archivos, 1221 casos), `pnpm typecheck` y eslint, en verde. No se corrió `pnpm build`.
- **Visual:** la portada se revisó en 1440 y 390 px (dos planes, sin «Premium» ni «Pronto» en el texto, sin desborde) en un `next dev`
  propio; el precio ya no deja el hueco de las cifras tabulares.
- **E2E** (`videos`, `feed-videos`, `videos-mux`, `superadmin-addons-baja`, `portada`): actualizados a las mismas reglas y con una prueba
  nueva de Pro; no se pudieron ejecutar en esta sesión (en el puerto 3000 corre un `next start` ajeno y reconstruir `.next` lo rompería).
- **Documentos:** ADR 0049 (y nota en 0031), `docs/producto.md`, `docs/arquitectura.md`, `DESIGN.md` y su sidecar.

## (C) Invariantes
- Un local sin la función `video_feed` en su plan nunca sube, publica, recibe likes ni comentarios, ni se ve en la lectura pública.
- El cupo de 10 se comprueba al publicar y al insertar (también si lo hace el servidor).
- La cuenta en mora sigue mandando: gracia todo, solo lectura se ve y no se escribe, suspendida nada.
- Nadie con sesión de la API puede escribir en `plans` (probado en `billing.rls`).
- Básico no gana nada: cupo 0 y sin la función.

## (C) Fallos y recuperación
- La migración es idempotente (no repite la función; fija el cupo solo si era 0) y corre en una transacción.
- Revertir: `update public.plans set features = array_remove(features, 'video_feed'), max_videos_published = 0 where code = 'pro';`. Los
  videos no se borran; mientras el plan no conceda la función no se puede crear ni publicar (sí despublicar y renombrar) y no se muestran,
  y vuelven a verse al concederla.
- Costo: más locales pueden usar Mux (almacenamiento y reproducción); el cupo de 10 lo acota. Conviene contrastarlo con el precio de Pro
  con uso real.

## (C) Revisión y aprobación
- Aprobación humana del cambio de planes: el usuario lo pidió el 2026-10-29. Aplicarlo en staging y producción requiere su aprobación.
- Revisión independiente (2026-10-29, sesión limpia, solo lectura): **aprobar con cambios**. No halló defectos de seguridad ni de lógica:
  Básico no gana ningún camino al feed, la migración es transaccional, idempotente y reversible, nada depende del nombre del plan y
  ninguna garantía de las pruebas se debilitó. Pidió cinco ajustes de texto (arquitectura, producto, tablero, un comentario de la
  migración y el nombre de una prueba), todos aplicados.

## Antes de aplicar fuera de local
- [ ] Aprobación explícita del usuario para staging (`supabase db push` al proyecto de staging) y, más adelante, producción.
- [x] Revisión independiente en solo lectura del diff (migración, pruebas, textos, portada).
- [ ] Pasar los locales de demostración que hoy están en Premium a Pro si se quiere mostrar «lo que ve un cliente Pro» (Aurelia y Bruma).
- [ ] Correr `pnpm build` y los E2E nombrados arriba con un servidor propio.

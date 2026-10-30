# 0049 — El feed de videos cortos pasa al plan Pro y Premium deja de ofrecerse por ahora

- Estado: aceptada
- Fecha: 2026-10-29
- Enmienda a: [0031 — Feed de videos cortos (plan Premium)](0031-feed-de-videos-cortos.md) en lo que dice del plan; el resto de 0031 (Mux, interacción solo desde la mesa, aprobación previa) sigue igual.

## Contexto
El ADR 0031 puso el feed de videos cortos en Premium, con un cupo de 10 videos publicados. Premium todavía no se vende: de lo que
lo distinguía, solo el feed está implementado; la fidelización con Wallet depende de cuentas de Apple y Google y los clientes
recurrentes esperan la revisión legal. Tener tres niveles con el más alto sin poder venderse complica la portada, el SuperAdmin,
las pruebas y la decisión de quien compra. El usuario decidió (2026-10-29) ofrecer dos planes, Básico y Pro, y dejar Premium para
más adelante, con juegos, más cupo de videos, Wallet y lo que se agregue.

## Decisión
- El plan **Pro** concede la función `video_feed` con un cupo de **10 videos publicados**, el mismo que tenía Premium. Se hace con una
  migración de datos sobre `plans` (`20261210100000`), sin tocar funciones ni políticas.
- **Premium se conserva en la base**, con su fila, sus funciones y su cupo, pero no se ofrece: no figura en la portada ni se vende.
  El SuperAdmin puede seguir asignándolo a organizaciones ya existentes (por ejemplo, los locales de demostración de staging).
- Lo que se construya después para Premium (juegos, más videos, Wallet, clientes recurrentes) se define en su propio ADR cuando
  exista; no se promete antes.

## Alternativas consideradas
- **Borrar Premium del modelo:** obliga a cambiar el `check` de `plans.code`, la tabla de suscripciones, unos 49 archivos entre esquema,
  formularios, pruebas y documentos, y a migrar organizaciones. Es de nivel C, difícil de revertir y se perdería la base para el plan
  que el usuario piensa lanzar. Se descarta por ahora.
- **Dejar el feed solo en Premium y no ofrecerlo:** Pro quedaría sin el único extra ya construido y Premium seguiría sin poder venderse.
- **Mostrar Premium como «Pronto»:** el usuario prefirió no mostrarlo para no confundir al comprador.

## Consecuencias
- Las organizaciones en Pro ganan el feed al aplicarse la migración: pueden subir, publicar, recibir likes y comentarios, hasta 10
  videos publicados. El costo variable de Mux (almacenamiento y reproducción) lo asume UcoMenu; el cupo lo acota, pero conviene
  contrastarlo con el precio de Pro cuando haya uso real.
- Básico sigue sin feed y con cupo 0. Un plan sin la función no puede crear ni publicar videos ni recibir likes o comentarios, y la lectura pública no los muestra, aunque tenga videos.
- Los locales que quedan en Premium (staging) conservan todo, y bajar a Pro ya no les quita el feed.
- Los textos del panel dicen «plan Pro»; la portada lo lista dentro de Pro. `docs/producto.md` y el catálogo de pruebas reflejan
  que Pro y Premium comparten el feed.
- Revertir es una sola sentencia sobre `plans` (ver la migración); los videos no se borran.

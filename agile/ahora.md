# Ahora (handoff)

Actualizado: 2026-10-22 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

La **fase 2 llegó al feed**: carga y publicación de videos con Mux (ADR 0031) y feed vertical en la carta están **hechos y en staging** (Fly con la migración `20261113100000`). El usuario probó el feed desde el QR de la mesa y le gustó. Ver [ficha](cambios/feed-de-videos.md).

El feed vive también bajo `/t/{token}/videos` y conserva la barra de llamado. Intenta HLS nativo y cae a `hls.js` si el video da error.

No hay trabajo a medias. Hay **11 commits locales sin `git push`** (desde `737df04` hasta `b3c9caa`, más el de esta documentación). Falta decidir con el usuario si se suben a `origin/main`.

## Bloqueos y límites

- Sin probar: Firefox, Safari de escritorio y Android (también la subida de videos). Está listado en «Para verificar» del tablero.
- En staging está publicado el video «Vhkkk» de `cafe-de-ensayo`, solo para la prueba; se despublica desde el panel.
- Con `next dev`, el indicador de Next («1 Insight») tapa botones y bloquea clics en varias E2E; contra el build (`pnpm build` y `pnpm test:e2e`) pasan. `next dev` y `next build` se detienen una vez para mostrar un aviso de actualización y arrancan al reintentar. No se actualizó Next.
- La base local tiene datos de escenarios extra: fallan 15 pruebas RLS y `mesas.spec:74` (la «Mesa 3» quedó activa). `pnpm db:reset` lo restablece.
- `tools/escenarios-locales.mjs` es una herramienta local sin versionar, ajena al feed.
- La producción sigue bloqueada (dominio, etc.).

## Próximo paso

Elegir del tablero, por valor y riesgo. Los dos que siguen son nivel C (ficha, tests de RLS, una revisión independiente y aprobación humana):

1. **Likes anónimos desde la mesa.** El feed de la mesa ya existe, así que está desbloqueado. Pide una función pública única de base con el ticket de visita (como `create_waiter_call`), un voto por dispositivo y video, límite por cliente y ningún dato del comensal. Decisiones a tomar: botón y conteo en el feed, y qué ve quien entra sin mesa.
2. **Comentarios con aprobación previa.** Conviene hacerlos después de los likes, que prueban la función pública. Falta la cola de moderación.

Antes de producción también hace falta el ítem S de textos legales. Como comprobación aparte, está el ítem S de pruebas en un Android real y en otros navegadores.

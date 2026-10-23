# Ahora (handoff)

Actualizado: 2026-10-22 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

La carga y publicación de videos con Mux (ADR 0031) y el **feed vertical en la carta** están **hechos y en staging** (Fly con la migración `20261113100000`). El usuario lo probó desde el QR de la mesa y le gustó: [ficha](cambios/feed-de-videos.md).

El feed vive también bajo `/t/{token}/videos` y conserva la barra de llamado. Intenta HLS nativo y cae a `hls.js` si el video da error.

No hay trabajo a medias. Hay **12 commits locales sin `git push`** (desde `737df04`). Falta decidir con el usuario si se suben a `origin/main`.

## Bloqueos y límites

- Sin probar: Firefox, Safari de escritorio y Android (también la subida de videos). Está en «Para verificar» del tablero.
- En staging está publicado el video «Vhkkk» de `cafe-de-ensayo`, solo para la prueba; se despublica desde el panel.
- Con `next dev`, el indicador de Next («1 Insight») bloquea clics en varias E2E; contra el build pasan. `next dev` y `next build` se detienen una vez para mostrar un aviso de actualización y arrancan al reintentar. No se actualizó Next.
- La base local tiene datos de escenarios extra: fallan 15 pruebas RLS y `mesas.spec:74`. `pnpm db:reset` lo restablece.
- `tools/escenarios-locales.mjs` es local, sin versionar y ajena al feed.
- La producción sigue bloqueada (dominio, etc.).

## Próximo paso

Elegir del tablero, por valor y riesgo. Los dos siguientes son nivel C (ficha, RLS, una revisión independiente y aprobación humana):

1. **Likes anónimos desde la mesa.** Está desbloqueado. Pide una función pública única de base con el ticket de visita (como `create_waiter_call`), un voto por dispositivo y video, límite por cliente y ningún dato del comensal. Decidir: botón y conteo en el feed, y qué ve quien entra sin mesa.
2. **Comentarios con aprobación previa**, después de los likes. Falta la cola de moderación.

Antes de producción hacen falta los textos legales (S). Aparte, el ítem S de pruebas en Android y otros navegadores.

# Ahora (handoff)

Actualizado: 2026-10-22 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

La carga y publicación de videos con Mux (ADR 0031) está hecha y en `origin/main`. El **feed vertical de videos en la carta** (nivel C, [ficha](cambios/feed-de-videos.md)) está **en staging**: migración `20261113100000` aplicada y app desplegada en Fly por orden del usuario. Codex lo aprobó en 3 rondas, y la última cubrió el fallback a `hls.js`.

La prueba real lo mejoró dos veces. Chrome 155 anuncia HLS nativo y lo rechaza, así que el feed cae a `hls.js` si el video da error (Chrome reprodujo el video de Mux en staging). Además, al entrar al feed desde la mesa desaparecía el llamado al mozo: ahora existe `/t/{token}/videos`, que conserva la barra de llamado y mide su alto real. Codex aprobó ambos cambios (5 rondas en total).

Hay commits locales sin `git push` desde `737df04` hasta el último de esta tanda (feed, fallback a `hls.js`, feed de la mesa).

## Bloqueos y límites

- Falta probar el feed en **Safari/iPhone** (HLS nativo) y en Firefox. Android sigue sin probarse (subida de videos).
- Para esta prueba se publicó el único video, «Vhkkk», de `cafe-de-ensayo` (Premium). Se despublica desde el panel.
- En E2E los hosts de Mux están interceptados; la reproducción real solo se comprobó a mano.
- La base local tiene datos de escenarios extra: fallan 15 pruebas RLS y algunas E2E ajenas (por ejemplo `mesas.spec`, con la «Mesa 3» activa).
- Con `next dev`, el indicador de Next («1 Insight») tapa botones y bloquea clics en varias E2E; contra el build pasan. `next dev` y `next build` se detienen una vez para mostrar un aviso de actualización y arrancan al reintentar.
- La producción sigue bloqueada (dominio, etc.).

## Próximo paso

1. El usuario prueba en su iPhone el feed desde el QR de la mesa (`/t/{token}` de «Mesa 1» de `cafe-de-ensayo`): sonido, deslizar, volver y que «Llamar al mozo» / «Pedir la cuenta» sigan en el feed. Con ese resultado se cierra el ítem.
2. Decidir con el usuario el `git push` de `main` a `origin`.

Después, siguiendo el tablero: likes anónimos desde la mesa (C), comentarios con aprobación (C) y los textos legales (S).

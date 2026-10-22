# Ahora (handoff)

Actualizado: 2026-10-22 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

La carga y publicación de videos con Mux (ADR 0031) está hecha y en `origin/main`. El **feed vertical de videos en la carta** (nivel C, [ficha](cambios/feed-de-videos.md)) está **en staging**: migración `20261113100000` aplicada y app desplegada en Fly por orden del usuario. Codex lo aprobó en 3 rondas, y la última cubrió el fallback a `hls.js`.

La prueba real lo mejoró: Chrome 155 anuncia HLS nativo y lo rechaza, así que el feed ahora cae a `hls.js` si el video da error. Con ese arreglo, Chrome reprodujo el video de Mux en staging.

Hay cuatro commits locales sin `git push`: `737df04`, `2223b32`, `6277961` y `5c052c6`.

## Bloqueos y límites

- Falta probar el feed en **Safari/iPhone** (HLS nativo) y en Firefox. Android sigue sin probarse (subida de videos).
- Para esta prueba se publicó el único video, «Vhkkk», de `cafe-de-ensayo` (Premium). Se despublica desde el panel.
- En E2E los hosts de Mux están interceptados; la reproducción real solo se comprobó a mano.
- La base local tiene datos de escenarios extra: fallan 15 pruebas RLS y algunas E2E ajenas (por ejemplo `mesas.spec`, con la «Mesa 3» activa).
- La producción sigue bloqueada (dominio, etc.).

## Próximo paso

1. El usuario abre en su iPhone `https://ucomenu-staging.fly.dev/m/cafe-de-ensayo/principal` y entra con «Ver videos». Prueba que el video arranque mudo, el botón de sonido, deslizar, volver y el idioma. Con ese resultado se cierra el ítem.
2. Decidir con el usuario el `git push` de `main` a `origin`.

Después, siguiendo el tablero: likes anónimos desde la mesa (C), comentarios con aprobación (C) y los textos legales (S).

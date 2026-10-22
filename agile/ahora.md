# Ahora (handoff)

Actualizado: 2026-10-22 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

La carga y publicación de videos con Mux (partes A y B, ADR 0031) está hecha, en staging (Fly v21) y **ya subida a `origin/main`**. Ahora está en curso el **feed vertical de videos en la carta** (nivel C): [ficha](cambios/feed-de-videos.md). Está **implementado y probado en local** (unitarias, RLS, E2E y mutaciones; la evidencia está en la ficha), y **aprobado por Codex en 2 rondas** (un hallazgo de autoplay bloqueado, corregido con regresión; commits `737df04` y `2223b32`, solo en local).

Se aprobó la dependencia `hls.js` 1.7.3. La migración `20261113100000_videos_feed_publico.sql` está aplicada solo en la base local, no en staging.

## Bloqueos y límites

- Falta la prueba de reproducción real con un asset de Mux de staging, en Safari/iPhone (HLS nativo) y en Chrome (`hls.js`): en E2E los hosts de Mux están interceptados.
- Android sigue sin probarse (subida de videos). El peso de 50 MB solo se valida en el navegador.
- La base local tiene datos de escenarios extra: fallan 15 pruebas RLS y algunas E2E ajenas (por ejemplo `mesas.spec`, con la «Mesa 3» activa). Un E2E que espera el puerto 3100 falla si se corre contra :3200.
- La producción sigue bloqueada (dominio, etc.).

## Próximo paso

1. Con la aprobación del usuario: `pnpm exec supabase db push` (lo corre el usuario con `!` si el clasificador lo bloquea), desplegar a Fly con `--local-only` y probar el feed con un video publicado de `prueba-videos`.
2. Registrar la evidencia real en la ficha y cerrar el ítem en el tablero.

Después, siguiendo el tablero: likes anónimos desde la mesa (C), comentarios con aprobación (C) y los textos legales (S).

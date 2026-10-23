# Ahora (handoff)

Actualizado: 2026-10-22 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

Los **likes anónimos desde la mesa** están hechos en local y aprobados por Codex en dos rondas: [ficha](cambios/likes-del-feed.md). Un corazón con conteo en cada video; desde `/t/{token}/videos` es un botón (un like por dispositivo y video) y sin mesa solo se ve el conteo. La puerta de escritura es `set_video_like`; el navegador guarda, solo al primer toque, un código aleatorio (decisión del usuario), y `/privacidad` ya lo dice.

No hay trabajo a medias. Hay **14 commits locales sin `git push`** (desde `737df04`; los dos últimos son los likes: `fb5a3ac` y `ed30bcd`). La migración `20261114100000` **no está en staging**.

## Bloqueos y límites

- Falta la aprobación del usuario para subir a `origin/main` y desplegar (migración con `db push` y Fly). Es nivel C: no hacerlo sin pedirla.
- Sin probar en teléfono real, Firefox, Safari de escritorio ni Android (está en «Para verificar»); tampoco los likes con Mux real y varios videos.
- Con `next dev` el indicador de Next bloquea clics en E2E; contra el build pasan. `next dev` y `next build` se detienen una vez con un aviso de actualización de Next y arrancan al reintentar. No se actualizó Next.
- Fallas ajenas, intermitentes en corridas en paralelo: `owner-lectura.rls` (restricción de `audit_log`) y `videos-mux.spec:145` (contador del Mux de mentira); pasan solas.
- `tools/escenarios-locales.mjs` es local, sin versionar y ajena.
- La producción sigue bloqueada (dominio, etc.).

## Próximo paso

Elegir del tablero, por valor y riesgo. Lo que sigue en la fase 2:

1. **Comentarios con aprobación previa** (C): envío desde la mesa con alias opcional, cola de moderación para Dueño y Staff, retención de los rechazados. Reutiliza la entrada por la mesa que probaron los likes (`resolve_table_qr`, ticket de visita, función pública única). Antes de producción hacen falta los textos legales de comentarios (S).
2. Si el usuario lo aprueba: subir y desplegar los likes y probarlos desde su teléfono.

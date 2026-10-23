# Ahora (handoff)

Actualizado: 2026-10-22 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

Los **likes anónimos desde la mesa** están hechos, aprobados por Codex en dos rondas y **en staging** (migración `20261114100000` y Fly): [ficha](cambios/likes-del-feed.md). Un corazón con conteo en cada video; desde `/t/{token}/videos` es un botón (un like por dispositivo y video) y sin mesa solo se ve el conteo. La puerta de escritura es `set_video_like`; el navegador guarda, solo al primer toque, un código aleatorio (decisión del usuario), y `/privacidad` ya lo dice.

No hay trabajo a medias y todo está en `origin/main`.

## Bloqueos y límites

- Falta probar los likes en un teléfono real (QR de «Mesa 1» de `cafe-de-ensayo`, feed y corazón). Sin probar en teléfono real, Firefox, Safari de escritorio ni Android (está en «Para verificar»); tampoco los likes con Mux real y varios videos.
- Con `next dev` el indicador de Next bloquea clics en E2E; contra el build pasan. `next dev` y `next build` se detienen una vez con un aviso de actualización de Next y arrancan al reintentar. No se actualizó Next.
- Fallas ajenas, intermitentes en corridas en paralelo: `owner-lectura.rls` (restricción de `audit_log`) y `videos-mux.spec:145` (contador del Mux de mentira); pasan solas.
- `tools/escenarios-locales.mjs` es local, sin versionar y ajena.
- La producción sigue bloqueada (dominio, etc.).

## Próximo paso

Elegir del tablero, por valor y riesgo. Lo que sigue en la fase 2:

1. **Comentarios con aprobación previa** (C): envío desde la mesa con alias opcional, cola de moderación para Dueño y Staff, retención de los rechazados. Reutiliza la entrada por la mesa que probaron los likes (`resolve_table_qr`, ticket de visita, función pública única). Antes de producción hacen falta los textos legales de comentarios (S).
2. Rotar la `service_role` legacy de staging (salió impresa en una sesión); si Fly la usa como secreto, actualizarla con `fly secrets set`.

# Ahora (handoff)

Actualizado: 2026-10-23 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

Los **comentarios con aprobación previa** están implementados y verificados en local, **sin subir a staging**; Codex los revisó en 3 rondas y el usuario aceptó como excepción el último hallazgo (nivel C): [ficha](cambios/comentarios-del-feed.md). Desde la mesa, una hoja de comentarios en cada video del feed con alias opcional; lo enviado queda pendiente y se aprueba, rechaza o retira desde `/panel/{slug}/comentarios` (Dueño y Staff). La puerta de alta es `submit_video_comment`; la migración es `20261115100000`.

Decisiones propias (ficha y ADR 0031): rechazados 7 días y pendientes 30 (`purge_video_comments`, **sin programar**: `docs/produccion.md`, 4.b); rechazar o retirar nunca se bloquea por mora; nada se guarda en el teléfono.

## Bloqueos y límites

- **Habilitar comentarios en producción** exige los textos legales (ítem S del tablero) y programar la purga. Hoy `/privacidad` no menciona los comentarios.
- Falta probar en un teléfono real (teclado en pantalla con la hoja abierta) y los likes, igual que antes; Firefox, Safari de escritorio y Android siguen en «Para verificar».
- E2E contra el build (con `next dev` el indicador de Next bloquea clics). `next dev` y `next build` se detienen una vez con un aviso de actualización de Next; no se actualizó. Un `EPERM` sobre `.next` (OneDrive) se resuelve borrando `.next`.
- Fallas ajenas, intermitentes: `sala.spec:327`, `videos-mux.spec:145` y a veces `owner-lectura.rls`; pasan solas.
- `tools/escenarios-locales.mjs` es ajena y sin versionar.
- La producción sigue bloqueada (dominio, etc.).

## Próximo paso

1. Con aprobación del usuario: `git push`, subir la migración y desplegar a staging. El límite aceptado (la función pública no verifica ticket ni conexión; acotado por 30 cada 10 minutos por local y 100 pendientes) tiene su ítem de endurecimiento en el tablero.
2. Elegir del tablero: textos legales (S) de comentarios.
3. Rotar la `service_role` legacy de staging (salió impresa en una sesión); si Fly la usa como secreto, actualizarla con `fly secrets set`.

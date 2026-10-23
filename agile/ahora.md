# Ahora (handoff)

Actualizado: 2026-10-23 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

Los **comentarios con aprobación previa** están implementados y verificados en local, **sin subir a staging**; Codex los revisó en 3 rondas y queda un hallazgo que espera decisión del usuario (nivel C): [ficha](cambios/comentarios-del-feed.md). Desde la mesa, una hoja de comentarios en cada video del feed con alias opcional; lo enviado queda pendiente y se aprueba, rechaza o retira desde `/panel/{slug}/comentarios` (Dueño y Staff). La puerta de alta es `submit_video_comment`; la migración es `20261115100000`.

Decisiones propias, ya en la ficha y en la enmienda del ADR 0031: los rechazados se borran a los 7 días y los pendientes a los 30 (`purge_video_comments`, **sin programar**: paso 4.b de `docs/produccion.md`); rechazar o retirar nunca se bloquea por mora; sin identificador por dispositivo ni nada guardado en el teléfono.

Los likes (anteriores) están en `origin/main` y en staging.

## Bloqueos y límites

- **Habilitar comentarios en producción** exige los textos legales (ítem S del tablero) y programar la purga. Hoy `/privacidad` no menciona los comentarios.
- Falta probar en un teléfono real (teclado en pantalla con la hoja abierta) y los likes, igual que antes; Firefox, Safari de escritorio y Android siguen en «Para verificar».
- Con `next dev` el indicador de Next bloquea clics en E2E; contra el build pasan. `next dev` y `next build` se detienen una vez con un aviso de actualización de Next. No se actualizó Next.
- Fallas ajenas, intermitentes: `sala.spec:327`, `videos-mux.spec:145` y a veces `owner-lectura.rls`; pasan solas. Una corrida completa de E2E perdió el servidor de pruebas a mitad.
- `tools/escenarios-locales.mjs` es local, sin versionar y ajena.
- La producción sigue bloqueada (dominio, etc.).

## Próximo paso

1. **Decisión del usuario** sobre el hallazgo abierto de Codex (la función pública no verifica el ticket ni la conexión: quien la llame directo los omite; mismo límite que el llamado y los likes, acotado en comentarios por 30 cada 10 minutos por local y 100 pendientes): aceptarlo como excepción o endurecer las tres funciones. Después, con su aprobación, subir la migración y desplegar a staging.
2. Elegir del tablero: textos legales (S) de comentarios.
3. Rotar la `service_role` legacy de staging (salió impresa en una sesión); si Fly la usa como secreto, actualizarla con `fly secrets set`.

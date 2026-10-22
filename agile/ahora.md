# Ahora (handoff)

Actualizado: 2026-10-22 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

Se implementó la **parte B** de «Carga y publicación de videos» (nivel C, ADR 0031): [ficha](cambios/videos-mux-parte-b.md). Mux real: cliente con `fetch` (sin dependencias), subida directa del navegador a la URL firmada, `POST /api/mux/webhook` con firma HMAC, huérfanos borrados en Mux, borrado de organización que limpia assets, miniatura y pantalla de subida con progreso. Migración `20261112100000` (`mux_error`). Codex la aprobó en tres rondas (hubo dos hallazgos reales de carreras, ya corregidos); commits hasta `cd5ec03`, **solo en local, sin `git push`**. La parte A está en staging (Fly v19).

Se probó contra el Mux real (entorno `ucomenu-staging`): subida, asset listo con los campos que lee el manejador, miniatura y borrado idempotente. Los E2E usan un Mux de mentira local (`e2e/mux-stub.ts`).

## Bloqueos y límites

Parte B **desplegada en staging (Fly v21)**, con la migración `20261112100000` y los secretos de Mux ya cargados. **Bloqueo:** Mux entrega los avisos pero la app los rechaza con `firma mismatch`: el `MUX_WEBHOOK_SECRET` que tenemos no es el *signing secret* del webhook de Mux. El usuario debe copiar el correcto (Settings → Webhooks del entorno `ucomenu-staging`), actualizar `.env.local` y correr `fly secrets set -c fly.staging.toml MUX_WEBHOOK_SECRET=…`. La app y el borrado contra Mux real se probaron firmando yo mismo los eventos (ver la ficha). Organización de prueba lista: `prueba-videos` (Premium) con la cuenta `uconext.digital@gmail.com` como Dueño. El plan Free de Mux guarda hasta 10 assets. Los commits están solo en local (sin `git push`). Con los escenarios locales cargados fallan 15 pruebas RLS y varias E2E por datos extra.

## Próximo paso

Esperar el secreto corregido y repetir la prueba real (`smoke-webhook`: subir un video de muestra a Mux sin fila y ver que staging lo borra), y entonces la prueba en iPhone y Android con la guía de la ficha. Después, el feed vertical en la carta (M): lectura pública (`anon`), reproductor HLS (puede pedir una dependencia, a decidir con el usuario) y caché.

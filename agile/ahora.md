# Ahora (handoff)

Actualizado: 2026-10-22 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

Se implementó la **parte B** de «Carga y publicación de videos» (nivel C, ADR 0031): [ficha](cambios/videos-mux-parte-b.md). Mux real: cliente con `fetch` (sin dependencias), subida directa del navegador a la URL firmada, `POST /api/mux/webhook` con firma HMAC, huérfanos borrados en Mux, borrado de organización que limpia assets, miniatura y pantalla de subida con progreso. Migración `20261112100000` (`mux_error`). Codex la aprobó en tres rondas (hubo dos hallazgos reales de carreras, ya corregidos); commits hasta `cd5ec03`, **solo en local, sin `git push`**. La parte A está en staging (Fly v19).

Se probó contra el Mux real (entorno `ucomenu-staging`): subida, asset listo con los campos que lee el manejador, miniatura y borrado idempotente. Los E2E usan un Mux de mentira local (`e2e/mux-stub.ts`).

## Bloqueos y límites

Falta la **aprobación del usuario** y subir la B a staging: `! pnpm exec supabase db push` (aditiva), `fly secrets set -c fly.staging.toml MUX_TOKEN_ID=… MUX_TOKEN_SECRET=… MUX_WEBHOOK_SECRET=…` (los corre el usuario; reinicia la app) y el despliegue (`flyctl deploy` con build local, método en la ficha del catálogo). Nada probado todavía: la entrega real del webhook de Mux a staging y un video desde iPhone y Android (incluido `.mov` HEVC). El webhook de Mux (entorno `ucomenu-staging`) ya está creado hacia `https://ucomenu-staging.fly.dev/api/mux/webhook`. El peso de 50 MB solo se valida en el navegador. El plan Free de Mux guarda hasta 10 assets: borrar los de prueba. No hice `pnpm build` (pisaría el `.next` de los servidores del usuario). Con los escenarios locales cargados fallan 15 pruebas RLS y varias E2E por datos extra.

## Próximo paso

Con la aprobación: empujar la migración, cargar los secretos, desplegar y hacer la prueba real con el usuario (subir un clip de 30 s desde el teléfono, ver «Procesando» → «Listo», publicar y borrar, y comprobar que en Mux quedan 0 assets). Después, el feed vertical en la carta (M), con lectura pública (`anon`), reproducción HLS —hace falta decidir el reproductor, que puede pedir una dependencia— y la caché.

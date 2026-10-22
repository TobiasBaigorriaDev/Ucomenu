# Ahora (handoff)

Actualizado: 2026-10-22 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

Se implementó la **parte B** de «Carga y publicación de videos» (nivel C, ADR 0031): [ficha](cambios/videos-mux-parte-b.md). Mux real: cliente con `fetch` (sin dependencias), subida directa del navegador a la URL firmada, `POST /api/mux/webhook` con firma HMAC, huérfanos borrados en Mux, borrado de organización que limpia assets, miniatura y pantalla de subida con progreso. Migración `20261112100000` (`mux_error`). Codex la aprobó en tres rondas (hubo dos hallazgos reales de carreras, ya corregidos); commits hasta `cd5ec03`, **solo en local, sin `git push`**. La parte A está en staging (Fly v19).

Se probó contra el Mux real (entorno `ucomenu-staging`): subida, asset listo con los campos que lee el manejador, miniatura y borrado idempotente. Los E2E usan un Mux de mentira local (`e2e/mux-stub.ts`).

## Bloqueos y límites

Parte B **desplegada en staging (Fly v21)** y probada de punta a punta con Mux real desde un navegador móvil emulado (subida, «Listo» en ~6 s, miniatura, publicar, despublicar, borrar, 0 assets). El secreto de firma del webhook ya es el correcto (se cargó también en Fly). **Falta solo** la prueba en iPhone y Android reales (cámara, `.mov` HEVC, archivos grandes, conexión móvil), con la guía de la ficha. Organización de prueba: `prueba-videos` (Premium) con la cuenta `uconext.digital@gmail.com` como Dueño. El plan Free de Mux guarda hasta 10 assets. Los commits están solo en local (sin `git push`). Con los escenarios locales cargados fallan 15 pruebas RLS y varias E2E por datos extra.

## Próximo paso

La prueba del usuario en los teléfonos y anotar el resultado en la ficha. Con eso, cerrar la parte B (estado «hecho» en el tablero) y decidir si se sube `main` a `origin`. Después, el feed vertical en la carta (M): lectura pública (`anon`), reproductor HLS (puede pedir una dependencia, a decidir con el usuario) y caché.

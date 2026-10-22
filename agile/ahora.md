# Ahora (handoff)

Actualizado: 2026-10-22 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

Se implementó la **parte A** de «Carga y publicación de videos» (nivel C, ADR 0031): [ficha](cambios/videos-del-panel-base.md). Migración `20261111100000`: tabla `menu_videos` (estados, permisos por columna, cupo `videos_published` al publicar con lock, tope de 50, borrado en dos pasos), `usage.videos_published` en `org_entitlements`, módulo `src/lib/videos/` con Mux detrás de una interfaz y pantalla `/panel/{slug}/videos` (Dueño y Staff). Codex la aprobó en dos rondas (commits `1e51ea7` y `48deee6`, solo en local). Evidencia, mutaciones (14/14) y el hallazgo corregido están en la ficha.

El usuario aprobó (2026-10-22). Migración aplicada en staging (la empujó él) y app desplegada en la **v19** (commit `c1a6a5a`; imagen anterior v18 en la ficha). Falta que pruebe con sesión: «Videos» en un local Premium y en uno Pro.

Los commits están solo en local (sin `git push`). `tools/escenarios-locales.mjs` sigue local y sin versionar.

## Bloqueos y límites

La **parte B** necesita del usuario la cuenta de Mux (plan Free), `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET` y el secreto del webhook, cargados como secretos de Fly y en `.env.local`. Decisiones abiertas para la parte B (en la ficha): peso de 50 MB sin dato de Mux, tolerancia de 30,5 s y playback público desde que el asset está listo. Borrar una organización con assets en Mux exige limpiarlos antes. RLS y E2E comparten base. Con los escenarios locales cargados fallan 15 pruebas RLS y varias E2E (`menu`, `mesas`, `acceso`) por datos extra, y `sala:327` por un error de su manejador de rutas. No hice `pnpm build` para no pisar el `.next` de los servidores del usuario (3000 y 3001); el E2E corrió contra `next dev` en 3200.

## Próximo paso

Pedir al usuario las credenciales de Mux y empezar la parte B (nivel C: cliente real, subida directa, webhook, borrado del asset, validaciones y prueba en teléfonos). Después, el feed en la carta (M), con su lectura pública (`anon`) y la caché.

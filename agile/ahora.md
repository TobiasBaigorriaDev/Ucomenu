# Ahora (handoff)

Actualizado: 2026-10-21 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

El primer ítem de la fase 2, [catálogo del feed de videos](cambios/catalogo-video-feed.md) (nivel C; ADR 0031), está **commiteado** (`88603fa`, `ae67c75`, `b5ff895`), aprobado por el usuario y por Codex en tres rondas. Migración `20261110100000`: `video_feed` y `max_videos_published` (10) en Premium, WebAR fuera de la base. Evidencia, mutaciones y hallazgos corregidos, en la ficha.

Los cuatro cambios anteriores (selector de Sala, editor de platos, personalización de la carta ADR 0036 y temas de fechas ADR 0037) fueron aprobados por el usuario el 2026-10-21 y están commiteados (`35096b3`, `1a7d114`, `aa35f92`). `tools/escenarios-locales.mjs` sigue local y sin versionar.

## Bloqueos y límites

Staging está en las migraciones hasta `20261107100000`. El usuario aprobó empujar **las cuatro** pendientes (`20261108100000`, `20261108110000`, `20261109100000` y la del catálogo `20261110100000`, que borra contratos `webar` de ensayo), pero `supabase db push` fue **denegado por el clasificador de permisos** de Claude Code: queda por ejecutar (el usuario puede correr `! pnpm exec supabase db push`, o permitirlo). Producción sigue pendiente ([ficha](cambios/salida-a-produccion.md)). RLS y E2E comparten base: no correrlos a la vez. Con los escenarios locales cargados fallan 15 pruebas RLS y 3 E2E de `menu.spec` por datos extra, no por el código. No se hizo `pnpm build` para no pisar el `.next` de los servidores `next start` del usuario (3000 y 3001, con el build anterior): el E2E de SuperAdmin corrió contra `next dev` en 3200.

## Próximo paso

Empujar las cuatro migraciones a staging (ver Bloqueos), comprobar con `supabase migration list` y decidir si se despliega la app. Luego, el ítem desbloqueado del tablero: carga y publicación de videos con Mux (nivel C); necesita las credenciales del plan Free de Mux (ADR 0031), que debe aportar el usuario. La carga debe exigir `org_can_write` además de `has_feature('video_feed')` y contar el uso en `org_entitlements`.

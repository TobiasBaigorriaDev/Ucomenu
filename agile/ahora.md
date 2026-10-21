# Ahora (handoff)

Actualizado: 2026-10-21 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

Se implementó en local el primer ítem de la fase 2: [catálogo del feed de videos](cambios/catalogo-video-feed.md) (nivel C; ADR 0031). Migración `20261110100000`: `video_feed` y `max_videos_published` (10) en Premium, WebAR y `models_3d` fuera de la base, pantalla de add-ons de SuperAdmin con el catálogo vacío. Aceptación, decisiones, evidencia y mutaciones están en la ficha. Está **sin commit y sin revisión independiente**; la ficha dice cómo pedirla (`pnpm revision:codex`), que exige un commit.

Siguen sin commit, mezclados en el mismo árbol de `main` (HEAD base `68cfb60`), cuatro cambios anteriores: [corrección del selector de Sala](cambios/selector-sucursal-directo.md), [edición de platos por tarea](cambios/editor-plato-ux.md), [personalización de la carta](cambios/personalizacion-carta.md) (ADR 0036) y [temas de fechas](cambios/temas-de-fechas.md) (ADR 0037), con migraciones `20261108100000`, `20261108110000` y `20261109100000` aplicadas solo en local. Si se integra, commitear por cambio preservando el resto; `tools/escenarios-locales.mjs` es local y sin versionar. `database.types.ts`, `producto.md`, `tablero.md` y este archivo mezclan cambios de varios.

## Bloqueos y límites

Staging está en las migraciones hasta `20261107100000`; nada posterior se subió. La `20261110100000` **borra** contratos `webar` (solo de ensayo): aprobar antes de `supabase db push`. Producción sigue pendiente ([ficha](cambios/salida-a-produccion.md)). RLS y E2E comparten base: no correrlos a la vez. Con los escenarios locales cargados fallan 15 pruebas RLS y 3 E2E de `menu.spec` por datos extra, no por el código. No se hizo `pnpm build` para no pisar el `.next` de los servidores `next start` del usuario (3000 y 3001, con el build anterior): el E2E de SuperAdmin corrió contra `next dev` en 3200.

## Próximo paso

Pedir al usuario si commitea y pasa la revisión de Codex del catálogo. Luego, el ítem desbloqueado del tablero: carga y publicación de videos con Mux (nivel C); necesita las credenciales del plan Free de Mux (ADR 0031), que debe aportar el usuario. La carga debe exigir `org_can_write` además de `has_feature('video_feed')` y contar el uso en `org_entitlements`.

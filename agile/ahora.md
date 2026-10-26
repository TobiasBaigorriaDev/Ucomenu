# Ahora (handoff)

Actualizado: 2026-10-26 · agente saliente: Claude. Historia en Git y fichas.

## Punto de retomada

**Resumen de la analítica con IA (nivel C): implementado y verificado en local; falta la revisión independiente, tu aprobación y staging.** En `/panel/{slug}/analitica` un botón «Generar resumen» redacta, con un servicio de IA, un párrafo, hallazgos y acciones para probar a partir de las cifras del período (7, 30 o 90 días; todas las sucursales o una). Solo el Dueño con el plan. Mínimo 5 pedidos, uno por período y alcance, no se regenera antes de 10 minutos. La [ficha](cambios/resumen-de-analitica-con-ia.md) tiene decisiones, invariantes y evidencia; el motivo duradero, el [ADR 0047](../docs/decisiones/0047-resumen-de-analitica-con-ia.md). Trae una migración nueva, `20261206100000` (tabla `analytics_summaries` y la función `save_analytics_summary`), **sin aplicar en staging**.

Hoy usa Gemini con la clave gratuita (la misma de las traducciones): **solo datos ficticios**. **Antes de usar ventas reales hay que pasar a Claude** y no cargar la clave gratuita en producción (anotado en `docs/produccion.md`). Sin clave, la función queda apagada.

Antes: la sugerencia de traducciones con IA está en staging (Fly v55) y el usuario la probó: «funciona bien» ([ficha](cambios/traduccion-automatica.md)).

Rama `main`, subida a `origin/main` hasta la sugerencia de traducciones; lo del resumen está en commits locales.

## Límites y bloqueos

- S4 (Clientes recurrentes) pasa al próximo incremento por decisión del usuario; sigue bloqueado por la revisión legal.
- Reinicios de QR (migración `20261204100000`): en staging desde Fly v53; falta tu prueba con sesión real y en teléfono ([ficha](cambios/reinicio-programado-qr.md)).
- Si Windows repite `0xC0000409` con `forks`, repetir ese archivo con `--pool=threads`. Si `pnpm build` falla con `EPERM` dentro de `.next`, borrar `.next` y repetir.
- Los setups pausan y restauran el cron local; si se mata una suite sin teardown, comprobar `cron.job` o resetear local.
- Preservar `tools/escenarios-locales.mjs`, ajeno y sin seguimiento.
- Producción continúa bloqueada por dominio, revisión legal y purgas. Rotar la clave legacy de staging sigue pendiente, fuera de alcance.

## Próximo paso

Terminar la verificación completa (RLS y E2E), pedir la revisión independiente (Codex, solo lectura) y, con tu aprobación, aplicar la migración y desplegar a staging para que lo pruebes con un Dueño. Siguiente migración libre: `20261207100000`.

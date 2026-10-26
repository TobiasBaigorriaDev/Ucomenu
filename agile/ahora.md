# Ahora (handoff)

Actualizado: 2026-10-25 · agente saliente: Claude. Historia en Git y fichas.

## Punto de retomada

**Analítica de pedidos para el Dueño: hecha, verificada en local y aprobada por la revisión independiente (Codex, 3 rondas); falta tu aprobación y staging.** Es el rework de `/panel/{slug}/analitica` para Pro y Premium: resumen contra el período anterior, ventas por día, mapa de franjas por día y hora, platos que más venden y que no se piden, ventas por categoría y anulaciones con motivos, con período de 7, 30 o 90 días (`?dias=`) y el filtro de sucursal de siempre; conserva platos más vistos y llamados por hora. Nivel **C** (lee ventas por organización). La [ficha](cambios/analitica-de-pedidos.md) concentra decisiones, aceptación, invariantes y evidencia; el motivo duradero está en el [ADR 0045](../docs/decisiones/0045-analitica-de-pedidos.md). Migración `20261205100000` (solo funciones de lectura y un índice), aplicada solo en la base local.

Rama `main`; los commits siguen locales, sin push.

## Límites y bloqueos

- Falta **tu aprobación** antes de aplicar la migración a staging: probala en local (`pnpm db:reset`, `pnpm dev`; para ver datos hay que sembrar pedidos cerrados, ver `tests/rls/escenario-analitica-pedidos.ts`).
- Reinicios de QR (migración `20261204100000`): en staging desde Fly v53; falta tu prueba con sesión real y en teléfono (ver su [ficha](cambios/reinicio-programado-qr.md)).
- `src/lib/idiomas/textos.test.ts` falla (la clave `feed.dockLink` vale «Menufeed» en los tres idiomas): ajeno a este cambio, sin corregir.
- Si Windows repite `0xC0000409` con `forks`, repetir ese archivo con `--pool=threads`. Si `pnpm build` falla con `EPERM` dentro de `.next`, borrar `.next` y repetir.
- Los setups pausan y restauran el cron local; si se mata una suite sin teardown, comprobar `cron.job` o resetear local.
- Preservar `tools/escenarios-locales.mjs`, ajeno y sin seguimiento.
- Producción continúa bloqueada por dominio, revisión legal y purgas. Rotar la clave legacy de staging sigue pendiente, fuera de alcance.

## Próximo paso

Con tu aprobación, aplicar `20261205100000` a staging y desplegar. Siguiente migración libre: `20261206100000`. Sin medir: la lectura con miles de pedidos por período.

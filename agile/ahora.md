# Ahora (handoff)

Actualizado: 2026-10-25 · agente saliente: Claude. Historia en Git y fichas.

## Punto de retomada

**Analítica de pedidos para el Dueño: en staging, Fly v54**, con la migración `20261205100000`, tras la revisión independiente (Codex, 3 rondas) y tu «Apruebo todo». Es el rework de `/panel/{slug}/analitica` para Pro y Premium: resumen contra el período anterior, ventas por día, mapa de franjas por día y hora, platos que más venden y que no se piden, ventas por categoría y anulaciones con motivos, con período de 7, 30 o 90 días (`?dias=`) y el filtro de sucursal de siempre; conserva platos más vistos y llamados por hora. Nivel **C** (lee ventas por organización). La [ficha](cambios/analitica-de-pedidos.md) concentra decisiones, aceptación, invariantes y evidencia; el motivo duradero está en el [ADR 0045](../docs/decisiones/0045-analitica-de-pedidos.md). La migración solo agrega dos funciones de lectura y un índice. La [ficha](cambios/analitica-de-pedidos.md) tiene la evidencia local y remota.

Rama `main`; los commits siguen locales, sin push.

## Límites y bloqueos

- Falta tu prueba en staging con una sesión de Dueño Pro: la demo no tiene pedidos cerrados, así que se ve el estado vacío hasta que se cierren mesas; para ver datos en local, sembrar con `tests/rls/escenario-analitica-pedidos.ts`.
- Reinicios de QR (migración `20261204100000`): en staging desde Fly v53; falta tu prueba con sesión real y en teléfono (ver su [ficha](cambios/reinicio-programado-qr.md)).
- `src/lib/idiomas/textos.test.ts` falla (la clave `feed.dockLink` vale «Menufeed» en los tres idiomas): ajeno a este cambio, sin corregir.
- Si Windows repite `0xC0000409` con `forks`, repetir ese archivo con `--pool=threads`. Si `pnpm build` falla con `EPERM` dentro de `.next`, borrar `.next` y repetir.
- Los setups pausan y restauran el cron local; si se mata una suite sin teardown, comprobar `cron.job` o resetear local.
- Preservar `tools/escenarios-locales.mjs`, ajeno y sin seguimiento.
- Producción continúa bloqueada por dominio, revisión legal y purgas. Rotar la clave legacy de staging sigue pendiente, fuera de alcance.

## Próximo paso

Recibir tu prueba de la analítica en staging. Siguiente migración libre: `20261206100000`. Sin medir: la lectura con miles de pedidos por período.

# Ahora (handoff)

Actualizado: 2026-10-25 · agente saliente: Claude. Historia en Git y fichas.

## Punto de retomada

**Sugerencia de traducciones con IA: implementada y verificada en local**, falta probarla con una clave real de Gemini. En `/panel/{slug}/carta/traducciones` un botón «Sugerir con IA lo que falta en {idioma}» completa solo los campos vacíos (resaltados); el local revisa y guarda como siempre. Nivel **M**. La [ficha](cambios/traduccion-automatica.md) tiene decisiones, aceptación y evidencia; el motivo duradero está en el [ADR 0046](../docs/decisiones/0046-sugerencia-de-traducciones-con-ia.md). El proveedor está detrás de una interfaz: hoy Gemini (clave gratuita, para local y staging con datos ficticios); en producción el usuario quiere pasar a **Claude** si todo va bien (otra implementación en `getTranslationProvider()`, con su clave y aprobación).

Para probarla: poner `GEMINI_API_KEY` en `.env.local` (clave de Google AI Studio; ver `.env.example`) y `pnpm dev`; en staging, `fly secrets set` con aprobación. Sin la clave, el botón no aparece.

Antes: la analítica de pedidos del Dueño quedó en staging (Fly v54), probada por el usuario ([ficha](cambios/analitica-de-pedidos.md)).

Rama `main`; los commits siguen locales, sin push.

## Límites y bloqueos

- S4 (Clientes recurrentes) se pasa al próximo incremento por decisión del usuario; sigue bloqueado por la revisión legal.
- Reinicios de QR (migración `20261204100000`): en staging desde Fly v53; falta tu prueba con sesión real y en teléfono ([ficha](cambios/reinicio-programado-qr.md)).
- Si Windows repite `0xC0000409` con `forks`, repetir ese archivo con `--pool=threads`. Si `pnpm build` falla con `EPERM` dentro de `.next`, borrar `.next` y repetir.
- Los setups pausan y restauran el cron local; si se mata una suite sin teardown, comprobar `cron.job` o resetear local.
- Preservar `tools/escenarios-locales.mjs`, ajeno y sin seguimiento.
- Producción continúa bloqueada por dominio, revisión legal y purgas. Rotar la clave legacy de staging sigue pendiente, fuera de alcance.

## Próximo paso

Probar la sugerencia con la clave real (calidad de nombres propios al inglés y portugués) y, si convence, decidir cuándo sumar el proveedor Claude. Después, elegir la próxima tarea del tablero. Siguiente migración libre: `20261206100000`.

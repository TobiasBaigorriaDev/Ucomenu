# Ahora (handoff)

Actualizado: 2026-10-21 · agente saliente: Claude · historial anterior en `agile/historial.md`.

## Punto de retomada

**Borrado de categorías y platos (C) implementado y probado en local**, sin aprobación humana todavía. Rama `main`; implementación `9ce17a1` y corrección `33d0c1c`. [Ficha](cambios/borrado-de-categorias-y-platos.md) y [ADR 0029](../docs/decisiones/0029-borrado-de-categorias-y-platos.md) (propuesta). No hay migración ni permisos nuevos: la RLS ya permitía el `DELETE` a Dueño y Staff con la cuenta al día.

- El plato se borra desde su pantalla y la categoría desde su cabecera, en dos pasos. Una categoría con platos pide el nombre exacto y que la cantidad vista coincida (lo comprueba el servidor).
- Las fotos de Storage se limpian **después** de confirmar el borrado de la fila; si falla, la pantalla avisa y el log lleva los ids.
- El historial de precios se conserva («Plato eliminado»); variantes, adicionales, disponibilidad, traducciones y vistas contadas se van con el plato.
- Revisión de Codex: ronda 1 con un hallazgo real (un plato movido de categoría durante el borrado perdía su foto), corregido con regresión; ronda 2 **APROBAR** sin hallazgos. Detalle en la ficha.

Sin desplegar: ni `origin` ni staging tienen este cambio.

Integrado antes: [borrado de organizaciones](cambios/borrado-de-organizaciones.md) en staging (Fly v15); retenciones de `price_history` y pagos; [add-ons y baja](cambios/addons-y-baja-de-organizaciones.md) y [anular pagos](cambios/anular-pagos.md) en staging, falta la prueba manual del usuario con SuperAdmin.

Investigación abierta: [vencimiento en iPhone](cambios/ticket-de-visita.md#investigación-en-teléfono-real--2026-10-20).

## Bloqueos y riesgos

- **Producción:** bloqueada (dominio, Supabase de producción, revisión legal; ficha `salida-a-produccion`).
- **Plazo de 10 años de los pagos:** por confirmar con el contador antes de producción.
- Borrado de carta: irreversible; solo el respaldo (`pnpm respaldo`) lo cubre. Pregunta abierta para el usuario: ¿el Staff debe poder borrar una categoría entera, o solo el Dueño? Hoy pueden ambos (con el nombre escrito).
- E2E: usar `--workers=1`. RLS completo ~12 min; RLS y E2E no se corren a la vez. Un worker caído con `0xC0000409` se repite una vez.

## Próximo paso

1. El usuario aprueba (y decide lo del Staff); recién entonces subir a `origin` y, si quiere, desplegar a staging.
2. Prueba manual del usuario del borrado en staging, con SuperAdmin y de organizaciones.

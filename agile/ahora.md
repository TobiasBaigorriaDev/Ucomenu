# Ahora (handoff)

Actualizado: 2026-11-01 · agente saliente: Codex.

## Punto de retomada

En `main`. Último commit al empezar esta tarea: `51961a7`. El usuario pidió poblar La Bestia Burger & Bar en staging para probar la pestaña Analítica como si hubiera vendido durante los últimos 80 días. La carga está aplicada en el proyecto `oasixhsdyigimwvcxtkx`, organización `la-bestia`, sucursal Centro. Alcance, identificación del lote, evidencia y recuperación en [la ficha](cambios/ventas-demo-bestia.md); SQL reproducible en `tools/ventas-bestia-staging.sql`. No volver a ejecutarlo: rechaza duplicados deliberadamente.

No hubo cambios de aplicación ni despliegue en esta tarea. Los pedidos previos, el catálogo, los planes y los permisos se conservaron. El lote tiene únicamente pedidos terminados y datos ficticios. Los contadores de vistas anteriores tampoco se sobrescribieron. La comprobación fue con las funciones reales que lee Analítica; falta la inspección visual del usuario. Los gráficos consideran días calendario: hoy todavía puede aparecer vacío porque se cargaron los 80 días completos anteriores, hasta el 31 de octubre.

Staging continúa en Fly v91, imagen `tutorial-bd0cd25-git`. El tutorial aparece dentro de «Primeros pasos» del Resumen mientras la guía esté pendiente y visible; respeta el ocultamiento existente. No requiere cambios de base. La migración aplicada era `20261216100000`; siguiente libre `20261217100000`. Consultar Git y Fly antes de continuar.

## Bloqueos y próximo paso

Próximo paso: abrir `/panel/la-bestia/analitica?dias=90` en staging con el dueño y explorar períodos, ventas, platos y categorías. El usuario también debe probar el tutorial en teléfono y Suscripción, y revisar los textos legales.

Antes de producción siguen pendientes los datos legales y contacto definitivo, contador y abogado, infraestructura de producción y respaldo ensayado. Los cron pendientes están en `docs/produccion.md` (4.b, 4.c y 4.e). No se tocaron en esta sesión.

Preservar los archivos ajenos sin seguimiento: `video/`, `.codegraph/`, capturas y herramientas locales, skills de terceros, `skills-lock.json` y `.claude/launch.json`.

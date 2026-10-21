# Ahora (handoff)

Actualizado: 2026-10-20 · agente saliente: Claude · historial anterior en `agile/historial.md`.

## Punto de retomada

Dos retenciones decididas por el usuario, para desbloquear el borrado de organizaciones:
- **`price_history`** ([ficha](cambios/purga-de-price-history.md), [ADR 0026](../docs/decisiones/0026-purga-del-historial-de-precios.md)): integrada y subida a `origin` (`6f14a10`, `1f4a4ec`), aprobada por Codex. Se purga con la organización, tras 30 días de baja auditada.
- **`payments` y `payment_voids`** ([ficha](cambios/retencion-de-pagos.md), [ADR 0027](../docs/decisiones/0027-retencion-de-pagos.md)): implementada y probada en local, **sin revisión independiente ni integración**. Sobreviven al borrado de la organización (se quitaron las claves foráneas), se conservan 10 años y después se purgan con `private.purge_expired_payments`, que ningún rol de la API ejecuta. Migración `20261101100000_retencion_de_pagos.sql`.

Ninguna migración nueva está en staging ni en producción.

Integrado antes: [add-ons y baja de organizaciones](cambios/addons-y-baja-de-organizaciones.md) y [anular pagos](cambios/anular-pagos.md), ambos en staging; falta la prueba manual del usuario con SuperAdmin.

Investigación abierta: [vencimiento en iPhone](cambios/ticket-de-visita.md#investigación-en-teléfono-real--2026-10-20); falta distinguir recarga de pestaña conservada.

## Bloqueos y riesgos

- **Producción:** bloqueada (dominio, Supabase de producción, revisión legal; ficha `salida-a-produccion`).
- **Plazo de 10 años de los pagos:** por confirmar con el contador antes de producción.
- **Borrar organizaciones:** desbloqueado en el tablero. La acción tiene que, en una transacción: recomprobar al SuperAdmin, exigir baja de 30 días, slug escrito y motivo, llamar `private.purge_organization_price_history`, borrar y auditar `organization.deleted` con slug y nombre (identifica los pagos huérfanos).
- Un `DELETE` de organización ya no se frena por los pagos (ADR 0027): la barrera será esa acción.
- E2E: usar `--workers=1`. RLS completo ~12 min; RLS y E2E no se corren a la vez.

## Próximo paso

1. Revisión independiente de la retención de pagos (C, una ronda: `ciclo-revision-codex`) y aprobación del usuario para integrar.
2. Implementar el borrado de organizaciones en SuperAdmin (C).
3. El usuario prueba en staging add-ons, baja/reactivación y anular pagos.
4. Completar el diagnóstico del iPhone.

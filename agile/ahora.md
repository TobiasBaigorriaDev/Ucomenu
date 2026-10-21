# Ahora (handoff)

Actualizado: 2026-10-20 · agente saliente: Codex · historial anterior en `agile/historial.md`.

## Punto de retomada

**Retención de pagos integrada y desplegada en staging**, por pedido explícito del usuario tras la revisión independiente. Rama `main`; código publicado y desplegado: `0321dfc` (implementación `2c0e5e0`, tipos corregidos `a172d53`). La documentación de cierre queda en el commit posterior; no hay cambios funcionales adicionales.

Las dos retenciones decididas para desbloquear el borrado de organizaciones están en `origin` y en staging:
- **`price_history`** ([ficha](cambios/purga-de-price-history.md), [ADR 0026](../docs/decisiones/0026-purga-del-historial-de-precios.md)): se purga con la organización, tras 30 días de baja auditada.
- **`payments` y `payment_voids`** ([ficha](cambios/retencion-de-pagos.md), [ADR 0027](../docs/decisiones/0027-retencion-de-pagos.md)): sobreviven al borrado de la organización y se conservan 10 años; la función privada de purga no está disponible para la API. Evidencia y recuperación del despliegue en la ficha de pagos.

Se aplicaron las migraciones pendientes; no se ejecutó ni programó ninguna purga, no se borraron organizaciones ni se cambiaron secretos. Producción no se tocó.

Integrado antes: [add-ons y baja de organizaciones](cambios/addons-y-baja-de-organizaciones.md) y [anular pagos](cambios/anular-pagos.md), ambos en staging; falta la prueba manual del usuario con SuperAdmin.

Investigación abierta: [vencimiento en iPhone](cambios/ticket-de-visita.md#investigación-en-teléfono-real--2026-10-20); falta distinguir recarga de pestaña conservada.

## Bloqueos y riesgos

- **Producción:** bloqueada (dominio, Supabase de producción, revisión legal; ficha `salida-a-produccion`).
- **Plazo de 10 años de los pagos:** por confirmar con el contador antes de producción.
- **Borrar organizaciones:** desbloqueado en el tablero. La acción tiene que, en una transacción: recomprobar al SuperAdmin, exigir baja de 30 días, slug escrito y motivo, llamar `private.purge_organization_price_history`, borrar y auditar `organization.deleted` con slug y nombre (identifica los pagos huérfanos).
- Un `DELETE` de organización ya no se frena por los pagos, también en staging (ADR 0027): la barrera será esa acción.
- E2E: usar `--workers=1`. RLS completo ~12 min; RLS y E2E no se corren a la vez.

## Próximo paso

1. Implementar el borrado de organizaciones en SuperAdmin (C), cuando el usuario lo seleccione.
2. El usuario prueba en staging add-ons, baja/reactivación y anular pagos.
3. Completar el diagnóstico del iPhone.

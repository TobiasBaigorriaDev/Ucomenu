# Ahora (handoff)

Actualizado: 2026-10-20 · agente saliente: Claude · historial anterior en `agile/historial.md`.

## Punto de retomada

**Borrado definitivo de organizaciones (C) implementado y probado en local**, rama `main`, commit de implementación local (sin subir a `origin`). [Ficha](cambios/borrado-de-organizaciones.md) y [ADR 0028](../docs/decisiones/0028-borrado-definitivo-de-organizaciones.md).

- Una función de base `admin_delete_organization` (migración `20261102100000`) hace, en una transacción: SuperAdmin recomprobado, motivo, slug escrito, baja auditada de 30 días (vía la purga de `price_history`), borrado y auditoría `organization.deleted` con slug y nombre. Los pagos y las cuentas de Auth se conservan.
- El servidor borra los archivos de Storage **después** de confirmar la transacción; si falla, la lista de `/admin` lo avisa.
- Pantalla: sección «Borrar definitivamente» en `/admin/organizaciones/{slug}`.
- Evidencia en la ficha (RLS completo 835/835, unitarias 680/680, E2E del borrado y vecinas, mutaciones).

Pendiente de este cambio: revisión independiente de Codex (`ciclo-revision-codex`), aprobación humana, y recién entonces integrar, subir a `origin`, aplicar la migración en staging y desplegar (todo requiere pedido explícito del usuario).

Integrado antes: retenciones de `price_history` y pagos (staging Fly v14); [add-ons y baja](cambios/addons-y-baja-de-organizaciones.md) y [anular pagos](cambios/anular-pagos.md) en staging, falta la prueba manual del usuario con SuperAdmin.

Investigación abierta: [vencimiento en iPhone](cambios/ticket-de-visita.md#investigación-en-teléfono-real--2026-10-20).

## Bloqueos y riesgos

- **Producción:** bloqueada (dominio, Supabase de producción, revisión legal; ficha `salida-a-produccion`).
- **Plazo de 10 años de los pagos:** por confirmar con el contador antes de producción.
- Borrado: irreversible; solo el respaldo (`pnpm respaldo`) lo cubre. Archivos de Storage sueltos posibles si el servidor se corta justo después del borrado (riesgo aceptado, ADR 0028).
- E2E: usar `--workers=1`. RLS completo ~12 min; RLS y E2E no se corren a la vez. Un worker caído con `0xC0000409` se repite una vez.

## Próximo paso

1. Revisión de Codex del borrado y correcciones; luego aprobación humana.
2. El usuario prueba en staging add-ons, baja/reactivación y anular pagos.
3. Decidir qué pasa con las cuentas que quedan sin local; completar el diagnóstico del iPhone.

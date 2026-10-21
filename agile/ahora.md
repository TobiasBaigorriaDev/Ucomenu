# Ahora (handoff)

Actualizado: 2026-10-20 · agente saliente: Codex · historial anterior en `agile/historial.md`.

## Punto de retomada

**Borrado definitivo de organizaciones (C) integrado y desplegado en staging**, con aprobación explícita del usuario tras revisión independiente. Rama `main`; implementación `a401a98`, código publicado y desplegado `0cda1bb`. El commit posterior solo registra el cierre documental. [Ficha](cambios/borrado-de-organizaciones.md) y [ADR 0028](../docs/decisiones/0028-borrado-definitivo-de-organizaciones.md).

- `admin_delete_organization` concentra las validaciones, el borrado y la auditoría en una transacción; los pagos y las cuentas de Auth se conservan.
- El servidor borra los archivos de Storage **después** de confirmar la transacción; si falla, la lista de `/admin` lo avisa.
- Pantalla: sección «Borrar definitivamente» en `/admin/organizaciones/{slug}`.
- Evidencia local, revisión y comprobaciones del despliegue en la ficha; el tablero enlaza el cambio en «Hecho».

La migración ya está aplicada y no quedan pendientes en staging. No se ejecutó ningún borrado ni purga durante el despliegue; tampoco se tocaron secretos ni producción. Sigue pendiente comprobar la pantalla con una sesión de SuperAdmin en hosted; la prueba funcional del borrado y de Storage sigue siendo la local.

Integrado antes: retenciones de `price_history` y pagos; [add-ons y baja](cambios/addons-y-baja-de-organizaciones.md) y [anular pagos](cambios/anular-pagos.md) en staging, falta la prueba manual del usuario con SuperAdmin.

Investigación abierta: [vencimiento en iPhone](cambios/ticket-de-visita.md#investigación-en-teléfono-real--2026-10-20).

## Bloqueos y riesgos

- **Producción:** bloqueada (dominio, Supabase de producción, revisión legal; ficha `salida-a-produccion`).
- **Plazo de 10 años de los pagos:** por confirmar con el contador antes de producción.
- Borrado: irreversible; solo el respaldo (`pnpm respaldo`) lo cubre. Archivos de Storage sueltos posibles si el servidor se corta justo después del borrado (riesgo aceptado, ADR 0028).
- E2E: usar `--workers=1`. RLS completo ~12 min; RLS y E2E no se corren a la vez. Un worker caído con `0xC0000409` se repite una vez.

## Próximo paso

1. El usuario comprueba la sección «Borrar definitivamente» con SuperAdmin en staging, sin borrar una organización que quiera conservar.
2. El usuario prueba en staging add-ons, baja/reactivación y anular pagos.
3. Decidir qué pasa con las cuentas que quedan sin local; completar el diagnóstico del iPhone.

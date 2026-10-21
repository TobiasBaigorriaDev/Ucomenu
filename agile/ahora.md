# Ahora (handoff)

Actualizado: 2026-10-20 · agente saliente: Claude · historial anterior en `agile/historial.md`.

## Punto de retomada

Implementado y probado en local, **sin revisión independiente ni integración**: [retención y purga de `price_history`](cambios/purga-de-price-history.md) (C, [ADR 0026](../docs/decisiones/0026-purga-del-historial-de-precios.md)). Política elegida por el usuario: el historial se purga con la organización, solo tras 30 días de baja auditada; la única vía es `private.purge_organization_price_history`, que apaga el trigger de solo-agregado dentro de la transacción y que ningún rol de la API ejecuta. Migración `20261031100000_purga_de_price_history.sql`, sin cambios de tipos. No se desplegó nada; staging y producción no se tocaron.

Integrado antes: [add-ons y baja de organizaciones](cambios/addons-y-baja-de-organizaciones.md) (en `main`, migración y app en staging; falta la prueba manual del usuario con SuperAdmin en `/admin/organizaciones/{slug}`) y [anular pagos](cambios/anular-pagos.md) (también falta su prueba manual).

Investigación abierta: [vencimiento en iPhone](cambios/ticket-de-visita.md#investigación-en-teléfono-real--2026-10-20); falta distinguir recarga de pestaña conservada. Sin cambios funcionales.

## Bloqueos y riesgos

- **Producción:** bloqueada (dominio, Supabase de producción, revisión legal; ficha `salida-a-produccion`).
- **Borrar organizaciones:** sigue bloqueado por la retención de `payments` y `payment_voids` (decisión del usuario, con su parte contable/legal). Cuando exista, esa acción tiene que llamar la función de purga en la misma transacción y exigir slug escrito, motivo y `organization.deleted` en `audit_log`.
- E2E: usar `--workers=1`. RLS completo ~12 min; RLS y E2E no se corren a la vez.
- Una baja pública devuelve 404; un «no disponible» para quien escanea un QR es una mejora aparte.

## Próximo paso

1. Revisión independiente de la purga (nivel C, una ronda: `ciclo-revision-codex` o sesión limpia), corregir si hay hallazgos y pedir al usuario la aprobación de integrar.
2. El usuario prueba en staging add-ons, baja/reactivación y anular pagos.
3. Decidir con el usuario la retención de `payments`/`payment_voids` para desbloquear el borrado de organizaciones.
4. Completar el diagnóstico del iPhone y elegir del [tablero](tablero.md) un ítem desbloqueado.

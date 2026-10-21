# Cambio: Retención y purga de `payments` y `payment_voids`
Estado: **implementado y verificado en local; sin revisión independiente todavía** (nivel C). Política elegida por el usuario el 2026-10-20; el plazo de 10 años queda por confirmar con el contador.
Nivel: C (dinero + eliminación irreversible de registros contables)

## Objetivo
Decidir qué pasa con los cobros de UcoMenu cuando se borra una organización y dejar construido el único camino para purgarlos, para desbloquear el borrado definitivo en SuperAdmin. Motivos duraderos: [ADR 0027](../../docs/decisiones/0027-retencion-de-pagos.md).

## Decisiones
1. **Política (usuario, 2026-10-20):** los pagos y anulaciones se **conservan** al borrar la organización (sin clave foránea), por **10 años**, y se entrega **ahora** la función de purga por vencimiento.
2. **Migración** `20261101100000_retencion_de_pagos.sql`: quita las 4 claves foráneas (`payments` y `payment_voids` → `organizations` y `subscriptions`; queda `payment_voids.payment_id → payments`), amplía el `check` de `audit_log.action` con `payments.purged` y crea `private.purge_expired_payments(p_actor, p_reason)`.
3. **Purga:** solo pagos con `created_at` de hace más de 10 años **y organización inexistente**, con sus anulaciones; SuperAdmin responsable + motivo (1–200); auditoría `payments.purged` (sin nada que purgar, no deja auditoría). Sin EXECUTE para ningún rol de la API; se corre a mano como `postgres` con aprobación.
4. **Pantalla:** `src/app/admin/audit.tsx` muestra la acción nueva («Pagos antiguos purgados», cantidades y corte). El Dueño no la ve (no está en su lista blanca).
5. **Pruebas existentes cambiadas:** las dos que exigían `RESTRICT` (`planes-pagos`: «no se borra en cascada por accidente»; `anular-pagos`: «RESTRICT desde payment_voids») ahora comprueban lo contrario (el borrado se permite y los pagos quedan) y limpian los huérfanos con `purgePaymentsWhere`.
6. **Fuera de alcance:** la acción de borrado de organizaciones, programar la purga, mostrar pagos huérfanos en alguna pantalla.

## Aceptación
- [x] `payments` y `payment_voids` no tienen clave foránea hacia organizaciones ni suscripciones; la anulación sigue atada a su pago.
- [x] Borrar una organización con pagos y anulaciones la borra y deja los pagos y anulaciones intactos.
- [x] Quien llama tiene que ser SuperAdmin (otra cuenta, un id inexistente o `null` → `not_platform_admin`) y dar un motivo de 1 a 200 (`invalid_reason`); rechazado, no se borra nada.
- [x] Borra los pagos de organizaciones borradas registrados hace **más de 10 años** (también 10 años y 1 día) con sus anulaciones; deja los de 9 años y 364 días, los recientes y **los de una organización que existe aunque tengan 11 años** (con sus anulaciones).
- [x] Deja una auditoría `payments.purged` con el responsable, las cantidades, el corte y el motivo; sin nada que purgar devuelve 0/0 y no audita.
- [x] Los dos triggers de solo-agregado quedan encendidos después de purgar y si la transacción que llama falla o se revierte (los pagos y las anulaciones vuelven enteros; sin auditoría).
- [x] Ningún rol de la API (`anon`, `authenticated`, `service_role`, `public`) tiene EXECUTE; `SECURITY DEFINER` de `postgres`, `search_path` vacío (matriz de `acl.rls.test.ts`).

## Evidencia
Base local (`pnpm db:reset` con la migración nueva), 2026-10-20; el commit probado se anota al integrar:
- `tests/rls/retencion-de-pagos.rls.test.ts` **7/7**; `planes-pagos`, `anular-pagos` y `acl` OK con los cambios.
- **Mutaciones (9, de a una, todas detectadas):** sin `enable trigger` (3 pruebas), plazo de 10 años a 0 (1), purgar también organizaciones vivas (4), sin comprobar al SuperAdmin (1), sin auditoría (1), sin validar el motivo (1), sin borrar las anulaciones (4), `EXECUTE` para `service_role` (1), volver a poner la clave foránea (5).
- `pnpm test` 666/666 · `pnpm lint` y `pnpm typecheck` OK. `pnpm test:rls` completo **813/813** (36 archivos; sin restos `tt-*`/`e2e-*` ni pagos huérfanos). Sin E2E ni build (solo cambia una etiqueta de la auditoría de `/admin`).

## Revisión y aprobación
- Codex, ronda 1 (commit `2c0e5e0`): **APROBAR CON CAMBIOS**. Un hallazgo, **real y corregido**: `database.types.ts` seguía declarando las 4 claves foráneas quitadas (AGENTS.md exige `pnpm db:types` al cambiar el esquema). Regenerado: el diff solo borra esas relaciones; typecheck y lint OK. Sin regresión funcional (ninguna consulta las usaba).

## (C) Invariantes
- Un pago solo se borra si tiene más de 10 años y su organización ya no existe; una anulación solo se borra junto con su pago.
- Los triggers de solo-agregado no quedan apagados al terminar, salga bien o mal la transacción.
- La API (ni `service_role`) no puede llamar la purga ni apagar los triggers; toda purga que borra algo deja auditoría atribuida.

## (C) Fallas y recuperación
- Cualquier fallo o rollback deja las filas y los triggers como estaban. Una purga confirmada **no se recupera** (solo el respaldo de `docs/operacion.md`).
- Quitar las claves foráneas es irreversible solo si ya hay pagos huérfanos (no se pueden recrear); rollback en el encabezado de la migración.
- Riesgo aceptado: un `DELETE` de organización ya no se frena por los pagos; la barrera es la acción de borrado prevista (ADR 0027).

## (C) Aprobación humana
Política aceptada por el usuario el 2026-10-20 (ADR 0027). Falta la revisión independiente y la aprobación de integrar. Por confirmar con el contador: el plazo de 10 años y desde cuándo se cuenta.

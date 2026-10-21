# Cambio: Retención y purga de `price_history`
Estado: **implementado, verificado en local y aprobado por Codex (1 ronda); integrado a `main` y subido a `origin` el 2026-10-20 por pedido del usuario (commits `6f14a10` y `1f4a4ec`)** (nivel C). Política elegida por el usuario el 2026-10-20.
Nivel: C (eliminación irreversible de un registro de auditoría de precios, con ids de personas)

## Objetivo
Definir y dejar construido el único camino por el que se puede borrar el historial de precios (ADR 0012 lo bloqueaba a propósito), como prerrequisito del borrado de organizaciones en SuperAdmin. Los motivos duraderos están en el [ADR 0026](../../docs/decisiones/0026-purga-del-historial-de-precios.md).

## Decisiones
1. **Política (usuario, 2026-10-20):** se purga con la organización (sin plazo mientras exista); solo tras **30 días de baja auditada**; el borrado exigirá el **slug escrito**; mecanismo: **función de base dedicada**; alcance: **solo `price_history`** (pagos y anulaciones, en el ítem del borrado).
2. **Entregado:** `private.purge_organization_price_history(p_org uuid) returns integer` (migración `20261031100000_purga_de_price_history.sql`). Sin EXECUTE para `anon`, `authenticated`, `service_role` ni `public`.
3. **No entregado a propósito:** la acción de SuperAdmin que la llama (slug escrito, motivo, `organization.deleted` en `audit_log`, `DELETE` de la organización): es el ítem «SuperAdmin: borrar y purgar organizaciones», que sigue bloqueado por la retención de `payments` y `payment_voids`.
4. **Auditoría:** el usuario no marcó «auditoría que sobrevive» entre las salvaguardas; se la dejó como requisito del borrado porque todas las acciones de SuperAdmin la escriben (ADR 0013) y la purga es irreversible. Si no la quiere, se quita ahí.
5. **Respaldo previo:** no se exige en la función (el usuario no lo marcó); queda anotado en el ADR como recordatorio para el borrado.

## Aceptación
- [x] Organización activa → `organization_still_active`; inexistente → `organization_not_found`; sin nada borrado ni trigger apagado.
- [x] Inactiva sin baja auditada (puesta a mano), con la baja de otra organización, o reactivada y vuelta a inactivar a mano → `deactivation_not_audited`.
- [x] Baja de menos de 30 días (también a 1 minuto del plazo) → `deactivation_too_recent`; con una baja nueva después de una reactivación manda la más reciente.
- [x] Con baja de 30 días o más borra solo el historial de esa organización y devuelve cuántas filas; la vecina no pierde nada; la organización, el plato y la auditoría quedan.
- [x] El trigger de solo-agregado queda **encendido** después de purgar, y también si la transacción que llama falla o hace `ROLLBACK` (el historial vuelve entero).
- [x] Idempotente (segunda llamada = 0) y purga las filas que el servicio técnico haya generado después.
- [x] Después de purgar, la organización (sin pagos) se puede borrar; antes, `RESTRICT` lo impide (23503).
- [x] Ningún rol de la API (`anon`, `authenticated`, `service_role`, `public`) tiene EXECUTE; es `SECURITY DEFINER` de `postgres` con `search_path` vacío (matriz de `acl.rls.test.ts`).
- [x] La purga toma el lock de la organización: una reactivación concurrente espera a que termine.

## Evidencia
Base local, `pnpm db:reset` con la migración nueva, 2026-10-20 (commit probado: se anota al integrar):
- `tests/rls/purga-de-price-history.rls.test.ts` **19/19** y `acl.rls.test.ts` (matriz con la función nueva) OK.
- **Mutaciones (8, de a una, todas detectadas):** sin `enable trigger` (3 pruebas), plazo de 30 días a 0 (2), sin comprobar la auditoría (3), ignorar `is_active` (2), sin el lock (1), borrar todas las organizaciones (2), tomar el primer evento en vez del último (2), `EXECUTE` para `service_role` (1).
- `pnpm test:rls` completo **806/806** (35 archivos, base reseteada con la migración; sin restos `tt-*`/`e2e-*`) · `pnpm lint` y `pnpm typecheck` OK. No se corrieron E2E ni build: no hay cambios de interfaz ni de aplicación. Sin cambios de tipos (función privada).

## (C) Invariantes
- Solo se borran filas de `price_history` de la organización pedida, solo si está dada de baja y auditada hace 30 días o más; nada más (ni organización, ni platos, ni auditoría).
- El trigger de solo-agregado no queda apagado al terminar, salga bien o mal la transacción.
- La API no puede llamarla ni apagar el trigger.

## (C) Fallas y recuperación
- Cualquier fallo o rollback deja el historial y el trigger como estaban. Una vez confirmada la transacción, **no se recupera** (solo del respaldo de `docs/operacion.md`).
- Rollback de la migración: `drop function private.purge_organization_price_history(uuid);` (no toca datos).

## Revisión y aprobación
- Codex (solo lectura, `pnpm revision:codex --commit HEAD`, commit `6f14a10`), 1 ronda: **APROBAR**, sin hallazgos. Aclaró que no ejecutó migraciones, suites ni mutaciones (la evidencia de arriba es la mía, no reproducida por él). El veredicto no reemplaza la aprobación humana.

## (C) Aprobación humana
Política aceptada por el usuario el 2026-10-20 (ADR 0026). Integración pedida por el usuario el 2026-10-20, tras la revisión.

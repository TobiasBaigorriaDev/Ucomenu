# Cambio: Borrar mesas (junto con su historial de llamados)
Estado: **para verificar** — implementado y probado en local; aprobado por Codex (`596704a`); falta la aprobación humana
Nivel: C (eliminación irreversible: la mesa, su QR impreso y los llamados que cuelgan de ella; y un permiso de `DELETE` nuevo sobre `tables`)

## Objetivo
Hoy una mesa solo se desactiva ([mesas y QR](mesas-y-qr.md), decisión 3: «quitar una mesa con historial de llamados se resuelve cuando existan los llamados»). Que el Dueño y el Staff puedan **borrar una mesa de verdad** desde `/panel/{slug}/mesas`, resolviendo qué pasa con sus llamados.

## Decisiones
1. **Los llamados se van con la mesa (cascada, ya existente).** `waiter_calls` tiene clave foránea compuesta a `tables` con `ON DELETE CASCADE` y ya se probó que borrar la mesa borra sus llamados (`waiter-calls.rls.test.ts`). Es coherente con el [ADR 0014](../../docs/decisiones/0014-purga-de-waiter-calls.md): el historial de llamados dura como máximo 14 días, no contiene dinero ni lo usa ninguna regla de la base (cooldown ≤ 1 h, vencimiento 30 min) y el único consumidor es la estadística «llamados por franja horaria» (últimos 14 días): perder los de una mesa que ya no existe es aceptable y se avisa. **No** se agrega snapshot de la etiqueta ni se guardan llamados huérfanos.
2. **Quién:** Dueño y Staff, igual que crear, renombrar, activar y regenerar el QR (`producto.md`, gestión de mesas). Con la cuenta al día; en solo lectura y suspendida no se borra (como el resto de las escrituras de catálogo).
3. **Una migración mínima:** `grant delete on public.tables to authenticated` + política `DELETE` (`is_org_member` y `org_can_write`), el mismo par que `UPDATE`. Nada más cambia en el esquema. Reemplaza el «sin DELETE» de la migración de mesas.
4. **Con el cliente de la persona (RLS)**; un `DELETE` descartado (0 filas) nunca se informa como éxito (se pide `.select("id")`).
5. **Confirmación en dos pasos, sin escribir nada:** el botón «Borrar mesa» solo abre la explicación (qué se pierde y que el QR impreso deja de funcionar); recién el segundo botón borra. Una mesa es barata de recrear y no guarda dinero ni datos personales: no hace falta escribir el nombre (sí se hizo con categorías con platos).
6. **El QR impreso de una mesa borrada responde el mismo 404 que uno desconocido o regenerado** (`/t/{token}`), sin revelar nada; no hay forma de «reaprovechar» el token. Un nombre libre se puede reutilizar: la mesa nueva tiene token nuevo.
7. **Cupo:** borrar una mesa activa libera lugar en el tope de mesas activas de la sucursal.
8. **Tras borrar** se vuelve a `/panel/{slug}/mesas` con el aviso («Mesa borrada. Sus llamados también se borraron y el QR impreso ya no funciona»), y se refresca el panel.

## Aceptación
- [x] Dueño y Staff borran una mesa: desaparece de la lista y de la hoja imprimible, y el `/t/{token}` de esa mesa responde 404.
- [x] Sus llamados (pendientes y atendidos) se borran; los de otras mesas y los llamados de la sucursal no cambian; el panel de sala deja de mostrar los pendientes de esa mesa.
- [x] Una mesa de otra organización (id manipulado) responde «no encontrado» y no se borra; nadie sin membresía ni `anon` borra por la API.
- [x] En solo lectura y suspendida no se borra (Dueño y Staff), ni con el formulario forzado ni con la comprobación del estado desactualizada.
- [x] Borrar una mesa activa libera cupo; el nombre se puede reutilizar y la mesa nueva no hereda llamados ni token.
- [x] Borrar dos veces (dos personas a la vez) no es un éxito: la segunda recibe «no encontrado».
- [x] A 390 px sin desborde; ningún borrado con un solo toque.

## Alcance / fuera de alcance
- Incluye: migración, `deleteTable` en `src/lib/mesas/tables.ts`, acción, formulario de confirmación y aviso, pruebas de base (RLS/ACL) y E2E, `producto.md`, tablero, handoff y un ADR corto.
- No incluye: borrar sucursales; borrado en lote; conservar estadísticas de los llamados de mesas borradas; deshacer.

## (C) Invariantes
1. Solo un miembro de la organización con la cuenta al día borra, y solo mesas de su organización (RLS + `organization_id` en la consulta).
2. Los llamados de la mesa no sobreviven a la mesa y los de otras mesas nunca se tocan.
3. Un token borrado nunca resuelve (404 indistinguible del desconocido).
4. Ningún rol anónimo borra; ninguna otra tabla gana permisos.
5. Un `DELETE` bloqueado jamás se muestra como éxito.

## (C) Fallos y recuperación
| Falla | Resultado |
| --- | --- |
| Cuenta bloqueada o sin permiso | No se borra nada; mensaje con el motivo. |
| La mesa ya no existe (otra persona) | «No encontramos esa mesa»; sin cambios. |
| Se pierde la respuesta | La pantalla no confirma; recargar muestra si se borró. Repetir es seguro. |
| Borrado por error | **No se recupera** (solo el respaldo, `docs/operacion.md`). Se recrea la mesa con otro QR: hay que imprimirlo. Por eso: dos pasos y el aviso del QR impreso; «Desactivar» queda como alternativa reversible. |

## Riesgos
- **Permiso nuevo de `DELETE`** para el Staff sobre mesas: se compensa con la confirmación; coincide con lo que ya puede hacer sobre mesas (todo menos sucursales).
- Se pierden los llamados de esa mesa de los últimos 14 días en la estadística por franja horaria.
- Un QR pegado en una mesa física que se borró da 404 hasta que se lo retire.

## Migración y rollback
`supabase/migrations/20261103100000_borrado_de_mesas.sql`: una política y un permiso. Aditiva, sin datos. Rollback: `drop policy "tables: los miembros borran con la cuenta al día" on public.tables; revoke delete on table public.tables from authenticated;` (en local, `git revert` + `pnpm db:reset`).

## Evidencia
Local, 2026-10-21, sobre el árbol sin commitear de esta ficha (el commit probado se anota en «Revisión»), con `pnpm db:reset` y la migración nueva:
- `pnpm typecheck` OK · `pnpm lint` OK · `pnpm build` OK · `pnpm test` **680/680**.
- `pnpm test:rls` completo **854/854** (37 archivos; los `ERROR:` del registro son de pruebas que provocan errores a propósito). Nuevas: 6 en `mesas.rls.test.ts` (borrado de Dueño y Staff con QR y llamados pendientes y atendidos, mesas y llamados vecinos intactos, nombre reutilizable con token nuevo, cupo liberado, otra organización / persona ajena / `anon`, solo lectura y suspendida con el estado desactualizado, gracia) y 1 en `acl.rls.test.ts` (privilegios de `tables` y `waiter_calls`); `tables.rls.test.ts` cambia la aserción «nadie borra» por «`anon` no borra y otra organización afecta 0 filas».
- E2E (`--workers=1`, contra el build): `mesas`, `sala`, `llamados`, `desactivar-sucursales` y `analitica` **80/80** (4 nuevas: borrado en dos pasos con llamados y QR 404, Staff, solo lectura de Dueño y Staff con acción forzada; sin desborde a 390 px). La prueba existente de acción forzada de regenerar el QR buscaba «el último formulario» de la fila y pasó a buscar el de su botón (la fila ahora tiene un formulario más).
- **Mutaciones** (de a una): módulo, 2 de 2 detectadas (sin chequear 0 filas; sin acotar a la organización). Base, aplicadas con SQL directo y restauradas: política sin `org_can_write` (detectada), política abierta (detectada), sin `GRANT DELETE` a `authenticated` (detectada). **2 equivalentes**: política sin membresía y `GRANT DELETE` a `anon` — PostgREST necesita `SELECT` (que `anon` no tiene y la política de lectura exige membresía) para filtrar el `DELETE`, así que el resultado no cambia (defensa en profundidad; mismo criterio que el ADR 0008).
- **No probado / límites:** borrado autenticado en staging o producción (la migración todavía no está en staging); teléfono real y lector de pantalla; el panel de sala con un llamado pendiente de una mesa que se borra en ese instante (solo se prueba que sus filas desaparecen).

## Revisión y aprobación
- **Codex, ronda 1 (commit `596704a`, nivel C, esfuerzo high): APROBAR, sin hallazgos.** Revisión estática (no ejecutó suites ni mutaciones; esa evidencia es la de arriba). Observó que la prueba de «borrar dos veces» es secuencial y no demuestra concurrencia real: el segundo `DELETE` simultáneo recibe 0 filas por el bloqueo de fila de PostgreSQL y el módulo responde «no encontrado» (misma ruta que la prueba secuencial); no se agregó una prueba concurrente.
- Pendiente: la **aprobación humana** (no está dada) antes de subir a `origin`, aplicar la migración en staging o desplegar.

# Cambio: Turno de mesa que rota al cobrar (primera mitad de la cuenta del comensal)
Estado: **implementado en local y aprobado por la revisión independiente (Codex, 2 rondas); falta la aprobación del usuario para aplicar la migración en staging** (aprobada por el usuario el 2026-10-24; evidencia al final). Decisiones en el [ADR 0044](../../docs/decisiones/0044-turno-de-mesa-y-cuenta-del-comensal.md). Segunda mitad: [cuenta del comensal](cuenta-del-comensal.md).
Nivel: **C** — toca `close_order`/`void_order` (el camino del cobro) y es la defensa de la que depende la exposición de información de la mitad siguiente. Revisión independiente (Codex) y aprobación del usuario antes de aplicar la migración en staging.

## Objetivo
Que cobrar la mesa «renueve» el QR **sin cambiar el QR impreso**: al cerrar o anular el pedido, o al apretar «Reiniciar QR de la mesa», todo ticket de visita anterior queda sin acceso a lo que dependa del turno, y quien escanee después arranca limpio.

## Decisiones (particulares)
1. **Esquema:** `tables.turn_started_at timestamptz not null default now()`. Las mesas existentes arrancan con su fecha de creación del turno = la de la migración (sin datos que mover).
2. **Rotación dentro de la función** (`private.end_table_turn`, que también da por **vencido el «Pedir la cuenta» pendiente** de la mesa: era de quienes ya se fueron y, pendiente, taparía con «ya pedida» el de la mesa nueva; el «Llamar al mozo» no se toca): `close_order` y `void_order` ponen `turn_started_at = clock_timestamp()` en la mesa del pedido (si tiene `table_id`) en la **misma transacción**, después del `for update` del pedido y solo cuando el estado cambia (repetir devuelve `unchanged` y no rota). Una mesa borrada (`table_id` nulo) no rota nada.
3. **`reset_table_turn(p_table uuid)`** (nueva, `authenticated`): cualquier miembro de la organización de la mesa; nunca depende de plan ni de mora; mesa inexistente o ajena = `table_not_found` indistinguible. Rota igual (y vence el pedido de cuenta pendiente) y devuelve `{table_id, turn_started_at}`.
4. **Lectura:** `private.ticket_in_turn(p_table, p_ticket_at)` = `p_ticket_at > turn_started_at` (estricto: un ticket de la misma emisión que la rotación no vale). Se usa en la mitad siguiente; acá solo se crea y se prueba.
5. **Sala:** botón «Reiniciar QR de la mesa» en la pantalla de la mesa, con confirmación («Quienes tengan la cuenta abierta en el celular tendrán que escanear de nuevo») y aviso del resultado. Sin cambios en el QR, en su token ni en su descarga.
6. **Lo que no cambia:** la regla de los 10 minutos tras atender la cuenta (`session_closed`) y el vencimiento del ticket a las 3 h siguen igual y conviven con esto.

## Invariantes
- `turn_started_at` solo lo escriben `close_order`, `void_order` y `reset_table_turn` (y el default). Ningún rol de la API tiene `UPDATE` sobre esa columna (revisar los permisos de columna de `tables`).
- Rotar nunca puede bloquear ni demorar un cierre: sin mora, plan ni permisos extra.
- Cerrar dos veces o anular dos veces rota **una** vez.
- El QR (`qr_token`) no cambia con ninguna de estas acciones.

## Fallos y recuperación
- Si la rotación falla dentro de `close_order`, falla el cierre completo (transacción): el mozo reintenta; no queda un pedido cerrado con turno vigente.
- Orden de bloqueos: **mesa → pedido**, el mismo que usa borrar una mesa (la clave foránea `on delete set null (table_id)`). El orden contrario producía un deadlock (hallazgo 2 de la revisión). La autorización se vuelve a comprobar después de ambas esperas y antes de escribir (hallazgo 1).
- Rollback: `git revert` + `pnpm db:reset`; con datos, volver a crear `close_order`/`void_order` de `20261128100000`, borrar `reset_table_turn` y `drop column turn_started_at`.

## Aceptación
- [x] Cerrar un pedido de una mesa mueve `turn_started_at`; cerrarlo otra vez no lo mueve.
- [x] Anular un pedido lo mueve; un pedido sin mesa (mesa borrada) no falla ni rota nada.
- [x] `reset_table_turn`: Dueño y Staff pueden; otra organización, anónimo y mesa inexistente no (mismo error); no depende de mora ni plan.
- [x] Ningún rol de la API puede escribir `turn_started_at` directo (ni `anon` ni `authenticated`).
- [x] `ticket_in_turn`: ticket anterior = falso; igual a la rotación = falso; posterior = verdadero.
- [x] En la Sala, «Reiniciar QR de la mesa» pide confirmación, rota y avisa; a 390 px sin desborde.
- [x] El `qr_token` y la ruta `/t/{token}` no cambian.
- [x] Cerrar, anular o reiniciar vence el «Pedir la cuenta» pendiente de ESA mesa y no toca el «Llamar al mozo» ni otras mesas; un cierre repetido o fallido no toca los llamados.

## Pruebas previstas
RLS (con `docker exec` donde haga falta): rotación por cierre/anulación/reinicio, idempotencia, permisos y ajeno. Unitarias del cliente de la acción. E2E de la pantalla de la mesa a 390 px. Mutaciones sobre: rotar al repetir el cierre, `ticket_in_turn` no estricto, reinicio sin comprobar la organización.

## Fuera de alcance
Cambiar el diseño del QR, regenerar el token, mostrar la cuenta al comensal (mitad siguiente), reinicio masivo de todas las mesas.

## Evidencia
Base local reseteada con la migración nueva, 2026-10-24, sobre `9168c30` + el diff de este cambio (commit indicado en Git):
- `tests/rls/turno-de-mesa.rls.test.ts` (nuevo) **13/13**: cerrar y anular mueven solo el turno de esa mesa y repetir no; un cierre fallido no lo mueve; mesa borrada; plan dado de baja y cuenta vencida; reinicio de Dueño y Staff sin tocar el `qr_token`; otra organización, inexistente, no uuid y `anon`; nadie de la API escribe `turn_started_at`; `ticket_in_turn` (anterior, igual, posterior, nulo, mesa inexistente, y un ticket que valía deja de valer al cerrar).
- `tests/rls/acl.rls.test.ts`: suma `reset_table_turn` y `private.ticket_in_turn` a la lista de permisos.
- **`pnpm test:rls` completo: 64/64 archivos, 1399/1399 pruebas** (1833 s).
- `src/lib/sala/turno.test.ts` (nuevo) **4/4**. `pnpm test`: 1051/1052; falla solo `textos.test.ts` («Menufeed»), la falla ajena ya registrada.
- `e2e/sala-turno.spec.ts` (nuevo) **2/2** a 390 px (confirmación, cerrar sin reiniciar no cambia nada, el reinicio mueve solo esa mesa y deja el token, mesa de otro local = 404), con `sala-operar` y `sala-anotar`: 14/14 con 3 trabajadores. `pnpm typecheck` y `pnpm lint`: limpios; `pnpm build` correcto.
- **Mutaciones** (función cambiada en la base local; restaurada con `pnpm db:reset`): `ticket_in_turn` con `>=` → falla 1 prueba; `reset_table_turn` sin comprobar la organización → falla 1. Ambas detectadas.
- **No corrido:** revisión independiente, aplicar en staging, teléfono real, mutación de «repetir el cierre mueve el turno» (la defensa es un `return` anterior al UPDATE y la prueba lo cubre con dos cierres seguidos).

## Revisión y aprobación
- **Ronda 1 — Codex, solo lectura, nivel C, sobre `e9de69d`: APROBAR CON CAMBIOS, 2 hallazgos importantes, ambos reales** (los reproduje con una prueba que fallaba antes de corregir):
  1. *Autorización sin revalidar tras esperar la mesa*: `reset_table_turn` comprobaba la membresía antes del `UPDATE` y `close_order`/`void_order` sumaban la espera de la mesa después de su última comprobación. Corregido: se toma el candado de la mesa y se vuelve a comprobar antes de escribir.
  2. *Deadlock entre cierre y borrado de mesa*: el cierre bloqueaba pedido → mesa y borrar una mesa bloquea mesa → pedido (FK `on delete set null`). Corregido: el cierre y la anulación toman primero la mesa (`for no key update`, que no choca con los `for key share` de las claves foráneas) y después el pedido. Si la mesa se borró mientras esperaban, el pedido ya quedó sin `table_id` y se cierra igual.
- Pruebas de regresión nuevas en `turno-de-mesa.rls.test.ts` (**15/15**): una con membresía revocada mientras esperan la mesa (reiniciar, cerrar y anular) y otra con un cierre que compite con un `DELETE` de la mesa (sin `deadlock`, el cierre se completa y el pedido queda `closed` sin mesa). **Fallaban con el código anterior** (`table_not_found` esperado y no devuelto; `ERROR: deadlock detected`) y pasan con la corrección. `acl` + `turno-de-mesa` 37/37; `pedidos`, `mesas`, `sala-*`, `borrado-de-organizaciones` y `purga-de-pedidos` 152/152.
- **Ronda 2 — verificación de Codex sobre `4b65ab1`: APROBAR.** Sin hallazgos nuevos ni regresiones; los dos hallazgos previos, corregidos. No ejecutó pruebas (las corridas son las de arriba).
- **Aprobación del usuario para aplicar la migración en staging: pendiente** (el veredicto de Codex no la reemplaza). La migración se corrigió en su mismo archivo porque nunca se aplicó fuera de local.

## Cambio posterior (hallazgo de la revisión de la cuenta del comensal, ronda 1)
La [revisión de Codex de la cuenta del comensal](cuenta-del-comensal.md#revisión-y-aprobación) encontró que un «Pedir la cuenta» pendiente del turno anterior tapaba el de la mesa nueva. Se corrigió **en esta misma migración** (nunca se aplicó fuera de local) con `private.end_table_turn` y se agregó la prueba (`turno-de-mesa.rls.test.ts` **17/17**; fallaba antes de corregir y cae con la mutación «sin vencer el pedido de cuenta»). Efecto visible para el mozo: la tarjeta «Pide la cuenta» de una mesa que acaba de cobrar sale sola de la Sala. Ronda de verificación de Codex de este cambio: ver la ficha de la cuenta del comensal.

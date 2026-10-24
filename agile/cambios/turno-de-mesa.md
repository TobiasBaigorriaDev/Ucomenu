# Cambio: Turno de mesa que rota al cobrar (primera mitad de la cuenta del comensal)
Estado: **ficha escrita, sin implementar** (aprobada por el usuario el 2026-10-24). Decisiones en el [ADR 0044](../../docs/decisiones/0044-turno-de-mesa-y-cuenta-del-comensal.md). Segunda mitad: [cuenta del comensal](cuenta-del-comensal.md).
Nivel: **C** — toca `close_order`/`void_order` (el camino del cobro) y es la defensa de la que depende la exposición de información de la mitad siguiente. Revisión independiente (Codex) y aprobación del usuario antes de aplicar la migración en staging.

## Objetivo
Que cobrar la mesa «renueve» el QR **sin cambiar el QR impreso**: al cerrar o anular el pedido, o al apretar «Reiniciar QR de la mesa», todo ticket de visita anterior queda sin acceso a lo que dependa del turno, y quien escanee después arranca limpio.

## Decisiones (particulares)
1. **Esquema:** `tables.turn_started_at timestamptz not null default now()`. Las mesas existentes arrancan con su fecha de creación del turno = la de la migración (sin datos que mover).
2. **Rotación dentro de la función:** `close_order` y `void_order` ponen `turn_started_at = clock_timestamp()` en la mesa del pedido (si tiene `table_id`) en la **misma transacción**, después del `for update` del pedido y solo cuando el estado cambia (repetir devuelve `unchanged` y no rota). Una mesa borrada (`table_id` nulo) no rota nada.
3. **`reset_table_turn(p_table uuid)`** (nueva, `authenticated`): cualquier miembro de la organización de la mesa; nunca depende de plan ni de mora; mesa inexistente o ajena = `table_not_found` indistinguible. Rota igual y devuelve `{table_id, turn_started_at}`.
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
- Orden de bloqueos: pedido → mesa (nunca al revés). Verificar que ninguna función existente tome la mesa y luego el pedido (deadlock).
- Rollback: `git revert` + `pnpm db:reset`; con datos, volver a crear `close_order`/`void_order` de `20261128100000`, borrar `reset_table_turn` y `drop column turn_started_at`.

## Aceptación
- [ ] Cerrar un pedido de una mesa mueve `turn_started_at`; cerrarlo otra vez no lo mueve.
- [ ] Anular un pedido lo mueve; un pedido sin mesa (mesa borrada) no falla ni rota nada.
- [ ] `reset_table_turn`: Dueño y Staff pueden; otra organización, anónimo y mesa inexistente no (mismo error); no depende de mora ni plan.
- [ ] Ningún rol de la API puede escribir `turn_started_at` directo (ni `anon` ni `authenticated`).
- [ ] `ticket_in_turn`: ticket anterior = falso; igual a la rotación = falso; posterior = verdadero.
- [ ] En la Sala, «Reiniciar QR de la mesa» pide confirmación, rota y avisa; a 390 px sin desborde.
- [ ] El `qr_token` y la ruta `/t/{token}` no cambian.

## Pruebas previstas
RLS (con `docker exec` donde haga falta): rotación por cierre/anulación/reinicio, idempotencia, permisos y ajeno. Unitarias del cliente de la acción. E2E de la pantalla de la mesa a 390 px. Mutaciones sobre: rotar al repetir el cierre, `ticket_in_turn` no estricto, reinicio sin comprobar la organización.

## Fuera de alcance
Cambiar el diseño del QR, regenerar el token, mostrar la cuenta al comensal (mitad siguiente), reinicio masivo de todas las mesas.

# 0027 — Los pagos sobreviven al borrado de la organización y se conservan 10 años; solo después se pueden purgar

- Estado: aceptada (política elegida por el usuario el 2026-10-20: conservar sin clave foránea, 10 años, con la función de purga ahora). **El plazo de 10 años es una convención contable habitual y queda por confirmar con el contador antes de producción.**
- Fecha: 2026-10-20

## Contexto
`payments` (ADR 0013) y `payment_voids` (ADR 0024) son los cobros de UcoMenu: plan, ciclo, monto, moneda, medio, referencia de operación (sin datos personales) y quién los registró. Solo se agregan y tenían `ON DELETE RESTRICT` hacia la organización y la suscripción, de modo que una organización con pagos no se podía borrar. A diferencia del historial de precios (ADR 0026), **no son datos del cliente: son la contabilidad de UcoMenu**, y borrarlos junto con la organización destruiría el registro de lo que se cobró. Había que decidir su retención para desbloquear el borrado de organizaciones.

## Decisión
1. **Sobreviven al borrado de la organización.** Se quitan las cuatro claves foráneas hacia `organizations` y `subscriptions` (en `payments` y en `payment_voids`), como ya hace `audit_log`. `organization_id` y `subscription_id` quedan como ids sin clave foránea. Se conserva `payment_voids.payment_id → payments`: una anulación nunca queda sin su pago. Las ids las escribe solo la función que registra o anula, desde la suscripción bloqueada, y los UUID no se reutilizan.
2. **Plazo: 10 años desde el registro del pago** (`created_at`). Es el plazo habitual de conservación de registros contables en Argentina (Código Civil y Comercial, art. 328); no es asesoramiento legal.
3. **Purga por vencimiento.** `private.purge_expired_payments(p_actor, p_reason)` borra los pagos registrados hace **más de 10 años cuya organización ya no existe**, con sus anulaciones. Los pagos de una organización que existe (aun dada de baja) **no se purgan nunca**, por antiguos que sean. Pide un SuperAdmin como responsable y un motivo (1 a 200), y deja la auditoría `payments.purged` (cuántos pagos y anulaciones, el corte y el motivo); si no hay nada que purgar no deja auditoría.
4. **Mecanismo y acceso**, igual que la purga de `price_history` (ADR 0026): función `SECURITY DEFINER` de `postgres` con `search_path` vacío que apaga `payments_no_update_delete` y `payment_voids_no_update_delete` dentro de la transacción y los vuelve a encender (si algo falla o se revierte, quedan encendidos y las filas siguen); sin EXECUTE para ningún rol de la API (tampoco `service_role`). Nada la programa ni la llama la aplicación: se corre a mano como `postgres`, con aprobación humana.
5. **Errores estables:** `not_platform_admin`, `invalid_reason`.

## Alternativas consideradas
- **Purgar los pagos con la organización** (como `price_history`) — pierde el registro de lo cobrado; solo tendría sentido sin obligaciones contables.
- **Bloquear el borrado de organizaciones con pagos** — el borrado definitivo serviría solo para cuentas que nunca pagaron.
- **Archivar los pagos en una tabla aparte al borrar** — duplica datos y obliga a mover filas de solo-agregado; quitar la clave foránea consigue lo mismo sin moverlas.
- **Conservar sin plazo ni purga** — más simple, pero deja sin respuesta cuánto tiempo se guarda. Se eligió dejar el plazo definido y la función lista, aunque nada venza en años.
- **Contar el plazo desde el cierre del ejercicio o desde la baja de la organización** — más fiel a algunos criterios contables, pero requiere más datos y decisiones; se puede ajustar si el contador lo pide.

## Consecuencias
- **Se pierde la barrera de integridad** que daba `RESTRICT`: ahora un `DELETE` de una organización (con `service_role` o `psql`) ya no se frena por los pagos. La barrera que queda es el `RESTRICT` de `price_history` mientras exista historial y, sobre todo, que la acción de borrado de SuperAdmin será la única vía prevista (con slug escrito, motivo y baja previa; ADR 0026).
- **Pagos huérfanos.** Tras borrar una organización sus pagos quedan sin organización ni suscripción. Hoy solo los lee el SuperAdmin por la tabla y ninguna pantalla los lista sin organización: encontrarlos requiere SQL. El Dueño de una organización borrada ya no existe, así que `owner_payments` no devuelve nada. La auditoría `organization.deleted` (que escribirá el borrado) tiene que guardar el slug y el nombre para poder identificarlos.
- **Irreversible:** una vez confirmada la purga, las filas no vuelven (solo el respaldo de `docs/operacion.md`). Por eso exige SuperAdmin, motivo y auditoría, y no se ejecuta sola.
- **Bloqueo breve** de las dos tablas mientras corre (`SHARE ROW EXCLUSIVE`): un pago nuevo espera un instante.
- **Datos personales:** `payments.reference` se documenta como sin datos personales; `registered_by` es un id de SuperAdmin. Si el contador o la revisión legal piden otra cosa, se ajusta acá.
- **Con esto, el borrado definitivo de organizaciones queda desbloqueado**: lo que falta es la acción en sí (ADR 0025 y 0026): SuperAdmin recomprobado, baja previa de 30 días, slug escrito, motivo, purga de `price_history`, borrado y auditoría `organization.deleted`, todo en una transacción.

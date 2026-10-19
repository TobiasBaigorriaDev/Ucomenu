# 0024 — Un pago mal cargado se anula con un asiento compensatorio; la vigencia vuelve a la de antes del pago

- Estado: aceptada (plan aprobado por el usuario el 2026-10-19)
- Fecha: 2026-10-19

## Contexto
`payments` solo se agrega (ADR 0013) y define la vigencia de la cuenta: cada pago mueve `current_period_end`. Un pago cargado con un error (una fecha de más, un importe equivocado) se corregía por SQL, apagando el trigger de solo-agregado y ajustando la suscripción a mano: la peor vía posible para dinero (sin motivo, sin auditoría de la aplicación, con acceso a la base). Había que dar una vía desde la aplicación sin abrir la edición ni el borrado de pagos.

## Decisión
1. **Anular, no editar.** Una tabla nueva `payment_voids` (solo se agrega; una fila por pago; lectura solo de SuperAdmin) referencia al pago y guarda el motivo. `payments` no se toca. Un pago está anulado si tiene fila ahí.
2. **Una función de base** `admin_void_payment` (solo `service_role`, recomprueba al actor, lock de la suscripción, auditoría `payment.voided` en la misma transacción), igual que las demás acciones de SuperAdmin.
3. **Solo se anula el pago que define la vigencia actual** (su `covers_until` es el `current_period_end`). Para corregir uno anterior se anulan de atrás hacia adelante. Así lo que se restaura es exactamente el `previous_period_end` de ese pago, sin reconstruir historias. Si queda otro pago vigente, su `covers_until` tiene que coincidir con ese valor; si no, la función se niega (historia tocada a mano).
4. **La prueba gratuita se respeta:** si el «antes» era el fin de la prueba, `current_period_end` vuelve a `null` y la prueba recupera su estado.
5. **Corregir = anular + registrar el correcto.** Para poder repetir la misma fecha de cobertura se quita `unique (subscription_id, covers_until)` de `payments`; la regla «extiende» más el lock ya impiden el duplicado.
6. **El Dueño ve el efecto, no el motivo:** `owner_payments` suma `voided_at` y `owner_account_history` suma `payment.voided` a su lista blanca (ADR 0021).

## Alternativas consideradas
- **Editar el pago (o apagar el trigger desde la aplicación):** rompe el solo-agregado y deja la historia inexplicable. Descartada.
- **Anular cualquier pago y recalcular la vigencia como el mayor `covers_until` entre los vigentes:** admite huecos (un mes anulado en el medio) y obliga a decidir si los pagos posteriores siguen cubriendo ese hueco. El último-primero evita la pregunta.
- **Corregir en un solo paso (anular y registrar en una transacción):** más cómodo, pero es otra función con más combinaciones de error. Queda como incremento si el uso lo pide.
- **Seguir con SQL:** es el riesgo que se quería cerrar.

## Consecuencias
- Anular puede dejar la cuenta vencida o suspendida por fechas en el acto; la pantalla lo avisa antes y pide confirmación.
- Entre anular y cargar el correcto hay dos pasos: si el segundo no se hace, la cuenta queda con la vigencia de antes del pago.
- `payment_voids` tiene `RESTRICT` como `payments`: el futuro borrado de organizaciones tendrá que definir también su retención.
- Cada acción de SuperAdmin nueva sigue necesitando decidir qué parte ve el Dueño (por defecto, nada).

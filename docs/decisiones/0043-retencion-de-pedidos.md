# 0043 — Los pedidos se conservan 2 años desde el cierre y después se purgan completos, por lotes

- Estado: aceptada (alcance elegido por el usuario el 2026-10-24: se purga el pedido completo, con una función por lotes que solo ejecuta el servidor). **El plazo de 2 años queda por confirmar con el contador antes de producción.**
- Fecha: 2026-10-24

## Contexto
El [ADR 0041](0041-pedidos-del-mozo.md) (decisión 8) fijó una retención de 2 años desde el cierre, a confirmar con el contador, y que la purga del registro va con el borrado de la organización (ya hecho). Faltaba decidir qué pasa con los pedidos que se cierran y envejecen en una organización que sigue activa: sin una regla, `orders`, `order_items`, `order_item_options` y `order_events` crecerían para siempre. Los pedidos no son un comprobante fiscal (la precuenta lleva «no válida como factura») ni llevan datos del comensal.

## Decisión
1. **Plazo: 2 años desde `closed_at`** (cierre o anulación). Es un parámetro de la función, con piso de 1 año; cambiarlo no exige migración.
2. **Se purga el pedido completo:** el pedido, sus líneas, las opciones copiadas y sus eventos del registro. Un pedido abierto no se purga nunca.
3. **Mecanismo:** `public.purge_expired_orders(p_retention, p_batch)`, `SECURITY DEFINER` de `postgres`, `search_path` vacío, `EXECUTE` solo para `service_role` (como `purge_waiter_calls`, ADR 0014), por lotes con `for update skip locked`, una transacción por lote. Para borrar el registro apaga el trigger de solo-agregado dentro de la transacción y lo vuelve a encender (el mismo recurso de `purge_organization_order_events`).
4. **Se programa aparte** (pg_cron, de madrugada), en la salida a producción; no se ejecuta contra staging ni producción sin aprobación.

## Alternativas consideradas
- **Purgar solo el registro de eventos y conservar los pedidos** — la analítica tendría historia, pero las tablas crecerían sin tope y el ADR 0041 pide 2 años.
- **Purga manual por SuperAdmin con auditoría** (como los pagos, ADR 0027) — más control, pero nadie la ejecuta sola y los pedidos viejos se acumularían; los pagos son contabilidad de UcoMenu, los pedidos son datos operativos del local.
- **Permitir el `DELETE` en el trigger de solo-agregado con una variable de sesión** — evita el bloqueo de tabla, pero cualquiera que pueda fijar la variable y tenga privilegio de borrado (el dueño de la tabla) saltaría la protección; se mantiene el recurso ya revisado.
- **Conservar sin plazo ni purga** — más simple, pero deja sin respuesta cuánto tiempo se guardan los datos.

## Consecuencias
- Lo purgado no vuelve (solo el respaldo). Por eso hay piso, defecto holgado y solo el servidor la ejecuta.
- **La analítica de pedidos** (ficha aparte) solo verá los últimos 2 años; si el Dueño necesita historia más larga hay que agregar agregados antes de purgar.
- **Bloqueo breve del registro** durante cada lote (quien anota espera un instante); lotes chicos y de madrugada.
- Un pedido abierto olvidado no se purga: un pedido que nadie cerró en años es una decisión aparte.
- **Datos personales:** los pedidos no llevan datos del comensal; la vinculación de clientes (S4, ADR 0042) tendrá su propia retención.

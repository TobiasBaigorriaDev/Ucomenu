# 0041 — Pedidos que anota el mozo en la Sala, sin punto de venta fiscal; el comensal no pide

- Estado: aceptada (recomendaciones D8–D11 y D14 aprobadas por el usuario el 2026-10-23; implementación pendiente)
- Fecha: 2026-10-23

## Contexto
`docs/producto.md` definía la carta como solo consulta y dejaba los pedidos fuera del MVP. El usuario quiere que **el mozo** anote en un apartado propio lo que el cliente le dicta (mesa, platos, variantes, adicionales, cantidades y observaciones), lo modifique y administre sus estados. Aclaró que **el cliente no hace pedidos**. No se busca un punto de venta fiscal.

## Decisión
1. **Solo el personal autenticado** (Dueño y Staff) crea y modifica pedidos, desde la **Sala** (`/sala/{slug}`), que suma una vista «Mesas» con el pedido abierto y los llamados de cada mesa. La carta del comensal sigue siendo solo consulta y nadie anónimo lee ni escribe pedidos.
2. **Copia al anotar.** Cada línea guarda nombre, precio efectivo (ADR 0040: el del momento en que se anota), promoción aplicada y las opciones elegidas con su diferencia. El precio lo calcula la base; el que manda el cliente se ignora. Se validan mínimos y máximos de los grupos y la visibilidad en la sucursal.
3. **Estados:** pedido abierto → cerrado | anulado; ítem anotado → en cocina → entregado | cancelado (con motivo si ya se entregó). «En cocina» es manual: no hay pantalla de cocina en esta etapa. Toda acción queda en un registro de solo-agregado. *(Enmienda 2026-10-26, [ADR 0048](0048-rol-cocinero.md): hay pantalla de cocina para un rol propio y el estado «listo» reemplaza a «En cocina» en la pantalla del mozo.)*
4. **Solo por mesa** en la primera entrega (sin mostrador ni para llevar).
5. **Mora:** en solo lectura o suspendida no se abren pedidos ni se agregan ítems, pero **cerrar y anular nunca se bloquean**.
6. **No fiscal:** el cierre muestra una precuenta con la leyenda «no válida como factura». Sin cobro, propinas, división de cuenta ni impresión de comandas. *(Enmienda 2026-10-26, [ADR 0044, enmienda 4](0044-turno-de-mesa-y-cuenta-del-comensal.md#enmienda-4-2026-10-26-sugerencia-opcional-de-propina): se admite sugerir una propina opcional por sucursal, separada del consumo, sin registrarla como cobrada.)*
7. **«Pedir la cuenta» sigue siendo un llamado:** la Sala muestra el total del pedido de esa mesa; atenderlo no cierra el pedido.
8. **Retención:** 2 años desde el cierre, a confirmar con el contador; la purga del registro va con el borrado de la organización.
9. Plan **Pro y Premium** (necesita la Sala).

## Alternativas consideradas
- **Pedido desde la mesa por el comensal** — descartado por el usuario.
- **Integrarse a un punto de venta existente** — fuera del producto (sin hardware ni terceros).
- **Pedidos en el panel en vez de la Sala** — el panel es configuración; la operación del salón ya vive en la Sala.

## Consecuencias
- Cambia `docs/producto.md`: el MVP sigue sin pedidos del comensal, pero el personal sí los anota.
- Borrar una mesa o un plato conserva la copia en los pedidos (claves en `SET NULL`).
- El sondeo de la Sala suma una lectura aparte, solo en la vista «Mesas»; Realtime queda como evolución (ADR 0011).

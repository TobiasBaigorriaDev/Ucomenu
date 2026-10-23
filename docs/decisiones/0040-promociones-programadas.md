# 0040 — Promociones programadas por horario de cada sucursal, con una sola función de precio efectivo en la base

- Estado: aceptada (recomendaciones D5–D8 aprobadas por el usuario el 2026-10-23); implementada la zona horaria por sucursal (decisión 1), el resto pendiente
- Fecha: 2026-10-23

## Contexto
El usuario quiere Happy Hour y promociones automáticas por días, horarios y fechas. Las sucursales no tienen zona horaria (toda la base usa Buenos Aires fijo). La carta cachea categorías y platos hasta 60 s y aplica el precio por sucursal en vivo, fuera de la caché (ADR 0035). Los pedidos del mozo (ADR 0041) van a cobrar ese mismo precio, así que la carta y el pedido no pueden calcularlo distinto.

## Decisión
1. **Zona horaria por sucursal** (`branches.timezone`, por defecto `America/Argentina/Buenos_Aires`, validada). Rige solo la lógica operativa de la sucursal (promociones, pedidos); facturación y mora siguen en hora de Argentina.
2. **Modelo.** Una promoción tiene tipo (porcentaje, monto o precio fijo), valor, días de la semana, franja horaria (puede **cruzar la medianoche**: pertenece al día en que empieza), fechas desde/hasta opcionales, platos o categorías y sucursales (todas por defecto).
3. **Una sola autoridad de precio:** una función de base calcula el precio efectivo = precio de sucursal (o base) → promoción vigente → piso de $ 0, redondeado al centavo. La carta lee en vivo las promociones vigentes de la sucursal; los pedidos usan la misma función. Una prueba de paridad cubre cualquier cálculo replicado en TypeScript.
4. **Conflictos:** no se acumulan; **gana el precio más bajo** para el comensal. El panel avisa las superposiciones.
5. **Alcance del descuento:** solo el precio base; las diferencias de variantes y adicionales no cambian.
6. **Quién:** crea y edita **solo el Dueño** con la cuenta editable; el Staff las ve. Plan **Pro y Premium**.
7. **Historial:** cada cambio de una promoción queda en un historial de solo-agregado (trigger, como ADR 0012). `price_history` no se toca: la promoción no cambia el precio de lista. Lo cobrado queda copiado en cada línea de pedido.

## Alternativas consideradas
- **Cálculo solo en TypeScript** — rápido para la carta, pero el pedido no tendría una autoridad en la base. Descartada.
- **Escribir el precio promocional en `products` por tarea programada** — ensucia `price_history`, depende de un proceso programado y falla si no corre.
- **Prioridad manual entre promociones** — más control, pero más difícil de entender; se puede sumar después.

## Consecuencias
- Una página abierta al cambiar la franja muestra el precio anterior hasta recargar; el pedido usa el precio del momento en que se anota (ADR 0041).
- El precio exhibido obliga al local (Ley 24.240, art. 7): el panel ofrece vista previa por día y hora.
- La purga del historial de promociones va con el borrado de la organización (ADR 0026 / 0028).

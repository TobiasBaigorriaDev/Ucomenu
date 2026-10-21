# 0035 — Catálogo central por organización con precio, disponibilidad y visibilidad por sucursal (nivel 2a)

- Estado: aceptada (aprobada por el usuario y desplegada en staging el 2026-10-21)
- Fecha: 2026-10-21

## Contexto
La carta es de la organización y se comparte entre sus sucursales (`docs/producto.md`); lo único que variaba por sucursal era la disponibilidad («agotado», tabla `product_availability`, ADR de `disponibilidad-por-sucursal`). Con varias sucursales hace falta que cada una pueda tener **su precio** y **ocultar** platos sin duplicar la carta ni cargar todo dos veces. Se evaluó la alternativa de una carta independiente por sucursal (nivel 2b) y se descartó por ahora: toca categorías, platos, variantes, traducciones, fotos, historial, caché, límites del plan y todas las pantallas de carta, y obliga a decidir cómo se cuentan los platos del plan.

## Decisión
1. **Un catálogo central** (categorías y orden, identidad, textos, traducciones, fotos, etiquetas, variantes y adicionales, precio base). Cada sucursal ajusta, **opcionalmente**, tres cosas por plato: precio propio, disponibilidad (agotado) y visibilidad.
2. **Un ajuste es una fila de `product_availability`** (se conserva el nombre: sin renombrar ni migrar datos): `is_available` (existente), `is_visible` (nuevo, por defecto verdadero) y `price_cents` (nuevo; nulo hereda el precio base; **cero es un precio válido**). Sin fila = visible, disponible y precio base: los locales sin ajustes, y los de una sola sucursal, no cambian.
3. **Lectura en vivo.** Los ajustes de la sucursal se leen en cada pedido de la carta pública (como el agotado hoy) y se aplican sobre el catálogo cacheado; la caché `carta:{org}` no cambia ni se invalida. Si los ajustes no se pueden leer, la carta falla (no se publica con precios o platos equivocados).
3b. **Oculto** = ausente en esa sucursal (listado, búsqueda y detalle); **agotado** = visible con su aviso; un plato o categoría **inactivos globalmente** no se publican aunque haya ajuste; una categoría sin platos visibles no aparece. Los ajustes de una sucursal desactivada se conservan; una sucursal nueva arranca sin ajustes.
4. **Los límites del plan no cambian**: se cuentan por organización sobre `products.is_active`. Un plato en varias sucursales cuenta una vez, ajustar una sucursal no consume ni libera cupo, y un plato activo oculto en todas sigue contando.
5. **Permisos y mora sin cambios**: miembro de la organización con `org_can_write` (ya lo exigen las políticas de la tabla). `member_branch_views` (ADR 0034) sigue siendo una preferencia. Ocultar **no** es una frontera de confidencialidad: el catálogo central es público por RLS, la visibilidad por sucursal es presentación.
6. **Historial de precios.** `price_history.branch_id` (nulo = precio base) y un trigger que registra cada cambio **efectivo** del precio de una sucursal; el cambio del precio base sigue siendo una fila general. Solo-agregado y purga con la organización, como hasta ahora.
7. **Alta atómica.** Una RPC `SECURITY INVOKER` (`create_product_in_branches`) crea el plato y sus ocultamientos en una transacción, para que «decidir en qué sucursales estará» no deje un plato visible en todas si algo falla.
8. **Preparado para lo que viene.** El diseño no impide cartas independientes más adelante: el ajuste por sucursal es una capa sobre un catálogo que sigue teniendo una única identidad de plato. Si algún día se necesitan catálogos propios, bastaría con un nivel intermedio («catálogo» al que pertenece cada sucursal) sin deshacer esto. No se implementa ni se agregan columnas para ello (YAGNI).

## Alternativas consideradas
- **Carta independiente por sucursal (2b):** mucho más grande y con decisiones comerciales abiertas (cupo por sucursal, doble carga). Queda fuera.
- **Tabla nueva `branch_product_settings`** y mantener `product_availability` solo para el agotado: duplica el modelo, obliga a migrar datos y a mantener dos fuentes por sucursal y plato.
- **Precio por sucursal dentro de `products` (jsonb o array):** sin integridad referencial ni RLS por fila, difícil de auditar y de limpiar.
- **Renombrar la tabla a `branch_product_settings`:** más claro, pero toca políticas, pruebas, tipos y la caché de la carta sin aportar al comportamiento; el nombre se aclara en el comentario de la tabla y en este ADR.
- **Cachear los ajustes con el catálogo:** habría que invalidar por sucursal y la carta serviría precios viejos hasta 60 s; la lectura en vivo ya existe para el agotado.

## Consecuencias
- Una consulta más (ya existente) por pedido de carta pública; ahora trae también precio y visibilidad.
- Las opciones (variantes y adicionales) conservan su diferencia informativa sobre el precio efectivo de la sucursal.
- El historial de una sucursal registra su precio propio, no los cambios del precio base que hereda (esos están en la fila general).
- Una clave de plato oculto sigue siendo legible por la API (catálogo central público); no se promete confidencialidad por sucursal.
- Migración nueva `20261107100000_carta_por_sucursal.sql`; rollback en su cabecera.
- Rollback del historial: se conservan `price_history.branch_id` y sus filas (auditoría de solo-agregado). El código anterior las mostraría mezcladas con las del precio general; el usuario aceptó esa limitación (2026-10-21) frente a rediseñarlas en una tabla propia con sus triggers, clave foránea y purga, que puede hacerse luego si hiciera falta.

# 0022 — Analítica básica: contadores anónimos por día y lectura solo para el Dueño con plan

- Estado: aceptada (el usuario eligió las tres opciones recomendadas el 2026-10-18: «plato visto» = abrir el detalle, llamados por franja sobre los últimos 14 días, y solo el Dueño la ve)
- Fecha: 2026-10-18

## Contexto
`producto.md` incluye la analítica básica (platos más vistos y llamados por franja horaria) desde el plan Pro. Hay dos fuentes muy distintas: los llamados ya se guardan en `waiter_calls` (pero se purgan a los 14 días, ADR 0014, y cada fila lleva un dato derivado de la IP), y las vistas de platos no existen: hay que contarlas desde la carta pública, que no tiene sesión y promete no guardar nada en el dispositivo del comensal.

## Decisión
1. **Vistas de platos como contadores**, `dish_view_counts (organization_id, branch_id, product_id, day, views)`, uno por sucursal, plato y día de Argentina. Nunca eventos: sin IP, sin identificador, sin hora. La tabla no da ningún permiso ni tiene políticas; solo la tocan funciones.
2. **Una escritura pública con la regla adentro**: `record_dish_view(p_branch, p_product)` la llama cualquiera (a través de una acción del servidor) y valida todo en la base: sucursal y organización activas, plan con `analytics` y cuenta no suspendida, plato y categoría publicados de la misma organización. Si algo no cuadra, devuelve `false` sin escribir ni decir por qué. El contador tiene tope (1.000.000).
3. **«Plato visto» = el comensal abre el detalle**, una vez por plato y por visita. El «una vez» vive en la memoria de la página (se pierde al recargar): no se usa `localStorage`, `sessionStorage` ni cookies. Si la primera respuesta es `false` (local sin el plan), la carta no insiste en esa visita.
4. **Lectura solo para el Dueño actual con el plan** (`owner_top_dishes`, `owner_calls_by_hour`; `SECURITY DEFINER`, solo leen, cero filas para cualquier otra identidad), como el historial de precios y los pagos (ADR 0021). Con la cuenta en «solo lectura» se sigue viendo (regla de `has_feature`); suspendida, no.
5. **Los llamados por hora salen de `waiter_calls`**, los últimos 14 días, sin tocar la purga ni la política de privacidad de los llamados. No se lee `client_key`.
6. **Riesgo aceptado:** cualquiera puede inflar el contador de una carta llamando a la función. No daña datos ni cuentas, solo el número; limitarlo por IP exigiría guardar un identificador del comensal, lo contrario de lo que se busca. Si apareciera abuso, se agrega un tope por sucursal y hora.

## Alternativas consideradas
- **Guardar un evento por vista** (con hora): permitiría más análisis pero acumula datos de comportamiento y obliga a una purga; un contador diario alcanza para «los más vistos».
- **Contar cada plato que aparece en pantalla**: mucho tráfico de escritura y poca señal de interés.
- **Agregar los llamados antes de purgar** (historia de meses): cambia el flujo crítico `create_waiter_call` o la purga y la política de privacidad; queda como mejora posterior.
- **Límite por IP en las vistas**: exigiría un identificador del comensal.
- **Que el Staff también la vea**: es información de negocio; se puede abrir después sin cambiar el modelo.

## Consecuencias
- La política de privacidad suma una oración sobre el conteo (el texto legal sigue pendiente de revisión, ítem «Salida a producción»).
- No hay histórico de llamados más allá de 14 días.
- Las vistas de un local sin el plan no se acumulan: al sumarlo empieza de cero.

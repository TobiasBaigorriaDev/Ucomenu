# 0045 — Analítica de pedidos: ventas anotadas por período, con los días de cada sucursal y lectura solo para el Dueño

- Estado: aceptada (el usuario pidió el rework de la analítica Pro/Premium el 2026-10-25; las decisiones de alcance son del implementador y quedan abiertas a ajuste)
- Fecha: 2026-10-25

## Contexto
La analítica básica ([ADR 0022](0022-analitica-basica.md)) responde solo dos cosas: qué platos se miran y a qué horas llaman las mesas. Con los pedidos del mozo ([ADR 0041](0041-pedidos-del-mozo.md)) el local ya tiene el dato que le importa: qué vendió, cuándo y cuánto se anuló. Los pedidos se guardan 2 años ([ADR 0043](0043-retencion-de-pedidos.md)), no son un comprobante fiscal y no llevan datos del comensal. Hacía falta decidir qué es una «venta», cómo se cortan los períodos entre sucursales de distinta zona horaria, quién lo lee y qué no se mide.

## Decisión
1. **Ventas anotadas, no facturación.** Una venta es un pedido **cerrado** con al menos una línea viva; se cuenta por la fecha de su cierre. Importe de línea = `cantidad × (precio efectivo + opciones)` (el cálculo de la precuenta y de la cuenta del comensal); una línea `cancelled` no suma; un pedido anulado o abierto no es una venta. La pantalla dice que no incluye propinas, descuentos al cobrar ni medios de pago.
2. **Períodos de 7, 30 o 90 días calendario** (por defecto 30), terminando hoy, comparados con el período anterior de igual largo. El tope de 90 coincide con las vistas de platos ([ADR 0022](0022-analitica-basica.md)). Los llamados por hora siguen en 14 días ([ADR 0014](0014-purga-de-waiter-calls.md)).
3. **Los días y las horas son los de la zona de cada sucursal** (`branches.timezone`, [ADR 0040](0040-promociones-programadas.md): los pedidos son lógica operativa). Cada pedido se asigna a su día local; los períodos se alinean por «días atrás». Los llamados y las vistas siguen en hora de Argentina, como decide el [ADR 0040](0040-promociones-programadas.md) para la analítica existente.
4. **Dos funciones de lectura que devuelven `jsonb`** (`owner_sales_overview`, `owner_products_performance`): `STABLE SECURITY DEFINER`, `search_path` vacío, `EXECUTE` solo `authenticated`. Solo el **Dueño actual** de la organización con la función `analytics` recibe datos; cualquier otra identidad, `null` (la vigencia es la de `has_feature`: «solo lectura» sí, suspendida no). **No exigen `orders`**: un local sin pedidos ve las secciones vacías explicadas. Nada se agrupa por persona.
5. **Mediana, no promedio, para el tiempo en la mesa**: un pedido olvidado abierto toda la noche no arruina la cifra.
6. **La franja horaria se mide por la apertura del pedido** (cuándo llega la gente), mientras que las ventas se asignan al día del cierre.
7. **Los platos que no se piden** son los publicados (activos, en categoría activa, visibles en alguna sucursal considerada) sin una línea viva vendida en el período; se ordenan por vistas, así los que se miran y no se piden salen primero.

## Alternativas consideradas
- **Agregados precalculados** (tabla de totales por día): lectura más barata, pero obliga a mantenerlos al anotar, cerrar y anular (más superficie en el flujo crítico). Con el tope de 90 días y el índice `orders (organization_id, closed_at)` la lectura directa alcanza; si algún local grande lo exige, se agrega después sin cambiar la pantalla. También sería el camino para historia más allá de la retención.
- **Una función por métrica** (ocho o más): más lecturas por pantalla y más superficie de autorización. Dos funciones comparten la misma comprobación y el mismo conjunto de pedidos.
- **Períodos por rango de fechas libre o más de 90 días**: más interfaz y más carga; los tres atajos cubren la decisión típica (semana, mes, trimestre).
- **Hora de Argentina para todo** (como la analítica vieja): rotularía mal las ventas de una sucursal en otra zona.
- **Agrupar por mozo**: es información sobre personas del equipo (control laboral), no pedida y con otras consecuencias; queda fuera.
- **Dejar el resumen al Staff**: es información de negocio; se puede abrir después sin cambiar el modelo.

## Consecuencias
- La analítica vive en `/panel/{slug}/analitica` con el filtro de sucursal existente y `?dias=7|30|90`; no hay migración de datos.
- Un cambio de zona horaria de una sucursal reasigna sus pedidos a otros días locales de inmediato (no hay datos fijados).
- Las cifras dependen de que el personal cierre las mesas; el tiempo típico y los anulados se leen con eso en mente.
- Los motivos de anulación y cancelación son texto libre del personal: los lee el Dueño de esa organización (ya los puede leer por RLS) y no se mezclan entre locales.
- Cuando la salida a producción confirme el plazo de retención con el contador, no cambia esta lectura: el tope de 90 días queda muy por debajo.

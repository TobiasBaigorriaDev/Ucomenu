# Cambio: Resumen del panel con datos del día y rediseño
Estado: implementado y verificado en local, sin commit; falta tu visto bueno visual en un teléfono real
Nivel: M (solo lee datos que ya existen y que cada rol ya ve en otra pantalla; sin migración, sin escritura, sin cambio de permisos)

## Objetivo
`/panel/{slug}` era una pantalla de enlaces: guía de primeros pasos, enlaces a la carta y uso del plan. No decía nada del negocio. Que sea lo primero útil que ve el Dueño (y el Personal) al abrir el panel: cómo va el día, qué pasa ahora en el salón y qué necesita atención. Y que se vea como una portada de trabajo, no como una lista.

## Decisiones
- **Cuatro bloques, de arriba abajo:** *Ahora* (salón en vivo), *Hoy* (ventas), *Para atender* (pendientes con enlace) y *Tu carta* (compartir). La guía de primeros pasos sube arriba solo mientras está incompleta; completa o oculta, baja y queda como estaba (sus `data-testid` y textos no cambian).
- **Sin migración:** *Ahora* reutiliza `loadMesas` (lo mismo que ve el Personal en Sala → Mesas); *Hoy* reutiliza `owner_sales_overview` pidiendo 14 días y derivando de `by_day` hoy, el mismo día de la semana anterior y las dos semanas; los platos más pedidos salen de `owner_products_performance` (7 días, 3 platos).
- **Quién ve qué:** *Hoy* solo el Dueño con `analytics` (la base devuelve `null` al resto, y la pantalla no lo pide si no corresponde); sin el plan, una línea que lo explica. *Ahora* lo ve quien ya ve Mesas (necesita `orders`; respeta las sucursales asignadas). *Para atender* y *Tu carta*, todos los del panel. «Uso del plan» sigue siendo solo del Dueño.
- **Falla parcial:** cada bloque lee por separado; si uno falla, ese bloque dice que no pudo leer y los demás se muestran.
- **Honestidad de datos:** las ventas son las de pedidos cerrados que anotó el equipo (igual que Analítica); sin pedidos hoy se dice «Todavía no hay ventas hoy», no se muestra un cero como si fuera un dato.
- **Visual:** celdas de tono del sistema (DESIGN.md «Celdas del Resumen»), sin sombras ni colores nuevos, `tabular-nums` en cifras, 44 px en lo tocable y gráfico de 7 días en CSS con su texto equivalente.
- **Tu carta:** por sucursal, «Ver la carta», «Copiar enlace» y «Compartir por WhatsApp» (enlace `wa.me` con el texto y la dirección; sin dependencias nuevas).

## Aceptación
- [x] El Dueño con Pro ve ventas de hoy, comparación con el mismo día de la semana anterior, pedidos, ticket de la semana, gráfico de 7 días y 3 platos más pedidos.
- [x] El Dueño sin analítica y el Personal no ven cifras de ventas; el Personal sí ve *Ahora*.
- [x] *Ahora* cuenta mesas con pedido, llamados (mozo y cuenta), platos en cocina y listos, y el total abierto; sin `orders` en el plan no aparece.
- [x] *Para atender* lista comentarios por revisar (con feed), platos agotados y recursos del plan cerca del tope (Dueño), cada uno con su enlace; sin pendientes dice que está todo al día.
- [x] La guía incompleta sigue primero; los tests de la guía y de «Uso del plan» siguen verdes.
- [x] 390 px sin desborde horizontal; con nombres de local largos y sin logo.

## Fuera de alcance
Notificaciones nuevas, tiempo real en el Resumen (se actualiza al recargar; el sondeo vive en Sala), comparaciones por sucursal (están en Analítica), cambios de esquema o de planes.

## Evidencia
(2026-10-31, árbol sin commit al escribir esta ficha)
- `pnpm typecheck`, `pnpm lint` (solo un aviso ajeno, en `video/`) y `pnpm build`: correctos. `pnpm test`: **1337/1337** (15 nuevas en `src/lib/resumen/resumen-panel.test.ts`: cifras de hoy y de la semana, comparaciones sin base, ticket, ahora, pendientes y el 90 % del plan).
- E2E nuevo `e2e/resumen-panel.spec.ts` (4/4): Dueño con Pro (salón, ventas contra el mismo día de la semana anterior, 7 barras con texto, platos, agotados, enlace de WhatsApp, copiado al portapapeles, sin desborde a 390 px), Personal (sin ventas ni plan), local sin pedidos (sin ceros) y Dueño sin analítica. Con los specs que tocan el Resumen (`alta-guiada`, `acceso`, `desactivar-sucursales`, `sucursales`): 78/78.
- Suite E2E completa: 537 en verde y 15 fallos en la primera corrida (7 min, todos los workers). Repetidos con menos carga, **12 pasan** (inestabilidad por carga, en áreas que no toqué); **3 siguen fallando en `menu.spec.ts`** (carta pública de Café Ejemplo): la base local tiene la carga de demostración (8 categorías, 36 platos) y la prueba espera la semilla chica. No es de este cambio; se resuelve con `pnpm db:reset`.
- Visto en pantalla (build local, local Aurelia con pedidos de demostración): escritorio y 390 px, paleta Monocromo.
- **Sin migración, sin cambio de permisos:** todo se lee con la sesión de la persona (RLS) y las RPC de analítica ya devuelven `null` a quien no es Dueño con el plan.
- **Observación fuera de alcance (ya existía):** en todas las pantallas del panel, a 390 px el navegador móvil usa una ventana de diseño de ~1435 px (la lista de secciones mide más que la pantalla, aunque quede recortada). Pasa también en Carta y Analítica. Por eso la prueba del copiado usa `dispatchEvent` en vez de `click()`. Conviene mirarlo aparte.
- **No ejecutado:** revisión en un teléfono real; el copiado al portapapeles fuera de Chromium; el enlace de WhatsApp abriendo la app.
- Datos de demostración: para ver el Resumen cargué en el Supabase **local** pedidos cerrados, dos mesas abiertas, llamados y platos agotados en Aurelia (`dueno@aurelia.test`). `pnpm db:reset` los borra.
- Recuperación: revertir el incremento (no hay migración).

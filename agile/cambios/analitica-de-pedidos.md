# Cambio: Analítica de pedidos para el Dueño (rework de la analítica Pro/Premium)
Estado: verificado en local; pendiente de revisión independiente y de tu aprobación
Nivel: **C** (el tablero lo marcaba M; se sube por criterio: suma dos funciones `SECURITY DEFINER` que **leen ventas de una organización** para su Dueño, y un error de autorización ahí expone el negocio de un local a otro. «Ante duda, subí un nivel». No hay escritura pública ni datos del comensal.)

## Objetivo
Que el **Dueño** de un local con plan **Pro o Premium** (función `analytics`) entienda su negocio con lo que ya anota el mozo: cuánto vendió, cuándo se llena el local, qué platos funcionan y cuáles no, y cuánto se anula, sin planillas. Reemplaza la pantalla de dos secciones (ADR 0022) por una analítica de pedidos con período y comparación, y conserva platos más vistos y llamados por hora.

## Decisiones
- **Fuente: pedidos del mozo** (`orders`, `order_items`, ADR 0041), no pagos ni facturas. Se llama **«Ventas anotadas»** y la pantalla aclara que sale de lo anotado en los pedidos cerrados (sin propinas, descuentos del cobro ni medios de pago).
- **Qué cuenta:** un pedido **cerrado** con al menos una línea viva, por la fecha de su cierre. Una línea viva es una que no está `cancelled`; importe de línea = `cantidad × (unit_price_cents + options_cents)` (el mismo cálculo que la precuenta y la cuenta del comensal). Los **anulados** se cuentan aparte (cantidad e importe de lo que tenían anotado); los pedidos abiertos no cuentan.
- **Período: 7, 30 o 90 días** (por defecto 30), en **días calendario de la zona horaria de cada sucursal** (`branches.timezone`, ADR 0040: los pedidos son lógica operativa), terminando hoy. Se compara con el **período anterior de igual largo**. El tope de 90 coincide con el de `owner_top_dishes` (vistas) y deja los 2 años de retención (ADR 0043) fuera de juego. Los llamados siguen en 14 días (los purga ADR 0014) y en hora de Argentina (ADR 0040).
- **Secciones:** (1) resumen con comparación: ventas, pedidos, ticket promedio, platos vendidos, tiempo típico en la mesa (mediana de cierre − apertura, robusta a pedidos olvidados) y descuento por promociones; (2) ventas por día; (3) mapa de calor día de la semana × hora, por hora de **apertura** del pedido (cuándo llega la gente); (4) platos más vendidos (unidades e importe) con sus vistas al lado; (5) ventas por categoría; (6) platos de la carta sin pedidos en el período, con sus vistas («se miran y no se piden»); (7) control: pedidos anulados y líneas canceladas con sus motivos; (8) lo existente: platos más vistos y llamados por hora.
- **Dos funciones de lectura, jsonb** (`owner_sales_overview`, `owner_products_performance`), `STABLE SECURITY DEFINER`, `search_path` vacío, `EXECUTE` solo `authenticated`; devuelven `null` para cualquier otra identidad. Una lectura que falla deja «No pudimos leer esta sección» en su bloque, sin tirar el otro.
- **Mismo acceso que la analítica actual:** solo el Dueño actual, con `analytics` en el plan; vale en «solo lectura» y no en suspendida (regla de `has_feature`). **No** exige `orders`: si el local nunca anotó pedidos, ve las secciones vacías con la explicación.
- **Sin datos personales y sin nada por mozo:** no se agrupa por persona (ni `opened_by` ni `closed_by`); los motivos de anulación son texto libre que escribe el personal y solo los lee el Dueño de esa organización (ya los puede leer por RLS en `orders`).
- **Índice nuevo** `orders (organization_id, closed_at desc)` para acotar la lectura; el resto reutiliza los existentes.
- **Sucursales:** el filtro existente (`?sucursal=`); el período va en `?dias=7|30|90` (cualquier otro valor cae en 30).

## Aceptación
- [ ] El Dueño de un local Pro/Premium ve el resumen del período con comparación contra el anterior; un período anterior sin ventas no muestra un porcentaje inventado.
- [ ] Ventas por día muestra todos los días del período (con ceros) y cada barra da fecha, pedidos e importe (mouse, toque y teclado).
- [ ] El mapa de calor marca las franjas fuertes, con tabla accesible equivalente.
- [ ] Platos más vendidos, categorías y platos sin pedidos coinciden con los pedidos cerrados; un plato desactivado o borrado después sigue figurando donde vendió.
- [ ] Un pedido anulado no suma ventas y aparece en «Control» con su motivo; una línea cancelada no suma.
- [ ] Staff, Dueño de otro local, sin rol, anon, plan Básico y cuenta suspendida reciben `null`; en «solo lectura» sí se ve.
- [ ] Filtrar por sucursal y por período cambia solo lo que corresponde; un `?dias=` inventado cae en 30.
- [ ] Un local sin pedidos ve cada sección vacía con una explicación; 390 px sin desborde; textos en español; importes en pesos.
- [ ] Las lecturas no escriben nada.

## Fuera de alcance
- Por mozo/persona, propinas, medios de pago, exportar (CSV/PDF), rangos de fechas libres, más de 90 días, tiempos de cocina (estado de cada línea), pronósticos, alertas, y analítica para el Staff.
- Histórico más allá de la retención de 2 años (ADR 0043) o agregados previos a la purga.

## Evidencia
Ejecutado el 2026-10-25 sobre `main` (base local reseteada con la migración `20261205100000`). Lo de abajo es de `8f028b6`; las correcciones de la ronda 1 están en el último punto:
- `pnpm typecheck` OK · `pnpm lint` OK · `pnpm build` OK.
- `pnpm test` **1120/1121**: la única falla es `src/lib/idiomas/textos.test.ts` («no queda una carta a medio traducir»: la clave `feed.dockLink` vale «Menufeed» en los tres idiomas), ajena a este cambio (no toca `idiomas`); queda anotada, sin corregir acá. Nuevas: `src/lib/analitica/ventas.test.ts` (51: período de la dirección, lectura defensiva de las dos respuestas, días completos con ceros, cuadrícula 7 × 24, comparaciones, etiquetas y fechas por zona).
- `pnpm test:rls` completo: **1453 pasan** y dos archivos (`videos-mux`, `video-likes`) caen con `0xC0000409` (el fallo ajeno ya conocido de Windows con `forks`); repetidos con `--pool=threads`: **64/64**. Nuevas: `tests/rls/analitica-pedidos.rls.test.ts` **16/16** (ventas con opciones, promoción, canceladas, anulado, abierto y cerrado sin líneas vivas; período anterior; ventana de 2, 30 y 90 días con tope y mínimo; día por zona de cada sucursal; franjas por hora de apertura; categorías, plato borrado y desactivado; platos sin pedidos y oculto por sucursal; filtro de sucursal ajena; aislamiento entre locales; quién lee y quién no, incluido «solo lectura», suspendida, Básico, Staff, anon y ex-Dueño; sin personas en la respuesta y sin escrituras) y `acl.rls.test.ts` con las dos funciones registradas.
- **Mutaciones sobre las dos funciones: 17 defensas rotas de a una.** 15 detectadas de entrada (sin Dueño, sin plan, pedidos de todas las organizaciones en ventas y en platos, canceladas suman en unidades e importe y en platos, sin opciones en el importe, anulados suman, franja por hora de cierre, sin tope de 90, sin filtro de sucursal, plato oculto sin excluir, plato inactivo sin pedidos incluido, mediana por otra medida). **#8 «los abiertos cuentan»: no detectada y es equivalente** (un pedido abierto tiene `closed_at` nulo y el filtro por fecha ya lo deja afuera: la condición de estado es redundante). **#10 «zona horaria fija»: no detectada la primera vez**: con un solo pedido de Madrid, el error quedaba tapado entre las 20 y las 24 h de Buenos Aires (cuando en Madrid ya es otro día). Se agregó un segundo pedido de Madrid (ayer 22:30–23:30) para que al menos uno cambie de día a cualquier hora y la mutación **pasó a ser detectada**.
- `playwright test e2e/analitica-pedidos.spec.ts e2e/analitica.spec.ts --workers=1`: **21/21** (8 nuevas: resumen con comparación y `data-cambio`, ventas por día de 30/7/90 puntos, mapa de 168 celdas, platos, categorías, sin pedidos, control; período y sucursal que se conservan entre sí; `?dias=` inventado cae en 30; mouse, teclado en dos direcciones y toque con el cartel dentro de la pantalla en 0 y 89; local sin pedidos; solo lectura sí y Básico solo el aviso; aislamiento entre locales; 390 px sin desborde). Capturas a 390 y 1280 px revisadas: el ticket promedio con centavos salía con la coma separada, y se pasó a pesos enteros.
- **Correcciones de la ronda 1 de Codex (sobre `8f028b6`):** `pnpm lint`, `typecheck` y `build` OK; `src/lib/analitica` **90/90** (nuevas: `categoryRows`, `visibleSections`); `analitica-pedidos.rls.test.ts` **17/17** (nuevo: 30, 30 y 300 minutos dan mediana 30; la mutación «promedio en lugar de mediana» **es detectada**, y antes no lo era); `e2e/analitica-pedidos.spec.ts` + `analitica.spec.ts` **21/21** con el build nuevo. La regresión del Tab **se comprobó contra el build viejo: la prueba falla** (`button[tabindex='0']` en 0) y pasa con la corrección.
- **No ejecutado:** aplicar la migración a staging y verlo con datos reales de un local en uso (esperan la revisión y tu aprobación); lectura con volúmenes grandes (más de unos miles de pedidos por período): el índice nuevo acota por fecha, pero no se midió.

## (C) Invariantes
1. Solo un **Dueño actual** de la organización, con `analytics` y cuenta no suspendida, recibe datos de ESA organización; cualquier otra identidad, `null`.
2. Ninguna fila de otra organización entra a un cálculo (toda lectura filtra por `organization_id = p_org`, también en los `join`), ni siquiera si `p_branch` es de otra.
3. Las lecturas **solo leen** y no devuelven `client_key`, ids de personas ni correos.
4. Anulados y líneas canceladas **nunca suman** a las ventas; los pedidos abiertos tampoco.
5. Una sucursal con otra zona horaria no corre las fronteras de día de las demás.

## (C) Fallos y recuperación
- **Una lectura falla** (base lenta o error): su bloque dice «No pudimos leer esta sección»; el otro y el resto del panel siguen.
- **Datos viejos purgados** (ADR 0043): el período solo ve lo conservado; no hay estado que reparar.
- **Rollback:** `git revert`; en una base con datos, `drop function public.owner_sales_overview(uuid, integer, uuid), public.owner_products_performance(uuid, integer, uuid, integer); drop index public.orders_organization_closed_idx;` (no hay datos propios que perder).

## (C) Revisión y aprobación
- **Ronda 1 (Codex, `--commit HEAD` sobre `8f028b6`, solo lectura): APROBAR CON CAMBIOS, 3 hallazgos «importantes» y 1 sugerencia, todos reales y corregidos:**
  1. *Categorías recortadas y porcentajes sobre el subtotal:* `LIMIT 12` dejaba ventas afuera y el 52 % de la principal salía de lo listado. Ahora los porcentajes salen del total del resumen y lo que queda afuera se muestra como «Otras categorías» (`categoryRows`, con prueba; la base no cambió).
  2. *El teclado se perdía al achicar el período:* el índice enfocable (28 de 30) quedaba fuera de rango con 7 columnas y Tab salteaba el gráfico. Ahora se usa el pico cuando el índice no existe. Regresión E2E (30 → 7 días) que falla sin la corrección.
  3. *«Platos sin pedidos» desaparecía si fallaba solo la lectura de ventas:* la decisión de qué secciones se arman pasó a una función pura (`visibleSections`) con prueba: con ventas caídas y platos que sí vendieron se sigue mostrando; sin esa certeza, no se afirma qué no se pidió.
  4. *Sugerencia (mediana vs promedio no distinguidos):* aceptada; caso asimétrico 30/30/300 y mutación detectada.
- Ronda de verificación: pendiente.
- Aprobación del usuario: pendiente.

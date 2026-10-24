# Cambio: Carta con precio promocional en vivo
Estado: **implementado y verificado en local (2026-10-23).** Cuarta pieza de S2 ([ADR 0040](../../docs/decisiones/0040-promociones-programadas.md)): la carta pública empieza a leer `effective_prices` ([ficha C](promociones-y-precio-efectivo.md)). Se carga con el [panel](panel-de-promociones.md).
Nivel: **M** — cambia lo que el comensal ve como precio (y el local queda obligado por él, Ley 24.240 art. 7), pero la cuenta la hace la base ya revisada y probada; esta pieza solo la lee y la pinta. Sin revisión independiente por su nivel.

## Objetivo
Que la carta (y el feed de videos de la mesa) muestre, mientras rige una promoción, el precio de lista tachado, el promocional y hasta cuándo, sin afectar la velocidad de la carta y sin servir un precio equivocado.

## Decisiones (particulares)
1. **Lectura en vivo, fuera de la caché.** `getPublicMenu` pide `effective_prices(sucursal)` en el mismo `Promise.all` que los ajustes de la sucursal y los videos: depende de la hora, así que no entra en la caché de 60 s del catálogo (ADR 0035). La promoción se aplica después de los ajustes de la sucursal (`applyPromotions`), sobre el precio de lista de la sucursal.
2. **Falla cerrado.** Si la lectura falla se lanza el error (la carta no se publica): mostrar el precio de lista, más alto que el que obliga al local, sería publicar un precio equivocado. Mismo criterio que los ajustes de la sucursal.
3. **`price_cents` sigue siendo el de lista**; la promoción cuelga aparte (`product.promotion = { priceCents, name, until }`). Una promoción que no baja el precio se ignora (la base no la manda; segunda barrera).
4. **Qué se muestra** (`DishPrice` y `PromoNote`, usados por la tarjeta, la fila clásica, el detalle y el feed): precio de lista tachado con «Precio anterior» para lectores de pantalla, el promocional y una línea «Nombre de la promoción · Hasta las 20:00». Sin promoción el marcado de siempre. El precio de lista de las variantes y adicionales no cambia.
5. **«Hasta cuándo»** sale de `ends_local` (el fin de la franja en el reloj de la sucursal) y del día de hoy **en esa zona**: hoy («Hasta las 20:00»), mañana («Hasta las 02:00 de mañana», o «Hasta la medianoche» si termina a las 00:00) u otro día («Hasta el 24/12 a las 12:00»). La zona sale de `branches.timezone`.
6. **Idiomas**: los textos fijos están en español, inglés y portugués (`TEXTOS.promo`); el nombre de la promoción lo escribe el Dueño y **no se traduce**.
7. **Rendimiento**: una consulta más, en paralelo con las que ya había y de una sola llamada por pedido (devuelve solo los platos con promoción). **No se midió el LCP** con las herramientas de la ficha de rendimiento; el costo esperado es el de una consulta paralela corta. Si hiciera falta, se mide en staging.
8. **Mora**: en solo lectura la promoción sigue aplicándose (la carta no cambia de precio por la mora); suspendida no hay carta. Sin la función en el plan (y sin vista previa vigente) no se aplica y la carta vuelve al precio de lista.

## Aceptación
- [x] Con una promoción en curso, el plato muestra el precio de lista tachado, el promocional y «Nombre · Hasta …»; los platos sin promoción no cambian.
- [x] Pausar o reanudar la promoción cambia la carta en el acto (sin esperar la caché de 60 s).
- [x] Un precio fijo, un monto o un porcentaje dan el precio de la ficha C; el precio promocional de cero es un precio.
- [x] Sin la función en el plan no se muestra; en solo lectura sí.
- [x] Hasta cuándo en los tres idiomas y para hoy, mañana (medianoche) y otro día; el día de hoy se mide en la zona de la sucursal.
- [x] El feed de videos de la mesa muestra el mismo precio que la carta.
- [x] La carta cabe a 390 px con y sin promoción.

## Evidencia
Sobre el diff de `main` (2026-10-23), sin migración nueva:
- `pnpm typecheck`, `pnpm lint`, `pnpm build` en verde; unitarias `carta.test` (hasta cuándo, textos, `applyPromotions`) dentro de las 62 de `src/lib/promociones`; `pnpm test` 1 falla ajena (`textos.test.ts`, «Menufeed»).
- RLS `panel-promociones` (lectura en vivo con `anon`: promoción, pausa, sucursal desactivada, cuenta suspendida) y suite completa 1276/1276.
- E2E `promociones` 7/7: la carta pública sin sesión muestra el tachado, el promocional y «Happy hour · Hasta la medianoche», se actualiza al pausar y reanudar y al editar, no aparece en Básico y aparece en solo lectura. Captura de la carta a 390 px revisada.
- No probado: el feed de videos con una promoción en un teléfono real; el LCP.

## Cierre
E2E completo contra el build (2026-10-23, 3 *workers*): **440 pasaron, 1 se saltó y 1 falló por un *worker* caído con `0xC0000409`** (el fallo ajeno conocido; `disponibilidad.spec` repetido: 3/3). Suite completa de RLS 57 archivos, 1276/1276. Lint, typecheck y build en verde; `pnpm test` 1 falla ajena (`textos.test.ts`). **Sin subir**: la migración `20261124100000` no está en staging y la app no está desplegada con estas pantallas.

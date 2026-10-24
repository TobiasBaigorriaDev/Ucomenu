# Cambio: Precuenta «no válida como factura» en la Sala
Estado: **implementado en local; falta aprobación del usuario y despliegue.** No hay migración. Séptima pieza de S3 «Pedidos del mozo» ([ADR 0041](../../docs/decisiones/0041-pedidos-del-mozo.md), decisión 6), primera mitad de la «ficha de cierre» (la segunda es la [retención y purga de pedidos](retencion-de-pedidos.md)). Decisiones de alcance confirmadas por el usuario el 2026-10-24 («Imprimible, sin observaciones»; ficha partida en dos).
Nivel: **M** — solo lectura de lo que ya existe, sin esquema, permisos ni dinero nuevos: *muestra* un total que el mozo no cobra desde la app. Sin revisión independiente por defecto.

## Objetivo
Que el mozo le muestre o imprima al cliente, antes de cerrar la mesa, **qué consumió y cuánto va**, con la leyenda «No válida como factura».

## Decisiones (particulares)
1. **Una página por pedido:** `/sala/{slug}/cuenta/{pedido}`, a la que se llega con «Ver precuenta» desde la pantalla de la mesa. Sirve para un pedido abierto, cerrado o anulado (por id, de su local): el cerrado muestra «Pedido cerrado» y el anulado «Pedido anulado: no usar como cuenta». No hay listado de pedidos cerrados (eso sería historial/analítica).
2. **Contenido:** nombre del local, mesa (y sucursal si el local tiene varias), fecha y hora **de la sucursal** (24 h; la de ahora, no la de apertura), cada plato vigente con sus opciones, cantidad, precio por unidad (si son varias) e importe, **total**, cantidad de platos y la leyenda **«NO VÁLIDA COMO FACTURA»** en recuadro. **Sin las observaciones de cocina** (decisión del usuario), sin motivos de cancelación y **sin las líneas canceladas** (ni suman).
3. **Importes copiados, no recalculados:** cada línea vale `cantidad × (precio efectivo + opciones)` con lo que se copió al anotar (la misma `orderCents` de «Mesas»). Cambiar la carta o una promoción después no mueve una precuenta.
4. **Imprimir:** botón «Imprimir» (`window.print()`: impresora o «Guardar como PDF»); con la hoja de estilos de impresión quedan solo la precuenta y su leyenda (sin navegación, enlaces ni botones). No imprime nada solo.
5. **Quién:** cualquier miembro del local (Dueño o Staff) con la RLS de su sesión; funciona aunque el plan ya no incluya los pedidos (es lectura). Otro local, un id inexistente o no uuid: 404; sin sesión: login. Sin cobro, propina, división de cuenta ni numeración.
6. Refactor sin cambio de comportamiento: la lectura de líneas de un pedido se extrae a `loadOrderLines` (la usan la pantalla de la mesa y la precuenta).

## Aceptación
- [x] Desde la mesa, «Ver precuenta» abre la precuenta con los platos vigentes, sus opciones, importes, total y la leyenda; sin lo cancelado ni las observaciones.
- [x] El total es la suma de `cantidad × (efectivo + opciones)` de lo no cancelado; con varias unidades muestra el precio por unidad.
- [x] La hora es la de la sucursal; una zona horaria que no se reconoce no rompe la página.
- [x] Un pedido cerrado o anulado se avisa como tal; sin platos vigentes dice que no hay platos y el total es cero.
- [x] Al imprimir (medio `print`) no se ven el botón, el enlace de vuelta ni la navegación.
- [x] Otro local, id inexistente o no uuid: 404; sin sesión: login; el anónimo no tiene permiso de lectura sobre los pedidos.
- [x] A 390 px, sin desborde horizontal.

## Fuera de alcance
- Historial o listado de pedidos cerrados, reimpresión desde un listado, numeración, QR de pago, propinas, división de cuenta y cualquier cobro; envío por mensaje o correo; factura electrónica.

## Evidencia
Sin migración; base local, 2026-10-24, sobre `73badde`/`a070163` + el diff de este cambio:
- `src/lib/sala/precuenta.test.ts` (nuevo) **9/9**: importes con opciones y cantidades, canceladas fuera, observaciones y motivos fuera, sin líneas, sin desborde con 99 unidades de 50 opciones del máximo importe, hora de Buenos Aires y zona desconocida.
- `tests/rls/sala-anotar.rls.test.ts` **15/15** (eran 11): suma la lectura de la precuenta con las sesiones de Dueño y Staff (líneas, sucursal, zona horaria), cerrado y anulado, mesa borrada (conserva su etiqueta), otra organización e inexistente, y el anónimo sin permiso.
- `e2e/sala-precuenta.spec.ts` (nueva) **4/4** a 390 px: la precuenta desde la mesa (importes, sin cancelado ni nota, leyenda, sin desborde, volver), emulación de impresión, cerrado/anulado/vacío y accesos (404, login). Con `sala-operar` y `sala-anotar`: 25/25 (la corrida con 4 trabajadores a la vez tuvo 5 *timeouts* por carga de la máquina; con 3, 13/13).
- `pnpm typecheck` y `pnpm lint`: limpios. `pnpm build` correcto con la ruta nueva.
- **No corrido:** mutaciones (solo lectura, sin dinero ni permisos nuevos), suite RLS y E2E completas, impresora real, lector de pantalla, teléfono real, staging.

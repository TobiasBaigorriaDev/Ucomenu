# Cambio: Rol de cocinero (pedidos, «listo» y platos agotados)
Estado: **implementado y verificado en local; falta la revisión independiente y tu prueba con sesión real**. Migración nueva: `20261207100000_rol_cocinero.sql` (aplicada solo en local).
Nivel: **C** — agrega un rol y cambia qué abre `is_org_member` (autorización/RLS) y sus límites de exposición de datos. Una revisión independiente antes de dar por cerrado; aprobación humana antes de desplegar.

## Objetivo
Un rol de **cocinero** (pedido del usuario, 2026-10-26) que recibe las órdenes, marca cada plato **listo** y saca de la carta lo que se agotó, sin acceso a nada más. Decisiones y motivos: [ADR 0048](../../docs/decisiones/0048-rol-cocinero.md).

## Decisiones (particulares)
1. Flujo **Anotado → Listo → Entregado** (elegido por el usuario). `in_kitchen` queda válido en la base para lo existente; la pantalla del mozo ya no lo ofrece.
2. El cocinero ve pedidos abiertos **sin precios** y platos **sin precios**; solo escribe «listo» (y deshacerlo) y agotado/disponible por sucursal.
3. Pro y Premium; todas las sucursales del local. Dar el rol exige `orders` en el plan (la base además corta toda acción del cocinero sin `orders` o con la cuenta sin editar).
4. `private.is_org_member` = Dueño o Staff. `private.is_org_kitchen` = Dueño, Staff o cocinero.
5. El Dueño y el Staff también pueden usar `/cocina` (ven y marcan igual); el Staff conserva su flujo en Mesas.

## Invariantes (qué nunca debe pasar)
- Un cocinero **no lee ni escribe** ninguna tabla por la API (precios, pedidos, mesas, llamados, personal, planes, pagos, auditoría), ni la carta, aunque conozca los ids.
- Un cocinero **no puede**: anotar, editar, cancelar, entregar, cerrar o anular pedidos; tocar precios, visibilidad u otros ajustes de la sucursal; gestionar personal; registrar push; entrar a `/panel` ni `/sala`.
- Un cocinero de **otra organización** no ve ni toca nada de esta; uno de **esta** no opera sin `orders` en el plan ni con la cuenta suspendida o en solo lectura.
- Un cocinero **no cambia su propio rol** ni el de nadie (solo el Dueño, como hoy).
- `kitchen_orders` y `kitchen_menu` **no devuelven** columnas de precio ni totales.
- Pasar a `ready` es idempotente y registrado en `order_events` con la persona.

## Fallos y recuperación
- Dos personas marcan lo mismo a la vez: la segunda recibe `unchanged` (no error). Una línea cancelada o entregada entre medio: `invalid_transition`, la pantalla recarga.
- Se da de baja el plan Pro con cocineros creados: siguen existiendo pero no pueden operar; el Dueño ve el aviso y puede quitarlos.
- Rollback: `git revert` + `pnpm db:reset` en local. Con datos reales: pasar los cocineros a `staff` o quitarlos, devolver las líneas `ready` a `noted`, y recién después volver a los `check` previos (ver la cabecera de la migración).

## Aceptación
- [x] El Dueño crea un cocinero (solo con `orders` en el plan), le cambia el rol y lo quita; el Staff no puede (E2E `cocina`; `requireOwner` sigue siendo la puerta de Personal).
- [x] Un cocinero que entra va a `/cocina/{slug}`; `/panel/...` y `/sala/...` redirigen y las rutas de sondeo de la Sala dan 404.
- [x] En `/cocina` ve los pedidos abiertos con mesa, antigüedad, platos, opciones y observaciones, sin precios; marca «Listo» y puede deshacerlo; la lista se actualiza sola y suena con un plato nuevo.
- [x] En «Platos agotados» ve los platos por categoría, elige sucursal y marca agotado/disponible (solo `is_available`).
- [x] El mozo ve en Mesas «Listo para entregar» (banda, orden, resaltado y anuncio); el botón «En cocina» ya no está; marca Entregado.
- [x] RLS: un cocinero no lee ni escribe nada fuera de las funciones de cocina; no entrega ni cancela; no opera sin plan o con mora; otra organización recibe error; las funciones no devuelven precios.
- [x] Dueño y Staff siguen igual (pedidos, sala y personal verdes).

## Fuera de alcance
Cocinero atado a una sucursal; tiempos de preparación o estados intermedios; impresión de comandas; avisos push al cocinero; cancelaciones por el cocinero; edición de la carta por el cocinero.

## Evidencia
Sobre el diff sin commitear de `main` (2026-10-26):
- Migración aplicada con `pnpm db:reset`; `pnpm db:types` regenerado (solo suma las funciones nuevas).
- `pnpm typecheck` y `pnpm lint` limpios; `pnpm build` en verde; `pnpm test`: 76 archivos, 1194 de 1194 (nuevo `src/lib/cocina/cocina.test.ts`; ajustados `mesas` y `operar`).
- **RLS completa** (`pnpm test:rls`): 68 archivos. En la primera corrida cayeron 4 pruebas —la matriz de `acl` (funciones nuevas, que había que declarar) y una de `pedidos-estados` (la expectativa de «noted» cambió)— y dos *workers* con `0xC0000409` (`videos-mux`, `videos-modulo`). Ajustadas las expectativas y repetidos los archivos: `acl`, `pedidos-estados`, `rol-cocinero` 66 de 66; `videos-mux` y `videos-modulo` 48 de 48.
- `tests/rls/rol-cocinero.rls.test.ts` (nueva, 24 casos): el rol, lectura cerrada de las tablas del local, escritura cerrada de la carta, sin funciones del mozo, `kitchen_*` sin precios, listo/deshacer con su registro, transiciones inválidas, agotar solo `is_available`, otro local, anon, plan Básico, gracia/solo lectura/suspendida, baja de la organización y push.
- E2E contra el build: `cocina` (8, nueva), `sala`, `sala-mesas`, `sala-anotar`, `sala-operar`, `acceso`: 94 de 95 en la primera corrida (una prueba de `cocina` cayó con `0xC0000409` y pasó al repetirla; en `sala-operar` una prueba usaba el botón «En cocina», que ya no existe, y se reescribió; `cocina` Personal esperaba un mensaje que vive en la fila). Otros 15 archivos que tocan Sala, panel, push, turno, analítica y SuperAdmin: 114 de 114.
- Captura de las dos pantallas a 390 px revisada (sin desborde, botones de 44 px, sin precios).
- Sin probar: sesión real y teléfono; staging (no se desplegó nada).

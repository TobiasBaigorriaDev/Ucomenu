# Cambio: Rol de cocinero (pedidos, «listo» y platos agotados)
Estado: **desplegado en staging (Fly v59, migración `20261207100000`) el 2026-10-26**, con aprobación del usuario y revisión independiente (Codex, ronda 3). Probado por el usuario en local con una cuenta de cocinero; falta su prueba en staging con sesión real y teléfono.
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
- Un cocinero **no lee ni escribe** ninguna tabla del local por la API (pedidos, líneas, registro, mesas, llamados, historial de precios, personal, plan, pagos, auditoría) ni escribe la carta, aunque conozca los ids. De la carta lee **solo lo público** (platos y categorías activos de un local publicado: lo mismo que un visitante anónimo); lo inactivo u oculto solo lo ven Dueño y Staff.
- Un cocinero **no puede**: anotar, editar, cancelar, entregar, cerrar o anular pedidos; tocar precios, visibilidad u otros ajustes de la sucursal; gestionar personal; registrar push; entrar a `/panel` ni `/sala`.
- Un cocinero de **otra organización** no ve ni toca nada de esta; uno de **esta** no opera sin `orders` en el plan ni con la cuenta suspendida o en solo lectura.
- Un cocinero **no cambia su propio rol** ni el de nadie (solo el Dueño, como hoy).
- `kitchen_orders` y `kitchen_menu` **no devuelven** columnas de precio ni totales (la carta pública sí muestra precios a cualquiera: no es un secreto que esta función deba guardar).
- Las escrituras de cocina **revalidan quién llama después de esperar** (fila de disponibilidad, candado de la línea): una membresía revocada o cambiada mientras esperan no las deja pasar. Un registro push en vuelo no sobrevive al cambio a cocinero, y los avisos solo van a quien hoy es Dueño o Staff.
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

## Revisión y aprobación
**Ronda 1 (Codex, commit `850d717`, 2026-10-26): RECHAZAR** con 5 hallazgos. Triage:
1. *Lectura pública de `products` con precios* — cierto pero es dato público por diseño (la carta publicada la ve cualquiera, `anon` incluido). El defecto era mi invariante, que prometía «no lee la carta»: corregido arriba; prueba nueva de paridad con un visitante anónimo (lo inactivo solo lo ven Dueño y Staff). Sin cambio de código.
2. *Agotar tras revocar el acceso* — real: `set_kitchen_availability` revalida después del `UPSERT`. Prueba de carrera nueva (retiene la fila, revoca, libera); falla sin la defensa.
3. *Registro push en carrera con el cambio a cocinero* — real: el registro revalida el rol tras el candado, el trigger toma el mismo candado y `push_targets_for_call` filtra por rol actual. Prueba de carrera nueva; falla sin las defensas (queda 1 suscripción viva).
4. *Se pierde el aviso de un plato nuevo listo si el contador no cambia* — real: la pantalla compara ids de líneas listas (`readyIds`, `tablesWithNewReady`). Pruebas unitarias nuevas, entre ellas el escenario «se entrega uno y se marca otro».
5. *Prueba de aislamiento con tablas vacías* — cierto: ahora se siembra cada tabla y se comprueba que quien corresponde la ve antes de comprobar que el cocinero no.
**Ronda 2 (verificación de Codex, commit `8ad8a71`): RECHAZAR** con 2 hallazgos nuevos sobre las correcciones:
- *Deshacer y volver a marcar «Listo» pierde el aviso* — real, regresión de mi corrección del hallazgo 4 (`seenReady` acumulaba ids). Ahora se reemplaza por lo que está listo en cada respuesta. Prueba unitaria nueva y E2E del escenario (deshacer y remarcar); el E2E falla con el comportamiento anterior.
- *Pagos sin datos en la prueba de aislamiento* — cierto: se siembra un pago, se comprueba que el Dueño lo ve por `owner_payments` y que el cocinero no.
**Ronda 3 (verificación de Codex, commit `5af09d9`): APROBAR**, sin hallazgos nuevos. El veredicto de Codex no reemplaza tu aprobación: falta para desplegar (la migración toca permisos).

## Evidencia
Sobre el diff sin commitear de `main` (2026-10-26):
- Migración aplicada con `pnpm db:reset`; `pnpm db:types` regenerado (solo suma las funciones nuevas).
- `pnpm typecheck` y `pnpm lint` limpios; `pnpm build` en verde; `pnpm test`: 76 archivos, 1194 de 1194 (nuevo `src/lib/cocina/cocina.test.ts`; ajustados `mesas` y `operar`).
- **RLS completa** (`pnpm test:rls`): 68 archivos. En la primera corrida cayeron 4 pruebas —la matriz de `acl` (funciones nuevas, que había que declarar) y una de `pedidos-estados` (la expectativa de «noted» cambió)— y dos *workers* con `0xC0000409` (`videos-mux`, `videos-modulo`). Ajustadas las expectativas y repetidos los archivos: `acl`, `pedidos-estados`, `rol-cocinero` 66 de 66; `videos-mux` y `videos-modulo` 48 de 48.
- `tests/rls/rol-cocinero.rls.test.ts` (nueva, 24 casos): el rol, lectura cerrada de las tablas del local, escritura cerrada de la carta, sin funciones del mozo, `kitchen_*` sin precios, listo/deshacer con su registro, transiciones inválidas, agotar solo `is_available`, otro local, anon, plan Básico, gracia/solo lectura/suspendida, baja de la organización y push.
- E2E contra el build: `cocina` (8, nueva), `sala`, `sala-mesas`, `sala-anotar`, `sala-operar`, `acceso`: 94 de 95 en la primera corrida (una prueba de `cocina` cayó con `0xC0000409` y pasó al repetirla; en `sala-operar` una prueba usaba el botón «En cocina», que ya no existe, y se reescribió; `cocina` Personal esperaba un mensaje que vive en la fila). Otros 15 archivos que tocan Sala, panel, push, turno, analítica y SuperAdmin: 114 de 114.
- Captura de las dos pantallas a 390 px revisada (sin desborde, botones de 44 px, sin precios).
- Tras las rondas de revisión (commit `5af09d9`): `typecheck`, `lint` y `build` en verde; `pnpm test` 1198 de 1198 y, con el último ajuste, `src/lib/sala` 78 de 78. **RLS completa otra vez**: 69 archivos, 1460 de 1461 pruebas en la primera corrida; la falla (`owner-lectura`, una restricción de auditoría violada por filas sobrantes de las pruebas de mutación) y dos *workers* con `0xC0000409` (`borrado-de-organizaciones`, `personnel`) pasaron al repetir esos tres archivos: 76 de 76. E2E `cocina` (con el escenario de deshacer y remarcar «listo»), `sala-mesas`, `sala-operar`, `sala-push` y `panel-push` en verde.
- Comprobado rompiendo la defensa: las carreras de agotar y de registrar el aviso (RLS) y la de deshacer y remarcar «listo» (E2E) fallan sin la corrección.
- **Aprobación del usuario (2026-10-26): «Apruebo, sube todo a staging»**, tras probarlo en local con una cuenta de cocinero. Alcance: aplicar la migración en staging, desplegar y subir `main` a GitHub; sin producción.
- **Staging (2026-10-26):** código de `0d926a7` (el último cambio de código es `5af09d9`). `supabase db push --linked --dry-run` contra `oasixhsdyigimwvcxtkx` listó **solo `20261207100000_rol_cocinero.sql`**; aplicada con `db push --linked --skip-vault --yes`, sin seeds, roles ni secretos; dry-run posterior: **`upToDate: true`**. Con la clave pública, un anónimo recibe `42501` en `kitchen_orders`, `kitchen_branches`, `kitchen_menu`, `set_kitchen_availability` y `set_order_item_status`, y al leer `orders`. Imagen `ucomenu-staging:rol-cocinero-0d926a7` con los cuatro argumentos públicos, `flyctl deploy -c fly.staging.toml --local-only --depot=false`: **Fly v59**, `started`, **1 passing**. HTTP sin sesión: `/`, `/login`, `/privacidad` y `/m/la-bestia/centro` **200**; `/panel/demo`, `/sala/demo/mesas`, `/cocina` y `/cocina/demo` **307**; `/cocina/demo/estado` y `/sala/demo/estado` **401**. No se probó con sesión en staging (los demos no tienen cocinero).
- Sin probar: sesión real y teléfono en staging.

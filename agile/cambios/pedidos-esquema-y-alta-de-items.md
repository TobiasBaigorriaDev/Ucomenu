# Cambio: Esquema de pedidos y alta de ítems sin opciones
Estado: **implementado y verificado en local (2026-10-24); revisión de Codex ronda 1 corregida, falta la ronda de verificación, la aprobación humana y la migración en staging.** Decisiones confirmadas por el usuario el 2026-10-24 («implementalo con esas decisiones»). Primera pieza de S3 «Pedidos del mozo» ([ADR 0041](../../docs/decisiones/0041-pedidos-del-mozo.md)), desbloqueada por [promociones y precio efectivo](promociones-y-precio-efectivo.md).
Nivel: **C** — autorización (quién anota pedidos, por plan y mora), exposición de información (los pedidos son de la organización: ni otra organización ni `anon` los leen) y dinero (el precio de cada línea lo fija la base, con promoción si rige). Sin eliminación irreversible nueva: ni se borra ni se modifica nada todavía.

## Objetivo
Que el mozo (Dueño o Staff con sesión) abra el pedido de una mesa y le agregue platos **sin opciones**, con cantidad, y que la base calcule y copie el precio. Sin pantalla: la Sala llega en la ficha «Vista Mesas». Las variantes y adicionales, los estados y el cierre son las fichas siguientes.

## Decisiones (particulares)
1. **Función del plan `orders`** (ADR 0041, decisión 9): se suma a `plans_features_check` y a `plans.features` de Pro y Premium, como se hizo con `promotions`. `private.can_take_orders(org)` = `is_org_member` y `has_feature(org, 'orders')`; `has_feature` ya deja fuera solo lectura y suspendida, que es lo que pide el ADR para abrir pedidos y agregar ítems. Las vistas previas ([ficha](vistas-previas-de-funciones.md)) podrían conceder `orders` a un Básico: la prueba de `vistas-previas.rls` se ajusta como con `promotions`.
2. **Tablas** (todas con clave foránea compuesta con la organización):
   - `orders`: `id`, `organization_id`, `branch_id`, `table_id` (nulo si se borra la mesa), `table_label` (copia de la etiqueta), `status` (`open` | `closed` | `void`; en esta ficha solo se crea `open`), `opened_by`, `opened_at`, `closed_at`.
   - `order_items`: `id`, `order_id`, `organization_id`, `product_id` (nulo si se borra el plato, `ON DELETE SET NULL (product_id)`), `product_name` (copia), `quantity` 1–99, `base_price_cents` y `unit_price_cents` (el efectivo al anotar), `promotion_id` y `promotion_name` (copias, sin clave foránea), `status` (`noted`; los demás estados son otra ficha), `client_key` (uuid), `created_by`, `created_at`.
3. **Un solo pedido abierto por mesa**: índice único parcial sobre `table_id` donde `status = 'open'`. La primera línea de una mesa lo abre en la misma transacción con `INSERT ... ON CONFLICT`, así dos mozos que anotan a la vez en una mesa vacía terminan en el mismo pedido.
4. **Solo por una función, no por la API de tablas.** `public.add_order_item(p_branch, p_table, p_product, p_quantity, p_client_key)`: `SECURITY DEFINER`, `search_path` vacío, `EXECUTE` solo para `authenticated`. Las tablas no tienen `INSERT`, `UPDATE` ni `DELETE` para ningún rol de la API; `SELECT` solo para miembros de la organización (política con `is_org_member`, sin `anon`). El precio **no es un parámetro**: la función lo lee de `effective_prices(p_branch, p_product)` con el instante actual.
5. **Qué rechaza** (errores estables como las demás acciones): sin sesión o sin plan/mora al día → `orders_not_allowed`; sucursal inexistente, inactiva o de otra organización → `branch_not_found`; mesa inactiva o de otra sucursal → `table_not_found`; plato de otra organización, inactivo, con categoría inactiva (lo que no devuelve `effective_prices`) o **agotado en esa sucursal** → `product_unavailable`; plato con un grupo de opciones activo de mínimo 1 o más → `options_required` (falla cerrado hasta la ficha de variantes); cantidad fuera de 1–99 → `invalid_quantity`; pedido con 200 ítems → `order_full`.
6. **Reintento seguro:** `client_key` es único **por organización** (`unique (organization_id, client_key)`; afinado al implementar: así un reintento tardío, aun con el pedido ya cerrado, no abre otro pedido ni suma otra línea) y la función serializa las llamadas con la misma clave con un candado de la transacción. Repetir la llamada con la misma clave (doble toque, red inestable) devuelve la línea ya creada y no suma otra; la misma clave con otro plato o cantidad → `client_key_reused`.
7. **Copia, no referencia.** Nombre del plato, etiqueta de la mesa, precio de lista, precio efectivo y promoción quedan copiados: un cambio posterior del catálogo no reescribe lo anotado (ADR 0041, decisión 2).
8. **Sin total ni cuenta todavía.** El total del pedido es de la ficha «Vista Mesas / Pedir la cuenta»; acá solo se guardan líneas.
9. **Sin tabla de eventos todavía.** Esta ficha no modifica ni borra nada, así que las propias filas (`opened_by`, `created_by`, fechas) son el registro. El registro de solo-agregado llega con los estados y las modificaciones (ficha 3 de S3), cuando haya algo que reescribir.
10. **Borrado de organizaciones:** `orders` y `order_items` se borran por cascada con la organización (no hay retención todavía). La retención de 2 años y la purga explícita se resuelven en la ficha de cierre, que es la que fija qué se conserva.
11. **Tipos y esquema:** migración nueva `20261126100000_pedidos_esquema.sql`, `supabase/seed.sql` sin cambios (no hay datos de pedidos) y `pnpm db:types`. La lista de funciones de `acl.rls.test.ts` suma `add_order_item`.
12. **Lo que no se hace en la app:** ninguna pantalla ni acción de servidor. Tampoco se toca `producto.md` salvo marcar «pedidos» como «esquema listo»; el comportamiento visible llega con la Sala.

## Aceptación
- [x] Un Dueño o Staff de un local Pro o Premium al día anota un plato sin opciones en una mesa de una sucursal: se crea el pedido `open` y la línea con nombre, cantidad, precio de lista y precio efectivo copiados.
- [x] Con una promoción en curso, `unit_price_cents` es el de `effective_prices` y la línea guarda la promoción; sin promoción es exactamente el de lista. No hay forma de pasar un precio.
- [x] Una segunda línea en la misma mesa entra al **mismo** pedido; otra mesa abre otro pedido. Dos primeras líneas simultáneas en una mesa vacía dejan **un** pedido.
- [x] Repetir la llamada con la misma `client_key` no duplica; con otro plato o cantidad rechaza.
- [x] Rechaza (con el error estable y sin dejar filas): Básico, solo lectura, suspendida, `anon`, miembro de otra organización, plato o mesa o sucursal de otra organización, plato inactivo o de categoría inactiva, plato agotado en la sucursal, plato con grupo obligatorio, cantidad 0 o 100, pedido con 200 ítems. En gracia sí se puede.
- [x] Un Staff lee los pedidos de su organización; otra organización y `anon` no leen nada; nadie escribe las tablas por la API (`INSERT`, `UPDATE`, `DELETE` fallan con `42501`).
- [x] Borrar un plato o una mesa conserva la línea o el pedido con su copia; borrar la organización se lleva los pedidos.
- [x] La migración es aditiva y aplica a la primera con `pnpm db:reset`; `pnpm db:types` regenerado; `acl.rls.test.ts` cubre la función nueva.

## Fuera de alcance
- Variantes, adicionales y observaciones (ficha 2); estados, modificar, cancelar, cerrar, anular y registro de solo-agregado (ficha 3); vista «Mesas» y total (ficha 4); precuenta, retención y purga (ficha 5); analítica (ficha 6). Cualquier pantalla.

## Evidencia
Migración `20261126100000_pedidos_esquema.sql` (aplicada con `pnpm db:reset` a la primera, sin tocar `seed.sql`), `pnpm db:types` regenerado; base local, 2026-10-24, sobre `f974240` + el diff de este cambio:
- `tests/rls/pedidos.rls.test.ts` **27/27** tras la ronda 1 (eran 25): catálogo, alta con Dueño y Staff, precio efectivo con y sin promoción (y precio propio de la sucursal), sin parámetro de precio, un pedido por mesa y cinco primeras líneas simultáneas (3 iteraciones), `client_key` (reintento, reutilización, concurrencia, por organización), Básico/vista previa vigente y vencida, gracia/solo lectura/suspendida, `anon` y miembro de otra organización, sucursal/mesa/plato ajenos o inactivos, agotado, grupo obligatorio, cantidades, tope de 200, atomicidad, lectura, escrituras rechazadas para Dueño, Staff, `anon` y servicio técnico, permisos de tabla, copia al borrar plato o mesa y cascada al borrar la organización.
- `pnpm test:rls` completo: **58 archivos, 1302/1302**. Ajustados: `acl.rls` (función nueva y su ayudante), `billing.rls` (catálogo con `orders` en Pro y Premium) y `vistas-previas.rls` (`orders` también se rechaza con `feature_in_plan` en Pro y Premium; la prueba de carrera de cambio de plan usa `customers`, que ningún plan incluye).
- **Mutaciones** (de a una, con `create or replace` en la base local, restauradas después): 7 probadas, **7 detectadas** (más 2 tras la ronda 1, abajo): sin comprobar plan/mora (3 fallas), precio de lista en vez de efectivo (1), sin candado por `client_key` (1), sin tope de 200 (1), sin `options_required` (1), sin el chequeo de agotado (2) y sin el índice único parcial (19).
- `pnpm typecheck` y `pnpm lint`: sin errores. `pnpm test`: 1001 de 1002; la única falla es `textos.test.ts` («Menufeed»), previa y ajena.
- **No corrido:** E2E (no hay pantalla ni acción de servidor; la spec de vistas previas del SuperAdmin usa `orders` sobre un Básico y no cambia), staging, prueba de carga con muchos pedidos, y la revisión independiente (C).

## (C) Invariantes
- El precio de una línea sale siempre de `effective_prices` en el momento de anotarla; ningún cliente lo fija.
- Nadie fuera de la organización (ni `anon`) lee ni escribe pedidos; ninguna línea apunta a platos, mesas o sucursales de otra organización (claves compuestas).
- Una mesa tiene a lo sumo un pedido abierto.
- Solo una cuenta al día con la función en el plan abre pedidos y agrega ítems.
- Lo anotado no cambia aunque cambie el catálogo.

## (C) Fallos y recuperación
- La función es una sola transacción: si falla la línea, tampoco queda el pedido recién abierto.
- Se pierde la respuesta: el cliente repite con la misma `client_key` y recibe la línea ya creada.
- Un cambio de plan o una mora posterior no borra lo anotado: se puede leer; no se agregan ítems.
- Rollback: `drop function public.add_order_item(...)`, `drop table public.order_items, public.orders`, quitar `orders` de `plans.features` y de `plans_features_check`. Si ya hay pedidos reales, conservarlos (exportar antes).

## (C) Revisión y aprobación
- **Codex, ronda 1 (commit `bd35c33`, esfuerzo high): APROBAR CON CAMBIOS.** Tres hallazgos, los tres reales y corregidos:
  1. *Importante — autorización sin revalidar tras esperar los candados.* Una membresía, plan o mora que cambian mientras la llamada espera dejaban pasar con la autorización de antes. Corregido: `can_take_orders` se vuelve a comprobar después de tomar el candado del pedido, justo antes de insertar. Regresión: una sesión retiene el candado del pedido, la llamada del Staff queda bloqueada (la prueba lo comprueba en `pg_stat_activity`), se le quita la membresía y la llamada rechaza con `orders_not_allowed`; sin la revalidación **falla** (mutación).
  2. *Importante — el reintento exacto fallaba con `client_key_reused` si se borró el plato o la mesa* (ambas claves se anulan). Corregido: la línea guarda `request_hash` (huella de mesa, plato y cantidad) y el reintento se compara con ella. Regresión: repetir la petición tras borrar plato y mesa devuelve la línea; comparando por `product_id` **falla** (mutación).
  3. *Sugerencia — la prueba de atomicidad fallaba antes de abrir el pedido.* Corregido: un disparador de prueba hace fallar el `INSERT` de la línea cuando el pedido ya se abrió, y la prueba comprueba que no queda ni pedido ni línea.
  - Migración editada en el lugar (todavía no estaba en ningún entorno remoto); `pnpm db:reset` y `pnpm db:types` regenerados. Re-corridas tras las correcciones: `pedidos`, `acl`, `vistas-previas`, `billing` y `borrado-de-organizaciones` 165/165, `typecheck` y `lint` limpios. No se repitió la suite RLS completa (1302/1302 era anterior a las correcciones, que solo tocan la función y la tabla nuevas).
- **Pendiente:** ronda de verificación de Codex sobre el commit de las correcciones y la **aprobación humana** antes de aplicar la migración en staging.

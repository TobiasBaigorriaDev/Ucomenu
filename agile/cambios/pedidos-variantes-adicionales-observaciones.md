# Cambio: Variantes, adicionales y observaciones en las líneas del pedido
Estado: **implementado y verificado en local (2026-10-24); revisión de Codex ronda 1 corregida, falta la verificación, la aprobación humana y la migración en staging.** Segunda pieza de S3 «Pedidos del mozo» ([ADR 0041](../../docs/decisiones/0041-pedidos-del-mozo.md)), sobre [esquema y alta de ítems](pedidos-esquema-y-alta-de-items.md) (ya en staging).
Nivel: **C** — dinero (el precio de la línea suma las diferencias de las opciones y lo calcula la base), autorización (misma puerta que la ficha anterior) y exposición (los pedidos siguen siendo solo de la organización). Sin eliminación irreversible.

## Objetivo
Que el mozo anote un plato **con sus variantes y adicionales** (por ejemplo «Punto: jugoso», «Extras: bacon y huevo») y una **observación** («sin cebolla»), con los mínimos y máximos de cada grupo validados por la base y el precio de las opciones copiado a la línea. Levanta el rechazo `options_required` de la ficha anterior para los platos con grupos obligatorios.

## Decisiones (particulares)
1. **Misma puerta, firma ampliada.** `add_order_item(p_branch, p_table, p_product, p_quantity, p_client_key, p_options uuid[] default '{}', p_note text default null)`. Se reemplaza la función de cinco parámetros (migración nueva, `drop` + `create`); las llamadas de cinco parámetros siguen valiendo (sin opciones ni nota). Mismos permisos: solo `authenticated`, valida adentro.
2. **Opciones elegidas = lista de ids.** La base valida contra el catálogo, no confía en nada del cliente: cada opción tiene que existir, estar activa, ser de un grupo **activo de ESTE plato** y de la misma organización; sin repetidas ni nulas y como máximo 50 → si no, `invalid_options` (22023).
3. **Mínimos y máximos por grupo activo del plato:** menos elecciones que `min_choices` → `options_required`; más que `max_choices` → `options_exceeded` (22023). Un grupo activo con mínimo ≥ 1 y sin opciones activas no se puede cumplir y falla cerrado (`options_required`), como antes. Un grupo opcional sin elecciones no estorba.
4. **Precio.** La línea guarda `unit_price_cents` (efectivo, con promoción si rige: sin cambios) y `options_cents` (**bigint**, suma de las diferencias elegidas; las promociones no tocan las opciones, ADR 0040). El precio de una unidad es `unit_price_cents + options_cents` y el de la línea, ese valor por `quantity`. La cantidad multiplica la línea entera (mismas opciones en todas las unidades).
5. **Copia.** Tabla `order_item_options` (una fila por opción elegida): nombre del grupo, nombre de la opción y diferencia copiados; `option_id` (nulo si se borra) y `group_id` sin clave foránea. Clave foránea compuesta con la organización a la línea (`cascade`) y a `options` (`SET NULL (option_id)`; para eso `options` gana `unique (id, organization_id)`). Un cambio posterior del catálogo no reescribe lo anotado.
6. **Observación.** `order_items.note`: texto de una línea, sin espacios en los bordes, 1 a 200 caracteres (vacío o solo espacios = sin nota), sin caracteres de control → si no, `invalid_note` (22023). Es información libre del mozo: no se interpreta ni se muestra al comensal.
7. **Reintento.** `request_hash` ahora cubre mesa, plato, cantidad, opciones (ordenadas) y nota normalizada: repetir exactamente devuelve la línea con sus opciones; cambiar una opción o la nota con la misma clave → `client_key_reused`.
8. **Permisos de la tabla nueva:** como `orders`: `SELECT` para miembros, ninguna escritura por la API (tampoco `service_role`). Sin cambios en lo ya revisado: autorización revalidada tras cada espera, atomicidad, tope de 200 líneas.
9. **Sin pantalla** (la Sala es otra ficha). La carta pública no cambia.

## Aceptación
- [x] Un plato con variante obligatoria («Punto de cocción» 1/1) se anota eligiendo una opción; sin elegir → `options_required`; con dos → `options_exceeded`.
- [x] Adicionales opcionales (0/3): sin elegir, con uno, con tres entran; con cuatro → `options_exceeded`. Con mínimo 2, una sola → `options_required`.
- [x] La línea guarda `options_cents` = suma de las diferencias, y cada opción con nombre de grupo, nombre y diferencia copiados; con promoción en el plato, la promoción baja el precio base y **no** las diferencias.
- [x] Rechaza con `invalid_options` y sin dejar filas: opción de otro plato, de otra organización, inactiva, de un grupo inactivo, repetida, nula, inexistente o más de 50.
- [x] La observación se guarda recortada; vacía = nula; más de 200 o con salto de línea u otro carácter de control → `invalid_note`.
- [x] Reintento con la misma clave y lo mismo devuelve la línea con sus opciones (`replayed`); con otra opción o nota → `client_key_reused`; también tras borrar el plato o una opción.
- [x] Borrar o renombrar una opción o un grupo no cambia lo anotado (queda con `option_id` nulo y el nombre copiado).
- [x] La tabla nueva: la leen los miembros de la organización y nadie más; nadie la escribe por la API; se va con la línea y con la organización.
- [x] Lo ya aprobado sigue: plan y mora, revalidación tras esperar, atomicidad, tope de 200 líneas, un pedido por mesa (las pruebas de la ficha anterior siguen en verde).

## Fuera de alcance
- Estados, modificar y cancelar líneas (ficha 3); vista «Mesas» y total (ficha 4); precuenta y retención (ficha 5); cantidades distintas por opción (cada opción vale una vez por unidad). Cualquier pantalla.

## Evidencia
Migración `20261127100000_pedidos_variantes_y_observaciones.sql` (aplicada con `pnpm db:reset` a la primera; `pnpm db:types` regenerado); base local, 2026-10-24, sobre `8169548` + el diff de este cambio:
- `tests/rls/pedidos-opciones.rls.test.ts` **18/18** tras la ronda 1 (eran 15; estable en tres corridas seguidas antes de ella): variante 1/1 y adicionales 0 a N con mínimo y máximo, varios grupos, grupo obligatorio sin opciones activas, precio con promoción más diferencias, 50 opciones de la diferencia máxima en bigint (5·10¹⁰), siete clases de opción rechazada sin dejar filas, la nota (recorte, vacía, 200/201, saltos de línea y controles, y el `check` de la tabla), el reintento (otro orden, otra opción, otra nota, otra cantidad, tras borrar una opción), la copia ante cambios y borrados del catálogo, atomicidad con un fallo después de abrir el pedido, lectura y escritura de la tabla nueva, y cascadas. Las 28 de `pedidos.rls` siguen en verde con la firma nueva.
- Archivos RLS afectados (`pedidos`, `acl`, `vistas-previas`, `billing`, `borrado-de-organizaciones`): **184/184** tras la ronda 1. No se repitió el RLS completo antes de la revisión; se corre al integrar.
- **Mutaciones** (de a una, con `create or replace`, restauradas y comprobadas con un `diff` de la definición): 10 probadas, **10 detectadas**: sin mínimo (5 fallas), sin máximo (2), opción de cualquier plato (1), opción inactiva permitida (1), diferencia que no suma (7), huella sin opciones (2), huella sin nota (2), duplicadas permitidas (1), sin tope de 50 (1) y nota sin controlar en la función (1).
- **Defecto encontrado por una prueba intermitente:** el orden de las opciones devueltas dependía del `id` aleatorio cuando dos grupos tenían el mismo `sort_order`; el desempate pasó a la fecha de creación (`g.sort_order, g.created_at, g.id`, igual para las opciones).
- `pnpm typecheck` y `pnpm lint`: sin errores. No corrido: E2E (sin pantalla), staging, prueba de carga.

## (C) Invariantes
- El precio de una línea sale de `effective_prices` más las diferencias de las opciones que lee la base; el cliente solo manda ids.
- Una opción solo se anota si hoy está activa y es de un grupo activo del plato de la línea; se cumplen mínimos y máximos de todos los grupos activos del plato.
- Lo anotado (nombres y diferencias) no cambia aunque cambie el catálogo.
- Nadie fuera de la organización lee ni escribe; nadie escribe por la API.

## (C) Fallos y recuperación
- Una sola transacción: si falla una opción, la nota o la línea, no queda ni la línea ni el pedido recién abierto.
- Se pierde la respuesta: repetir con la misma clave devuelve lo creado (con sus opciones).
- Rollback: volver a crear `add_order_item` de cinco parámetros con el cuerpo de `20261126100000`, `drop table public.order_item_options`, quitar las columnas `note` y `options_cents` de `order_items` y la restricción única de `options`. Si ya hay líneas con opciones, exportarlas antes.

## (C) Revisión y aprobación
- **Codex, ronda 1 (commit `d2ac404`, esfuerzo high): APROBAR CON CAMBIOS.** Dos hallazgos, los dos reales y corregidos (migración editada en el lugar: todavía no estaba en ningún entorno remoto):
  1. *Importante — reintentos incompatibles con líneas creadas por la función anterior* (la huella ahora incluía opciones y nota aunque estuvieran vacías). Corregido: sin opciones ni nota la huella vuelve a ser `mesa|plato|cantidad` (la de la migración anterior), así que un reintento de una línea vieja sigue valiendo y el rollback no rompe las líneas sin opciones. Regresión: una línea con la huella vieja escrita a mano se reintenta y devuelve `replayed`; con la huella siempre de cinco partes **falla** (mutación).
  2. *Importante — el total y las diferencias copiadas podían divergir si el catálogo cambiaba a mitad de la llamada* (el total se calculaba antes de insertar y la copia, después). Corregido: la copia es la fuente de verdad: se insertan solo opciones activas de grupos activos del plato, si faltan filas se rechaza (`invalid_options`, todo se deshace) y `options_cents` se calcula **sobre lo copiado**. Regresiones con un disparador de prueba que pausa el `INSERT` mientras otra sesión cambia el catálogo: (a) cambiar una diferencia deja el total igual a la suma de lo copiado, **falla** con el cálculo anterior (mutación); (b) desactivar una opción rechaza sin dejar filas, **falla** sin el filtro de activas (mutación).
  - Re-corridas: `pedidos-opciones` 18/18; con `pedidos`, `acl`, `vistas-previas`, `billing` y `borrado-de-organizaciones` 184/184; `typecheck` y `lint` limpios.
- **Pendiente:** ronda de verificación de Codex sobre el commit de las correcciones, la **aprobación humana** y recién entonces la migración en staging.

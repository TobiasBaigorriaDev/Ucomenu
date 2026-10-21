# Cambio: Carta central con precio, disponibilidad y visibilidad por sucursal (nivel 2a)
Estado: **hecho** — aprobado por el usuario, subido a `origin` y desplegado en staging (2026-10-21) (Codex: 3 rondas; el rollback del historial se acepta con su limitación, decisión del usuario)
Nivel: C (precios y publicación de la carta; nuevas escrituras y una RPC con `EXECUTE` para `authenticated`; el historial de precios es un registro de auditoría de solo-agregado). No cambia permisos, planes ni cupos. [ADR 0035](../../docs/decisiones/0035-carta-central-con-ajustes-por-sucursal.md).

## Objetivo
La organización conserva **un solo catálogo** (categorías y orden, identidad, nombres, descripciones, traducciones, fotos, etiquetas, variantes y adicionales, precio base). Cada sucursal puede, sin afectar a las demás: tener un **precio propio** de un plato, marcarlo **agotado** (ya existía) y **ocultarlo** de su carta. Quien crea un plato decide en qué sucursales se muestra. Sin configuración local todo sigue igual; los locales con una sola sucursal no ven cambios.

## Decisiones
1. **Se extiende `product_availability`** (hoy: agotado por sucursal; ausencia de fila = disponible) con `price_cents integer null` (nulo = hereda el precio base; **cero es válido**) e `is_visible boolean not null default true`. Se conserva el nombre de la tabla y su clave `(branch_id, product_id)`: sin renombrar, sin migrar datos y sin tocar los identificadores de platos, las URL públicas ni los QR. La fila es opcional: sin fila = visible, disponible y con el precio base.
2. **Misma validación de precio** que `products.price_cents` (centavos enteros, `0 … 1.000.000.000`); en el panel se usa `parsePrice`.
3. **Publicación.** La carta de una sucursal sale del catálogo central + los ajustes de ESA sucursal, que se leen **en vivo** (igual que el agotado hoy), así que la caché del catálogo (`carta:{org}`) no cambia ni se invalida. Oculto = ausente (listado, búsqueda y detalle); agotado = visible con su aviso; plato o categoría inactivos globalmente no se publican aunque haya ajuste local; una categoría sin platos visibles no aparece. Los ajustes de una sucursal desactivada se conservan; una sucursal nueva arranca sin ajustes (hereda).
4. **Límites del plan.** No cambian: `enforce_product_limit` cuenta `products.is_active` por organización. Un plato en varias sucursales cuenta una vez, un ajuste local no consume ni libera cupo y un plato activo cuenta aunque esté oculto en todas.
5. **Permisos y mora.** Los de siempre (miembro de la organización con `org_can_write`): las políticas de `product_availability` ya los exigen. `member_branch_views` sigue siendo solo una preferencia. Ocultar en una sucursal no es una frontera de confidencialidad: el catálogo central es público por RLS; es una regla de presentación.
6. **Historial de precios.** `price_history` gana `branch_id` (nulo = precio base). Un trigger registra cada cambio **efectivo** del precio de una sucursal (precio propio contra el efectivo anterior, que puede ser el base); poner un precio igual al base, o quitarlo cuando coincidía, no registra nada. Cambiar el precio base registra una sola fila general. Sigue de solo-agregado y se purga con la organización como hasta ahora.
7. **Alta de un plato con sucursales.** `create_product_in_branches` (RPC `SECURITY INVOKER`: manda la RLS de quien llama) crea el plato y las filas de «oculto» en una sola transacción: un fallo (cupo, cuenta en solo lectura, sucursal ajena) no deja nada. Sin sucursales ocultas equivale al alta de siempre.
8. **Panel.** En «Editar plato», una tarjeta por sucursal con tres controles independientes (visibilidad, disponibilidad y precio propio con «Usar precio general»); cada uno escribe **solo su columna** (estado deseado explícito, sin alternar a ciegas). El alta ofrece «Sucursales donde se muestra». Con una sola sucursal se conserva la pantalla actual. El listado de la carta indica los platos con ajustes.
9. **Fuera de alcance:** cartas independientes, categorías u orden por sucursal, permisos por sucursal, horarios o promociones, cambios de planes, feed de videos. La diferencia de precio de las opciones sigue siendo informativa sobre el precio efectivo.

## Aceptación
- [ ] Una sucursal tiene precio propio (incluido $ 0), lo oculta o lo marca agotado sin afectar a las demás; sin ajustes hereda el precio base y cambiar el base solo afecta a las que heredan; «Usar precio general» quita el ajuste.
- [ ] La carta pública, la búsqueda y el detalle de cada sucursal muestran el precio y la publicación de ESA sucursal; una categoría sin platos visibles no aparece; los inactivos globales no se publican.
- [ ] Un plato nuevo se puede crear visible solo en algunas sucursales, de forma atómica.
- [ ] El cupo del plan no cambia con los ajustes locales; con cuenta en solo lectura o suspendida no se escribe nada; sin sesión ni membresía tampoco.
- [ ] El historial muestra el cambio de precio de una sucursal con su nombre y no registra los que no cambian el precio efectivo.
- [ ] Con una sola sucursal no hay cambios visibles; los identificadores, las URL públicas y los QR no cambian.

## (C) Invariantes
1. Sin fila de ajuste, visible, disponible y con precio base (comportamiento de hoy).
2. Un precio propio nulo hereda; cero es un precio.
3. Un ajuste local nunca publica algo globalmente inactivo ni cambia el conteo del plan.
4. Las escrituras de ajustes exigen miembro de la organización y cuenta editable; ninguna toca otra organización ni otra sucursal.
5. Todo cambio efectivo de precio queda en el historial, con su sucursal; ninguno cambia sin registrarse.
6. Crear un plato y decidir sus sucursales es todo o nada.
7. La carta pública nunca mezcla ajustes de otra sucursal ni de otra organización.

## (C) Fallos y recuperación
| Falla | Resultado |
| --- | --- |
| No se pueden leer los ajustes de la sucursal en la carta pública | La carta falla como cualquier otra lectura (error y reintento); **no** se muestra con precios o platos equivocados. |
| Cuenta en solo lectura o suspendida | La base rechaza la escritura; el panel lo explica y no cambia nada. |
| Alta del plato con cupo agotado o sucursal inválida | Sin plato ni ajustes (transacción única). |
| Dos personas cambian lo mismo a la vez | Gana el último estado deseado; el historial registra cada cambio efectivo. |
| Se desactiva una sucursal | Sus ajustes se conservan para cuando se reactive. |
| Migración mal aplicada | Rollback en la cabecera de la migración (retirar la RPC, el trigger y las columnas nuevas). Rollback: se conservan la columna `branch_id` y sus filas (auditoría de solo-agregado). Limitación conocida: el código anterior las mostraría mezcladas con las del precio general. **Decisión pendiente del usuario** (ver «Revisión independiente»). |
| El alta no puede leer las sucursales | No se crea el plato (mensaje de error): nunca se publica en todas contra lo que se eligió. |
| Se desactiva una sucursal y queda una sola activa con ajustes | La pantalla del plato mantiene los controles mientras haya ajustes, para poder deshacerlos; sin ajustes vuelve a la de siempre. |

## Alcance / fuera de alcance
Ver decisión 9. Incluye migración, carta pública, panel (editar y crear plato, listado), historial de precios, pruebas, ADR 0035 y las aclaraciones de `producto.md` y `arquitectura.md`.

## Evidencia
Commit probado: `2c9c465` (ronda 1) y el commit de correcciones que le sigue. Todo en local; sin push, staging ni despliegue.
- Unitarias `pnpm test`: 758 pasan (incluye `applyBranchSettings`, lectura paginada de ajustes, `loadBranchesToHide`).
- RLS completo `pnpm test:rls`: 942 pasan sobre `2c9c465`; tras las correcciones se repitieron `carta-por-sucursal`, `availability` y `acl` (50 pasan). Nuevo `tests/rls/carta-por-sucursal.rls.test.ts`: valores por defecto, aislamiento entre sucursales, `$ 0` ≠ ausencia, claves inmutables y otra organización, permisos, mora (solo lectura y suspendida), cupo sin cambios, alta atómica con cupo agotado, historial efectivo por sucursal. La matriz de `acl.rls.test.ts` incluye la RPC (INVOKER) y el trigger.
- E2E: `pnpm test:e2e` completo sobre `2c9c465`: 357 pasan, 1 omitida y 1 falla ajena (`superadmin-planes-pagos.spec.ts:180`, 0 ms) que pasa sola (14/14). Tras las correcciones: `carta-por-sucursal` (5), `disponibilidad` y `carta` pasan (a 390 px sin desborde).
- Mutaciones (fallan sin la defensa): quitar el filtro de ocultos; `||` en vez de `??` (rompe `$ 0`); anular el trigger del historial.
- `pnpm typecheck`, `pnpm lint` y `pnpm build` limpios.
- No probado: teléfono real, lector de pantalla, concurrencia real entre dos personas, y nada contra staging o producción.

## Revisión independiente (Codex)
Ronda 1 sobre `2c9c465`: RECHAZAR con 3 hallazgos «importantes», los tres confirmados:
1. El alta ignoraba un error al leer las sucursales y publicaba el plato en todas → ahora `loadBranchesToHide` devuelve `null` y no se crea nada.
2. Con una sola sucursal activa quedaban inaccesibles los ajustes existentes → los controles se muestran mientras haya ajustes y el listado los marca; con prueba E2E.
3. El rollback deja el historial por sucursal mal rotulado para el código anterior → se documenta la limitación (se conservan los datos).
Ronda 2 (verificación) sobre `789133a`: los hallazgos 1 y 2 corregidos, sin regresiones nuevas; el 3 seguía abierto porque solo estaba documentado.
Ronda 3 (verificación) sobre `743110a`: en la ronda 2 había intentado archivar y retirar esas filas en el rollback; Codex lo rechazó con razón (la tabla de archivo no tendría los triggers de solo-agregado, `service_role` podría alterarla y sobreviviría al borrado de la organización, ADR 0026). **Se retiró ese archivo** y se volvió a «conservar y documentar». Se alcanzó el máximo de tres rondas; no hay hallazgos abiertos sobre el comportamiento del cambio, solo este del rollback.
**Decisión pendiente (usuario):** (a) aceptar la limitación del rollback (recomendado: no hay producción y retroceder sería excepcional) o (b) rediseñar el historial por sucursal en una tabla propia, con sus triggers de solo-agregado, clave foránea y purga, de modo que el código anterior no la lea (más migración, más pruebas).

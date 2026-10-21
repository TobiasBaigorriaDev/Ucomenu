# 0012 — Historial de precios: trigger en la misma transacción, solo se agrega y sin borrado en cascada

- Estado: aceptada (el usuario confirmó el 2026-10-14 la lectura para Dueño y Staff, el bloqueo temporal del borrado de organizaciones con historial, la conservación del historial sin claves foráneas y `changed_by = NULL` para lo técnico)
- Fecha: 2026-10-14

## Contexto
El Staff puede cambiar precios (`producto.md`, *Roles y permisos*) y el producto exige que esos cambios queden registrados, sea Staff o Dueño quien los haga. Es dinero y un registro de auditoría: tiene que ser fiel, atribuido a quien lo hizo y a prueba de escritura desde la aplicación. Además, la organización, el plato y la persona pueden desaparecer, y hay que decidir qué pasa con el historial.

## Decisión
Un trigger `AFTER UPDATE OF price_cents` sobre `products`, con `WHEN` por cambio efectivo, inserta en `price_history` dentro de la misma transacción, con la identidad de `auth.uid()` (NULL = operación técnica sin usuario). La tabla solo se agrega: ni la API, ni `service_role`, ni el dueño de la tabla (trigger de solo-agregado) pueden modificarla o borrarla. Lectura: Dueño y Staff de la propia organización. Borrados sin cascada: `organization_id` con `ON DELETE RESTRICT`; `product_id` y `changed_by` sin clave foránea, para que borrar un plato o dar de baja a una persona no se bloquee ni reescriba el historial.

## Alternativas consideradas
- **`ON DELETE CASCADE` desde plato u organización** — el historial desaparecería con un borrado ajeno; descartado hasta tener una decisión de retención aceptada.
- **`ON DELETE RESTRICT` también en el plato** — rompe una regla vigente (el miembro edita el precio y borra el plato, permitido por RLS) y la limpieza de las pruebas.
- **`changed_by` con clave foránea a `auth.users`** — bloquearía dar de baja a un Staff que alguna vez tocó un precio; `SET NULL` le borraría la atribución.
- **Registrar desde la aplicación** (un insert aparte en la acción de servidor) — se puede saltear, no cubre `service_role` ni SQL directo, y no comparte transacción con el cambio.
- **Un `audit_log` genérico (antes/después)** — es el destino de «SuperAdmin» para planes y pagos; para precios se prefirió una tabla tipada con enteros y un índice por plato.

## Cómo se conservan las referencias sin claves foráneas
`product_id` y `changed_by` son columnas `uuid` **sin** clave foránea, a propósito: el historial es un registro de lo que pasó y no puede depender de que el plato o la persona sigan existiendo.
- **Qué las mantiene correctas:** las escribe solo el trigger, dentro de la misma transacción del `UPDATE` (`new.id` del plato y `auth.uid()` de la sesión). La tabla es de solo agregado (sin escritura de la API ni de `service_role`, y un trigger rechaza `UPDATE`, `DELETE` y `TRUNCATE`), así que nadie puede reescribirlas después. Los UUID no se reutilizan, de modo que un id viejo nunca pasa a apuntar a otra cosa.
- **Qué pasa al borrar:** si se borra un plato o se da de baja a una persona, las filas del historial quedan intactas con el mismo id. No hay `CASCADE` (que borraría el registro), ni `SET NULL` (que borraría la atribución), ni `RESTRICT` en el plato (que bloquearía algo que la RLS permite hoy: el miembro edita el precio y borra el plato).
- **Qué se pierde:** la garantía de integridad referencial que daría la base. Se compensa con que la única vía de escritura es el trigger y con que la pertenencia a la organización (`organization_id`, sí con clave foránea) sigue garantizada.
- **Cómo se lee:** la pantalla futura une por `product_id` con `products` y por `changed_by` con las personas **con unión externa** y debe tolerar el faltante («plato eliminado», «persona dada de baja»), mostrando el id si hace falta. Para el nombre del plato se muestra el actual si existe; el historial no guarda nombres.
- **Aislamiento:** al no haber unión obligatoria, la RLS del historial se resuelve solo con `organization_id`; un id de otra organización no filtra nada.

## Consecuencias
- **Restricción temporal aceptada:** una organización con historial no se puede borrar (`ON DELETE RESTRICT`). **Antes de implementar el borrado de organizaciones en «SuperAdmin» (o el de la carta) hay que definir la retención y el procedimiento de purga** (p. ej. apagar el trigger de solo-agregado a propósito, con aprobación humana y registro). Hasta entonces, ese borrado queda bloqueado por diseño.
- El historial de un plato borrado queda con un `product_id` que ya no existe; la pantalla futura debe tolerarlo (mostrar el id o «plato eliminado»).
- `changed_by` NULL significa **«actor técnico no identificado»**: un cambio hecho sin sesión de usuario. No distingue entre `service_role`, `psql` ni el seed, y no se guarda el rol (decisión del usuario para este incremento). Si más adelante hace falta distinguirlos, se agrega una columna nueva sin tocar las filas existentes.
- Si el registro falla, el precio no cambia (misma transacción).
- Los precios de variantes y adicionales (`options`) llevarán su propio trigger cuando existan.
- **Actualización 2026-10-14:** la pantalla de consulta ya existe (ficha `agile/cambios/pantalla-historial-de-precios.md`) y cumple lo anterior: platos y personas con unión por separado y tolerando el faltante («Plato eliminado»; persona dada de baja sin identificar). Además, el filtro por `organization_id` en la consulta de platos es obligatorio: la carta pública hace legibles los platos activos de cualquier local.
- **Actualización 2026-10-20:** la retención y la purga quedaron decididas en el [ADR 0026](0026-purga-del-historial-de-precios.md) (se purga con la organización, tras 30 días de baja, por una función que ningún rol de la API ejecuta). `ON DELETE RESTRICT` y el trigger de solo-agregado siguen igual.

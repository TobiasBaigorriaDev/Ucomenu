# 0010 — Historial de precios: trigger en la misma transacción, solo se agrega y sin borrado en cascada

- Estado: propuesta (la lectura para Dueño y Staff la confirmó el usuario el 2026-10-14; los borrados y la representación de lo técnico esperan su confirmación)
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

## Consecuencias
- Una organización con historial no se puede borrar: el ítem «SuperAdmin» y el borrado de la carta necesitan una política de retención y un procedimiento de purga (apagar el trigger a propósito, con aprobación).
- El historial de un plato borrado queda con un `product_id` que ya no existe; la pantalla futura debe tolerarlo (mostrar el id o «plato eliminado»).
- `changed_by` NULL significa «operación técnica»; quien lea el historial no distingue entre `service_role`, `psql` o el seed.
- Si el registro falla, el precio no cambia (misma transacción).
- Los precios de variantes y adicionales (`options`) llevarán su propio trigger cuando existan.

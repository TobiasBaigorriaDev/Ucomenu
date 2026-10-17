# 0016 — Declaraciones dietarias cerradas y disponibilidad por sucursal en vivo

- Estado: aceptada al integrarse a `main` por decisión del usuario (2026-10-17); la revisión independiente C en sesión limpia no se realizó.
- Fecha: 2026-10-16

## Contexto
El catálogo pertenece a la organización y se cachea para todas sus sucursales. El usuario pidió implementar buscador/filtros dietarios y marcar agotado por sucursal. Producto ya permite al Dueño y al Staff declarar dietas y cambiar disponibilidad; la carta sigue siendo solo consulta.

## Decisión
Guardar tres declaraciones cerradas en `products.dietary_tags`, con un CHECK de valores, forma y nulos. No crear todavía catálogo global administrable ni tabla de unión: no existe un flujo para administrar etiquetas y solo se necesitan tres predicados. La aplicación valida y elimina duplicados. No se deducen unas dietas de otras; cada selección exige la declaración expresa del local. Ampliar el conjunto requiere migración y actualización del contrato. Las políticas de products siguen siendo la autoridad de escritura y publicación.

Guardar disponibilidad en `product_availability`, con una fila como máximo por sucursal y plato. Ausencia significa disponible. `organization_id` participa en ambas referencias compuestas para impedir cruces; solo se actualiza `is_available`, sin mover claves ni borrar por API. Dueño y Staff operan con su sesión, membresía y cuenta editable. La lectura anónima exige la misma cadena de publicación del catálogo.

La disponibilidad se lee por sucursal en cada pedido, separada de la caché de catálogo compartido. No depende del vencimiento de 60 segundos ni de la invalidación para que un agotado se vea al cargar de nuevo. Las pantallas ya abiertas conservan su instantánea hasta recargar. Un fallo de lectura no se interpreta como todos disponibles.

La acción expresa el estado deseado. Intenta UPDATE, después INSERT si no había fila, y repite UPDATE si otro escritor ganó la inserción. Se evita un upsert que necesitara permisos UPDATE sobre las claves inmutables. No se alterna el booleano en la base: repetir una petición conserva la intención. Escrituras simultáneas distintas se resuelven por la última escritura confirmada.

## Consecuencias
No cambia precio, activación ni cupo de platos. Agotado queda visible con su aviso. Buscar y filtrar incluye esos platos y el detalle explica su disponibilidad. No hay cantidades, reservas ni estado por opción.

La migración es aditiva y puede desplegarse antes del código, después de revisar C. Revertir la presentación conserva estados en la tabla. Retirar columnas/tablas con datos requiere respaldo y una migración revisada. Evidencia y aceptación en las fichas de ambos incrementos; no se aplicaron migraciones remotas.

# Tres restaurantes de ejemplo en staging

Estado: preparado para carga. Nivel C por asignación de planes Pro y Premium en `subscriptions`.

## Aceptación

- Crear `patio-oliva` y `fuego-andino` en Pro, y `bruma-bistro` en Premium, sin Dueño asignado.
- Cada local tiene sucursal `centro`, cuatro mesas, tres categorías, once platos con foto, logo y carta pública.
- Solo se usan datos ficticios. No se modifican organizaciones preexistentes, producción ni reglas de planes.

## Invariantes y recuperación

- El cargador exige que la URL coincida con el proyecto indicado y exige `--local` en staging para limitar cada escritura.
- Los ID y slugs nuevos deben estar libres; si un ID corresponde a otro slug, se aborta antes de escribir. La lectura previa en staging confirmó que los tres están libres.
- El plan elegido queda explícito en la definición del local. Tras cargar se comprobarán filas, plan, imágenes en Storage y respuesta de la carta.
- Si falla a mitad de un local, se puede volver a ejecutar para ese slug: completa sucursal y mesas faltantes antes de cargar el catálogo. Antes de cualquier limpieza se comprobará qué filas y archivos alcanzó a crear. No se invoca `--quitar` sobre locales ajenos.

## Evidencia

- `node --check` de ambos módulos y evaluación del catálogo: 11 platos con foto por local; claves de foto existentes.
- Revisión independiente y comprobación de staging: pendientes.

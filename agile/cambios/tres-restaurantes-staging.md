# Tres restaurantes de ejemplo en staging

Estado: hecho en staging (2026-10-28). Nivel C por asignación de planes Pro y Premium en `subscriptions`.

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
- Commits `53ab022` y `b711cbb` para catálogo, plan y protecciones; ajuste documental posterior en el diff.
- Revisión independiente de Claude: primera ronda «aprobar con cambios» (recuperación y alcance); segunda ronda «aprobar», sin regresiones. Informes en `output/revisiones/claude-2afe9a8c-691e-4c3b-9d02-46b48b95c2d8.md` y `output/revisiones/claude-842e7fbc-3d84-4ed5-b9f3-8348ba68394a.md`.
- Carga individual de los tres slugs en el proyecto enlazado de staging; cada ejecución informó 3 categorías, 11 platos con foto, 4 mesas y logo.
- Lectura posterior de base y Storage: planes Pro/Pro/Premium, 33 platos con `image_path`, ningún archivo faltante, tres logos existentes, tres sucursales y 12 mesas. Las tres cartas `https://ucomenu-staging.fly.dev/m/<slug>/centro` respondieron HTTP 200.
- No se corrieron build, RLS ni E2E: no cambió esquema ni aplicación; se verificó directamente el dato remoto y la respuesta pública afectada.

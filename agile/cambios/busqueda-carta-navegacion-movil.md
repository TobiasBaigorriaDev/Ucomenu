# Búsqueda en Carta y navegación móvil

Nivel M. El negocio necesita encontrar un plato por nombre y acceder a las secciones del panel al desplazarse en el celular.

## Aceptación y decisiones

- Buscar por nombre, sin distinguir mayúsculas ni tildes; mostrar coincidencias agrupadas, mensaje si no hay resultados y opción de limpiar. La búsqueda se envía con el botón o Enter.
- Mantener las acciones y el orden real de categorías y platos, incluidos los inactivos.
- Mantener la navegación del panel visible al desplazarse en celulares, sin modificar el riel de escritorio ni otras áreas.

## Evidencia

Diff local sobre `176fae7`: `pnpm typecheck`, `pnpm lint` y `git diff --check` aprobados. Verificación visual móvil y flujo con sesión real pendientes; no se ejecutó E2E.

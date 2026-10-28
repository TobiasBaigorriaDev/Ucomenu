# Búsqueda en Carta y navegación móvil

Nivel M. El negocio necesita encontrar un plato por nombre y acceder a las secciones del panel al desplazarse en el celular.

## Aceptación y decisiones

- Buscar por nombre, sin distinguir mayúsculas ni tildes; mostrar coincidencias agrupadas, mensaje si no hay resultados y opción de limpiar. La búsqueda se envía con el botón o Enter.
- Mantener las acciones y el orden real de categorías y platos, incluidos los inactivos.
- Mantener la navegación del panel visible al desplazarse en celulares, sin modificar el riel de escritorio ni otras áreas.

## Evidencia

Diff local sobre `176fae7`: `pnpm typecheck`, `pnpm lint` y `git diff --check` aprobados. Verificación visual móvil y flujo con sesión real pendientes; no se ejecutó E2E.

Código `8f4f776` subido a `origin/main`. Con autorización del usuario, desplegado en staging Fly v69 desde snapshot Git: imagen `deployment-01M61F36FQM06GXV1EJWFEC8YQ`, digest `sha256:507784c32e85cc495de6816e37ae51704a62fb0ddd1951e31df7484fd5e0f951`. Build y tipos correctos; máquina iniciada con control passing, DNS correcto. `/`, `/login`, `/m/demo/centro` y `/privacidad` responden 200; Carta del panel sin sesión responde 307. Falta comprobación visual en celular y flujo autenticado. Rollback de aplicación: imagen `botones-de80fd1-git` (v68); sin cambios de base.

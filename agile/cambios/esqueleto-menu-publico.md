# Cambio: Esqueleto caminante — bootstrap + menú público de solo lectura
Estado: idea
Nivel: M

## Objetivo
Dejar el proyecto ejecutable de punta a punta con la rebanada vertical más fina posible: un comensal abre el link de una sucursal y ve su carta (categorías y platos con precio), leída desde la base real con aislamiento por organización. De paso quedan fijados el stack, los comandos del proyecto y la forma de probar.

## Comportamiento y aceptación
- [ ] Dado el repo recién clonado, cuando se ejecutan los comandos de instalar, lint, typecheck, tests y build documentados en `AGENTS.md`, entonces todos terminan sin error.
- [ ] Dada una organización semilla con una sucursal, 2 categorías y 3 platos activos, cuando se abre `/m/{org}/{sucursal}` en un viewport de 390 px, entonces se ven las categorías en orden y cada plato con nombre, descripción y precio en formato ARS, sin scroll horizontal.
- [ ] Dado un slug de organización o sucursal inexistente, cuando se abre la ruta, entonces responde 404.
- [ ] Dado un plato inactivo o una categoría inactiva, cuando se abre la carta, entonces no aparecen.
- [ ] Dadas dos organizaciones semilla, cuando se abre la carta de una, entonces no aparece ningún plato de la otra.
- [ ] Dado el rol anónimo, cuando intenta insertar, modificar o borrar en las tablas de carta, entonces la base lo rechaza.

## Alcance / fuera de alcance
- Incluye: proyecto Next.js + TypeScript + Tailwind; Supabase local; primera migración (`organizations`, `branches`, `categories`, `products`) con RLS activado y política de lectura anónima de filas publicables; datos semilla ficticios; página pública de carta; una prueba E2E y pruebas de RLS; completar **Comandos del proyecto** en `AGENTS.md`.
- No incluye: login, panel del dueño, membresías y roles, variantes/adicionales, filtros y buscador, QR de mesa, llamado al mozo, planes, diseño visual definitivo, despliegue.

## Dependencias y riesgos
- **Aprobado por el usuario (2026-10-13):** instalar dependencias del proyecto y la CLI de Supabase, y usar pnpm, Docker, Context7 y Playwright (ver `agile/herramientas-aprobadas.md`). Solo entorno local: nada de proyecto remoto ni despliegue.
- Diseño de la vista: usar la skill `frontend-design`. `react-best-practices` no está instalada; se aplican las buenas prácticas de React/Next.js verificadas con Context7.
- La política de lectura anónima es la primera pieza de seguridad del sistema; las de escritura por membresía llegan con «Núcleo multi-tenant» (nivel C).
- Fijar versiones exactas en el bootstrap y registrarlas (ADR 0001).

## Evidencias de verificación
- Pruebas ejecutadas:
- Pendientes:

## Aprendizajes / cambios de decisión
-

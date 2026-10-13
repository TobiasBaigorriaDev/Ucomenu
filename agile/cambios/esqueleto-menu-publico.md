# Cambio: Esqueleto caminante — bootstrap + menú público de solo lectura
Estado: **hecho** — revisado con `agile-revisar` (Codex, solo lectura: *aprobar con cambios*), correcciones aplicadas e integrado a `main` el 2026-10-13
Nivel: M

## Objetivo
Dejar el proyecto ejecutable de punta a punta con la rebanada vertical más fina posible: un comensal abre el link de una sucursal y ve su carta (categorías y platos con precio), leída desde la base real con aislamiento por organización. De paso quedan fijados el stack, los comandos del proyecto y la forma de probar.

## Comportamiento y aceptación
- [x] Dado el repo recién clonado, cuando se ejecutan los comandos de instalar, lint, typecheck, tests y build documentados en `AGENTS.md`, entonces todos terminan sin error.
- [x] Dada una organización semilla con una sucursal, 2 categorías y 3 platos activos, cuando se abre `/m/{org}/{sucursal}` en un viewport de 390 px, entonces se ven las categorías en orden y cada plato con nombre, descripción y precio en formato ARS, sin scroll horizontal.
- [x] Dado un slug de organización o sucursal inexistente, cuando se abre la ruta, entonces responde 404.
- [x] Dado un plato inactivo o una categoría inactiva, cuando se abre la carta, entonces no aparecen.
- [x] Dadas dos organizaciones semilla, cuando se abre la carta de una, entonces no aparece ningún plato de la otra.
- [x] Dado el rol anónimo, cuando intenta insertar, modificar o borrar en las tablas de carta, entonces la base lo rechaza.

## Alcance / fuera de alcance
- Incluye: proyecto Next.js + TypeScript + Tailwind; Supabase local; primera migración (`organizations`, `branches`, `categories`, `products`) con RLS activado y política de lectura anónima de filas publicables; datos semilla ficticios; página pública de carta; una prueba E2E y pruebas de RLS; completar **Comandos del proyecto** en `AGENTS.md`.
- No incluye: login, panel del dueño, membresías y roles, variantes/adicionales, filtros y buscador, QR de mesa, llamado al mozo, planes, diseño visual definitivo, despliegue.

## Dependencias y riesgos
- **Aprobado por el usuario (2026-10-13):** instalar dependencias del proyecto y la CLI de Supabase, y usar pnpm, Docker, Context7 y Playwright (ver `agile/herramientas-aprobadas.md`). Solo entorno local: nada de proyecto remoto ni despliegue.
- Diseño de la vista: skill `frontend-design`. `react-best-practices` no está instalada; las prácticas de Next 16 se verificaron contra los docs que trae el propio paquete (`node_modules/next/dist/docs`).
- La política de lectura anónima es la primera pieza de seguridad del sistema; las de escritura por membresía llegan con «Núcleo multi-tenant» (nivel C).
- Fijar versiones exactas en el bootstrap y registrarlas (ADR 0001).

## Evidencias de verificación
Ejecutadas el 2026-10-13 sobre una base recién reseteada (`pnpm db:reset`):
- `pnpm typecheck` OK · `pnpm lint` OK (0 errores, 0 warnings) · `pnpm build` OK.
- `pnpm test`: 10/10 (formato ARS y armado de la carta).
- `pnpm test:rls`: 24/24 contra Supabase local (lectura pública, ocultamiento de lo inactivo, escritura rechazada con `42501`, FK compuesta entre organizaciones, precio no negativo).
- `pnpm test:e2e`: 11/11 en Chromium a 390 px (carta, orden, precios, sin desborde, nada inactivo ni de otra organización, navegación por categorías, foco por teclado, 5 rutas con 404).
- **Prueba de mutación de RLS:** con RLS desactivado y `INSERT` concedido a `anon` en las 4 tablas, 12 de 24 pruebas fallan (incluidas las 4 de inserción); restaurado con `db:reset`, vuelven a pasar 24/24. Detectó un defecto de las propias pruebas (inserciones con filas inválidas que fallaban por otro motivo), corregido.
- Revisión visual con capturas a 390 y 1280 px.

- **Clon limpio** (criterio 1, commit `1d0400f`): `pnpm install --frozen-lockfile`, `typecheck`, `lint`, `test` y `build` terminan sin error. Un primer intento falló en `pnpm test` solo porque el clon estaba en una ruta de 291 caracteres (límite de 260 de Windows); repetido en una ruta de 173, pasa. El clon no incluye `.env*`, así que `build` no necesita variables de entorno.

Revisión independiente (`agile-revisar`, segundo agente Codex, solo lectura) — veredicto **aprobar con cambios**; correcciones aplicadas en el commit `87ec7e3`:
- **P2 contrato del slug:** la ruta rechazaba slugs de más de 64 caracteres, pero la base aceptaba cualquier largo. Migración `20261013235625_slug_max_length.sql` (`CHECK char_length(slug) <= 64` en `organizations` y `branches`, constraints nombrados), validación única en `src/lib/slug.ts` (`isValidSlug`) y pruebas de borde 64/65 (unitarias y contra la base).
- **RLS más estricta:** `UPDATE` y `DELETE` exigen `42501` (antes aceptaban cualquier error) y toda la lectura/escritura pública se prueba también con el rol `authenticated` (usuario real sin membresía, creado y borrado por la propia suite).
- Verificación posterior: typecheck, lint y build OK · unitarias 23/23 · RLS 49/49 · E2E 11/11. **Mutación:** al borrar los CHECK de slug, conceder `UPDATE/DELETE` a `authenticated` y apagar RLS en `products`, fallan 15 de 49; tras `db:reset` pasan 49/49. (Conceder `INSERT` a `anon` sin quitar RLS no hace fallar la prueba: sigue rechazando con `42501` porque RLS no tiene política de inserción; son dos capas.)

Decisiones del usuario al cerrar (2026-10-13): `price_history` aprobado; `impeccable` fuera del repo (`.gitignore`); rama principal `main`; analítica básica desde Pro; pack extra WebAR +USD 10/mes por 10 platos.

No probado: dispositivos reales, Safari/iOS, lector de pantalla, rendimiento (LCP) y modo oscuro.

## Aprendizajes / cambios de decisión
- **`cacheComponents` desactivado** (el scaffold de Next 16.4 lo trae activo). Con él, `notFound()` solo devuelve 404 real si se llama antes de que empiece el streaming; una ruta dinámica `/m/[org]/[branch]` obliga a `generateStaticParams` + `use cache` por slug, y cachear por un slug arbitrario de una ruta pública permite llenar la caché con slugs inventados. Sin él, la carta se renderiza por pedido y devuelve 404 verdadero. **El caché de la carta se diseña en el ítem «Rendimiento de la carta pública».**
- La política de lectura de `products` exige categoría activa y la FK compuesta `(category_id, organization_id)` impide mezclar organizaciones a nivel de base.
- Privilegios: se hace `revoke all` y se concede solo `SELECT` a `anon` y `authenticated`; las escrituras se abrirán explícitamente en «Núcleo multi-tenant».
- El CLI de Supabase solo imprime las claves locales si Auth está levantado, por eso `db:start` incluye Auth (se usará en «Acceso del personal»).
- Un servidor `next start` viejo sirve HTML de un build anterior apuntando a CSS que ya no existe: siempre `pnpm build` antes de `test:e2e`.
- **Windows y rutas largas:** `node_modules/.pnpm` genera rutas muy largas; si el repo se clona en un directorio muy profundo (≈ más de 260 caracteres en total) Vitest falla con `ERR_PACKAGE_IMPORT_NOT_DEFINED`. Clonar cerca de la raíz del disco.
- Las claves locales van a `.env.local` (públicas) y `.env.test.local` (clave de servicio, solo pruebas); ambos ignorados por Git.

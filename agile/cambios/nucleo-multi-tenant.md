# Cambio: Núcleo multi-tenant — membresías, roles y RLS de escritura
Estado: **hecho** — revisado con `agile-revisar` (Codex, solo lectura: *aprobar*, sin defectos bloqueantes) e integrado a `main` el 2026-10-14
Nivel: C

## Objetivo
Que la base de datos —no el código de la aplicación— garantice que un usuario con sesión solo lee y escribe lo que su rol permite **dentro de sus organizaciones**, y nada de otra. Es la base de seguridad sobre la que se montan el panel, la sala, los planes y el SuperAdmin.

## Decisiones tomadas (para validar con el usuario si alguna no le cierra)
- **Quién autoriza:** la tabla `memberships` (usuario ↔ organización, rol `owner` | `staff`), consultada en cada pedido por funciones auxiliares. **No se usa el JWT ni `user_metadata`** para autorizar: así quitar una membresía corta el acceso al instante, aunque el token siga vigente.
- **Altas de organización y de membresías:** solo con `service_role` (servidor). Ni `owner` ni `staff` pueden crear, cambiar ni borrar membresías por la API. Evita escalada de privilegios (un staff que se hace `owner`). La gestión de personal por el dueño llega en «Acceso del personal».
- **Sin `platform_admins` todavía:** el SuperAdmin opera desde el servidor con la clave de servicio; su tabla se crea en el ítem «SuperAdmin».
- **Organizaciones y sucursales:** el `owner` puede cambiar solo el **nombre**. `slug` (rompería los QR), `is_active` y `organization_id` quedan fuera de su alcance. Crear y borrar sucursales/organizaciones: solo servidor (la creación de sucursales depende de los límites del plan).
- **Carta (`categories`, `products`):** `owner` y `staff` crean, modifican y borran dentro de su organización (decisión de producto: el Staff gestiona platos y precios). `organization_id` es inmutable por grants por columna.
- **Lectura del personal:** un miembro ve **también lo inactivo** de su organización (el panel lo necesita); el público sigue viendo solo lo publicable.

## Comportamiento y aceptación
Roles de prueba: `owner` y `staff` de la organización A, `owner` de la B, usuario con sesión **sin membresía** y `anon`.
- [x] Dado `owner` o `staff` de A, cuando lee categorías y platos, entonces ve **todo lo de A, inactivo incluido**, y nada de B.
- [x] Dado un usuario sin membresía o `anon`, cuando lee, entonces ve solo lo publicable (igual que hoy).
- [x] Dado `owner` o `staff` de A, cuando crea, modifica (incluido el precio) o borra categorías y platos de A, entonces funciona.
- [x] Dado un miembro de A, cuando intenta insertar, modificar o borrar filas de B, entonces la base lo rechaza o no afecta ninguna fila, y los datos de B quedan intactos.
- [x] Dado un miembro de A, cuando intenta cambiar `organization_id` de un plato o crear un plato con una categoría de B, entonces la base lo rechaza.
- [x] Dado `staff`, cuando intenta modificar organización o sucursales, entonces no afecta ninguna fila; dado `owner`, cuando cambia el nombre, funciona, y cuando intenta cambiar `slug` o `is_active`, entonces la base lo rechaza.
- [x] Dado cualquier usuario por la API, cuando intenta crear, modificar o borrar membresías (incluida la propia) o crear/borrar organizaciones y sucursales, entonces recibe `42501`.
- [x] Dado un `staff`, cuando edita su propio `user_metadata` con `role: owner` y `organization_id` de B, entonces sigue sin poder leer ni escribir en B.
- [x] Dado un miembro con sesión vigente, cuando el servidor le borra la membresía, entonces su siguiente pedido ya no ve lo privado ni puede escribir.
- [x] Dado `owner`, cuando lee `memberships`, entonces ve las de su organización; el `staff` ve solo la suya; el sin membresía ve ninguna; `anon` recibe `42501`.
- [x] Las funciones auxiliares de autorización no se pueden llamar por la API (`anon` ni `authenticated`).
- [x] **Prueba de mutación:** con RLS apagado, con una política abierta o con `organization_id` actualizable, las pruebas fallan; tras restaurar, pasan.

## Alcance / fuera de alcance
- Incluye: migración (tablas `memberships`; esquema `private` con `is_org_member` / `is_org_owner`; políticas; grants por columna), actualización de tipos, pruebas de RLS con usuarios reales de Auth, ADR 0005, ajustes a `docs/arquitectura.md`.
- No incluye: login y pantallas (`Acceso del personal`), alta/baja de personal por el dueño, `platform_admins` y SuperAdmin, planes y límites, `price_history`, estado de mora, tablas de mesas o llamados.

## Dependencias y riesgos
- **Los límites del plan no se aplican todavía.** Mientras tanto un miembro podría crear más platos de los que permite su plan. Mitigación: no hay pantalla que lo exponga; el ítem «Gestión de carta» pasa a depender también de «Planes y entitlements». Se anota en el tablero.
- **La mora tampoco corta escrituras aún** (`has_feature` y el estado de mora llegan con «Planes y entitlements»).
- **Riesgo principal:** fuga entre tenants por una política mal escrita (ver `docs/arquitectura.md`). Mitigación: grants por columna, pruebas de matriz entre dos organizaciones, mutación y revisión por segundo agente.
- Nadie ve ni escribe `memberships` sin pasar por la política; las funciones auxiliares son `SECURITY DEFINER` (necesario para evitar recursión de RLS) con `search_path` vacío, en un esquema no expuesto y con `EXECUTE` solo para `authenticated`.

## Evidencias de verificación
Ejecutadas el 2026-10-14 sobre una base recién reseteada (`pnpm db:reset`), migración `20261014000121_tenant_core_memberships_and_write_policies.sql`:
- `pnpm typecheck` OK · `pnpm lint` OK · `pnpm build` OK · `pnpm test` 23/23 · `pnpm test:e2e` 11/11.
- `pnpm test:rls`: **71/71** (antes 49; con las dos pruebas de la revisión, 81/81, ver abajo): `catalog.rls.test.ts` (lectura pública y escritura anónima, con y sin sesión) y `tenancy.rls.test.ts` (nuevo, con usuarios reales de Auth: owner/staff de A, owner de B, sin membresía y un miembro de dos organizaciones). Cubre todos los criterios de aceptación anteriores.
- **Pruebas de mutación** (cada una rompe una defensa por separado; 8 mutaciones, todas detectadas tras sumar una prueba):
  - RLS apagado en `products` y `categories`: 25 fallan · política de insert de `products` abierta: 2 · `membresías` escribibles por la API: 4 · `is_org_member` siempre verdadero: 20 · autorización agregando `user_metadata`: 1 · el staff puede renombrar organizaciones: 1.
  - `organization_id` actualizable: **sobrevivía** (RLS y la FK compuesta lo tapaban para un miembro de una sola organización). Se agregó la prueba del miembro de dos organizaciones; con la mutación ahora falla.
  - `EXECUTE` de `anon` sobre la función: no es observable por la API (el esquema `private` no está expuesto); se verificó directo en la base: `anon` sin `USAGE` en `private` ni `EXECUTE`, `public` sin `EXECUTE`, `authenticated` con `EXECUTE`.
- Tras `db:reset`, las 71 vuelven a pasar.

Revisión independiente (`agile-revisar`, Codex, solo lectura, 2026-10-14): **aprobar**, sin defectos bloqueantes. Dos mejoras menores, aplicadas:
- **ACL y `search_path` automatizados** (`tests/rls/acl.rls.test.ts`, 8 pruebas, consulta el catálogo dentro del contenedor local de Postgres): las funciones de `private` son `SECURITY DEFINER`, de `postgres`, con `search_path` vacío y `EXECUTE` solo para `authenticated`; `anon` sin `USAGE` en `private`; no hay `SECURITY DEFINER` en `public`; toda tabla de `public` tiene RLS; `memberships` solo con `SELECT` para `authenticated`; `organization_id`, `id`, `slug`, `is_active` y `currency` no son actualizables; `anon` sin permisos de escritura. Funciona también como guardia para tablas y funciones futuras.
- **Escritura del usuario autenticado sin membresía** (`tenancy.rls.test.ts`): `INSERT` rechazado con `42501` en A y B, y `UPDATE`/`DELETE` sin efecto (0 filas o `42501`) con los datos intactos en las cuatro tablas.
- Verificación: typecheck, lint y build OK · unitarias 23/23 · **RLS 81/81** · E2E 11/11.
- Mutaciones de las pruebas nuevas, todas detectadas: `EXECUTE` a `anon` (1 falla), tabla nueva sin RLS (1), `SECURITY DEFINER` en `public` (1), `organization_id` actualizable en `branches` (1), política de `UPDATE` abierta en `categories` (5). La mutación «función sin `search_path` fijo» **sobrevivía** al principio: `proconfig` quedaba `NULL` y la comparación daba `NULL`, no falso; se corrigió con `coalesce(..., false)` y ahora falla.

No probado: login y sesiones reales desde la app (llega con «Acceso del personal»), rendimiento de las políticas con volumen de datos, limpieza de usuarios de prueba si una corrida se interrumpe a la mitad (quedarían usuarios `rls-*@example.test` en la base local; `db:reset` los borra).

## Aprendizajes / cambios de decisión
- **`UPDATE`/`DELETE` fuera de la organización no devuelven error:** RLS oculta las filas y afectan 0. Solo `INSERT` y los permisos por columna devuelven `42501`. La aplicación debe tratar «0 filas» como «no permitido o inexistente».
- **RLS no alcanza para un miembro de dos organizaciones:** puede mover una fila de A a B porque pasa el `WITH CHECK` de ambas. La barrera real es el `GRANT UPDATE (columnas)` sin `organization_id`. Decisión promovida a `docs/decisiones/0005-autorizacion-por-membresia.md`.
- La prueba de mutación volvió a encontrar una defensa sin prueba propia (la de `organization_id`), igual que en el esqueleto: sigue siendo parte del procedimiento para el nivel C.
- Las comprobaciones sobre `NULL` en SQL pueden pasar de largo: `not (... and NULL)` es `NULL` y la fila no se reporta. En pruebas de catálogo usar `coalesce(..., false)` y verificarlas con una mutación.
- `acl.rls.test.ts` ejecuta SQL con `docker exec` porque la API REST no consulta `pg_catalog`; exige Docker encendido y el contenedor `supabase_db_ucomenu`.
- Los viejos tests «`authenticated` no puede escribir» dejaron de ser ciertos (ahora un miembro escribe en su organización); se reemplazaron por la matriz de `tenancy.rls.test.ts` y, para sin membresía, por «0 filas afectadas».

## (C) Invariantes
1. Un usuario nunca lee ni escribe filas de una organización donde no tiene membresía, salvo la lectura pública de filas publicables.
2. `organization_id` no se puede cambiar por la API en ninguna tabla.
3. Ningún rol de la API puede crear, modificar ni borrar membresías ni elevarse de rol.
4. La autorización sale de la tabla `memberships`, nunca del JWT ni de `user_metadata`.
5. La lectura pública sigue mostrando únicamente lo publicable.
6. (Se aplica en «Acceso del personal») Una organización no puede quedarse sin `owner`.

## (C) Fallas y manejo de errores
- Sin sesión (`anon`): las escrituras devuelven `42501`; las lecturas devuelven solo lo público.
- Escritura a otra organización: `INSERT` rechazado por `WITH CHECK` (`42501`); `UPDATE`/`DELETE` afectan 0 filas porque `USING` las oculta (la aplicación debe tratar 0 filas como «no permitido o inexistente», sin distinguir).
- Si falla la función auxiliar (por ejemplo, tabla ausente), la política deniega: el fallo es cerrado, no abierto.
- Idempotencia: la migración es de una sola pasada; no hay reintentos ni jobs.

## (C) Seguridad y permisos
Matriz resumida (A = su organización; otra org: siempre denegado):

| Tabla | anon / sin membresía | staff | owner |
| --- | --- | --- | --- |
| organizations | leer activas | leer la propia (incl. inactiva) | + cambiar `name` |
| branches | leer de orgs activas | leer las propias | + cambiar `name` |
| categories | leer activas | leer todo lo propio; crear/editar/borrar | igual que staff |
| products | leer activos en categoría activa | leer todo lo propio; crear/editar (precio incluido)/borrar | igual que staff |
| memberships | nada | leer la suya | leer las de su organización |

Amenazas consideradas: escalada de rol propio, mover filas a otra organización, categoría de otra organización, `user_metadata` manipulado, token vigente tras quitar la membresía, llamada directa a las funciones auxiliares, `UPDATE` sin `WITH CHECK`.

## (C) Migración y rollback
- Migración nueva y **solo aditiva** (tablas, funciones, políticas y grants nuevos; no borra ni altera datos). Se prueba con `pnpm db:reset`. **Nada contra proyectos remotos.**
- Rollback (antes de que exista dato dependiente): `drop policy` de las políticas nuevas, `revoke` de los grants nuevos, `drop table public.memberships`, `drop schema private cascade`. La base vuelve al estado de solo lectura pública. En local basta `git revert` + `pnpm db:reset`.

## (C) Aceptación explícita del riesgo
- El usuario pidió el ítem con nivel C el 2026-10-13 y delegó la ejecución en `agile-iterar`. No hay operaciones destructivas ni contra producción. La revisión de este nivel (`agile-revisar`, segundo agente, solo lectura) se hizo el 2026-10-14 con resultado *aprobar*; el usuario pidió integrar a `main` ese mismo día.

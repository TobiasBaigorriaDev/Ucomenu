# Cambio: Historial de cambios de precio (`price_history`)
Estado: **implementado y verificado en una instancia aislada; sin integrar** — falta la corrida contra la base compartida (otra ventana), la revisión de un segundo agente y la aprobación humana de las decisiones marcadas «a confirmar» (nivel C)
Nivel: **C** (el tablero lo marcaba S; se sube por dinero, permisos y por ser un registro que debe ser a prueba de escritura desde la aplicación)
Rama: `feat/historial-precios` · worktree `../UcoMenu-precios` · **commit base `da20ffd`** (`main` local: incluye gestión de carta `c191728` y mesas y QR `3057b41`/`6762c81`; `origin/main` está atrasada en `0f468a4`)

## Objetivo
Que cada cambio **efectivo** del precio de un plato quede registrado por la base, en la misma transacción: plato, organización, quién lo hizo, cuándo, precio anterior y nuevo en centavos. Cierra el riesgo declarado en `producto.md` (Roles) y `arquitectura.md`: el Staff cambia precios y hoy no queda rastro.

## Decisiones
1. **Qué se registra:** solo un `UPDATE` de `products.price_cents` que cambia el valor. Ni el alta del plato, ni editar otros campos, ni un `UPDATE` que deja el mismo precio. Trigger `AFTER UPDATE OF price_cents ... WHEN (old is distinct from new)`: corre después de RLS y de los triggers `BEFORE` (tope de platos), así que un cambio rechazado no deja nada.
2. **Misma transacción:** el trigger inserta en la misma transacción del `UPDATE`; si el cambio falla o se revierte, el historial también.
3. **Quién:** `(select auth.uid())` de la sesión de base (el JWT que valida la API), nunca un campo del pedido: `products` no tiene columna para eso y el historial no admite escritura por la API. **Operación técnica sin usuario autenticado** (`service_role`, `psql`, seed, migraciones) → `changed_by = NULL`.
4. **Cuándo:** `changed_at = clock_timestamp()` (instante real, no el inicio de la transacción) para ordenar varios cambios de una misma transacción.
5. **Solo se agrega:** sin políticas ni privilegios de `INSERT/UPDATE/DELETE` para `authenticated`; a `service_role` se le revocan escritura, `TRUNCATE`, `REFERENCES` y `TRIGGER` (conserva `SELECT`); un trigger de solo-agregado rechaza `UPDATE/DELETE/TRUNCATE` incluso al dueño de la tabla (una purga deliberada exige apagar el trigger y una decisión de retención, que no existe).
6. **Lectura: Dueño y Staff** de la organización (`private.is_org_member`). *Decisión del usuario, 2026-10-14*: no estaba definida en producto ni ADR (`arquitectura.md` solo decía «el Dueño puede auditar»). `anon`: nada. Se lee también con la cuenta en solo lectura o suspendida (es consulta). La pantalla queda para otro ítem.
7. **Borrados, sin cascada** *(aceptado por el usuario el 2026-10-14, ADR 0012)*:
   - `organization_id` → clave foránea **`ON DELETE RESTRICT`**: una organización con historial no se puede borrar hasta que haya una decisión aceptada de retención/purga. **Restricción a resolver antes de implementar el borrado de organizaciones en «SuperAdmin»** (o el de la carta).
   - `product_id` → **sin clave foránea**: borrar un plato (hoy permitido a Dueño y Staff por RLS) no se bloquea y el historial sobrevive. Se probó la alternativa `RESTRICT` y rompía una regla existente (`tenancy.rls`: el miembro edita el precio y borra el plato).
   - `changed_by` → **sin clave foránea**: dar de baja a una persona borra su usuario de Auth (`personnel.ts`) y no debe bloquearse ni reescribir el historial; la fila conserva el id. El ADR 0012 explica por qué las referencias siguen siendo confiables sin clave foránea (solo las escribe el trigger, la tabla es de solo agregado y los UUID no se reutilizan) y cómo la pantalla futura debe tolerar el faltante.
   - `changed_by = NULL` significa **«actor técnico no identificado»**: no distingue entre `service_role`, `psql` y el seed, y no se guarda el rol (decisión del usuario).
8. Claves: `id uuid` (PK), índices `(product_id, changed_at desc)` y `(organization_id, changed_at desc)` para los listados por plato y por local. `check (old <> new)` y ambos `>= 0`.
9. **Fuera de alcance:** pantalla del historial, variantes/adicionales (`options`; cuando existan llevarán su propio trigger), formularios, diseño de carta, llamados, panel de sala.

## Comportamiento y aceptación
- [x] Dado un plato, cuando el **Dueño** cambia el precio, entonces hay una fila con organización, plato, `changed_by` = Dueño, fecha/hora actual, precio anterior y nuevo.
- [x] Lo mismo con el **Staff**; con dos personas alternando, cada fila lleva a quien hizo ese pedido.
- [x] Mandar el mismo precio (solo o con otros campos), editar nombre/descripción/orden/activo/categoría, o **crear** el plato (por API, activo, inactivo, gratis) **no** registra nada.
- [x] Precio y otros campos en el mismo `UPDATE` → una sola fila; de 0 a X y de X a 0 se registran; un `UPDATE` de varios platos deja una fila por cada plato que cambió.
- [x] Operación técnica (`service_role`, `psql`): `changed_by` es NULL. La identidad también se toma de los claims de la sesión de base por SQL.
- [x] Mandar `changed_by`, `changed_at` u otras columnas del historial en el `UPDATE` de `products` falla y no cambia el precio.
- [x] **Cuenta:** en gracia se registra; en solo lectura y suspendida el cambio se rechaza (0 filas, Dueño y Staff) y no hay fila; el historial se sigue pudiendo leer.
- [x] Una persona de otra organización, sin membresía o `anon` no cambian el precio ni dejan fila; un precio negativo (23514) y el tope de platos activos (53400) tampoco.
- [x] **Rollback:** con `ROLLBACK` no queda ni la fila ni el precio; si un paso posterior de la misma transacción falla, se revierte también la fila; un `UPDATE` multi-fila que falla a mitad no deja historial de las filas que sí cambiaron; con `COMMIT` quedan ambos cambios en orden.
- [x] **Protección:** Dueño y Staff no insertan, modifican ni borran (42501) ni en su propia organización; `anon` no lee ni escribe; `service_role` lee pero no escribe; el dueño de la tabla no puede `UPDATE/DELETE/TRUNCATE` sin apagar el trigger; filas incoherentes (sin cambio, negativas, organización inexistente) se rechazan; las funciones del trigger no tienen `EXECUTE` para la API.
- [x] **Aislamiento:** cada organización ve solo lo suyo, sin filtro y filtrando por el id de la otra (organización o plato); quien no es miembro no ve nada; el plato es público en la carta pero su historial no.
- [x] **Borrados:** organización con historial → 23503 y todo intacto; plato (y categoría en cascada) con historial se borra y el historial queda, legible para su organización y no para otra; baja de una persona no se bloquea y la fila conserva `changed_by`.
- [x] Seed: filas de ejemplo (Staff, Dueño y una técnica en Café Ejemplo; Staff en Parrilla Demo) coherentes con el precio actual; el Staff de Café las ve y no ve las de Parrilla.

## Dependencias y riesgos
- Depende de `products` (gestión de carta), `memberships`/`private.is_org_member` (ADR 0005) y de `org_can_write` (ADR 0006); no cambia ninguno de los tres.
- **Consecuencia en pruebas existentes** (ya resuelta en RLS): `deleteOrg` purga el historial de la organización de prueba como dueño de la tabla (sin eso, la organización no se podría borrar y los `slug` fijos de `tt-*` chocarían en la corrida siguiente); la matriz de `acl.rls.test.ts` declara las dos funciones nuevas y los permisos de la tabla; `sql()` acepta `SUPABASE_DB_CONTAINER` (valor por defecto sin cambios).
- **Consecuencia en E2E** (resuelta al fusionar `main`): `createTenant().cleanup()` (`e2e/support.ts`) y la limpieza previa de `tests/rls/global-setup.ts` purgan el historial con `tests/rls/purge-price-history.ts` (psql en el contenedor, como dueño de la tabla, apagando un momento el trigger de solo-agregado) antes de borrar la organización; sin eso, `RESTRICT` dejaba locales `e2e-*`/`tt-*` sin borrar.
- Una purga o una baja de organización exige una decisión de retención (ADR 0012); el ítem «SuperAdmin» y el borrado de la carta deben tenerlo en cuenta.
- `database.types.ts` se editó a mano con el formato del generador (la imagen de `postgres-meta` no está descargada y no se instalan herramientas); hay que regenerarlo con `pnpm db:types` cuando se integre.

## Evidencias de verificación
Contra una **instancia Supabase aislada** (otro `project_id` y puertos, ver abajo); la base compartida `supabase_*_ucomenu` no se tocó.
- `pnpm test` 107/107 · `eslint` sin hallazgos · `next typegen` + `tsc --noEmit` OK.
- RLS completo en la instancia aislada: **322/322** (286 previos + 35 de `price-history.rls.test.ts` + 1 de permisos en `acl.rls.test.ts`) con tiempos de prueba ampliados a 90 s. Con los tiempos por defecto fallaron por **5 s de tiempo agotado** los tests de concurrencia de `owners` (2) y `personnel` (3), que no usan precios (con dos Supabase y otros agentes en la máquina), y `catalog` falló por organizaciones `tt-*` que esas fallas dejaron sin borrar. El archivo `price-history.rls.test.ts` pasa con los tiempos por defecto.
- **Mutaciones (15, de a una, cada una detectada):** trigger sin `WHEN`; sin `OF price_cents`; también en `INSERT`; `changed_by` siempre NULL; organización equivocada; política `for all` + grants a `authenticated`; lectura `using (true)`; sin política de lectura; `anon` con lectura; `service_role` con escritura; sin trigger de `UPDATE/DELETE`; sin trigger de `TRUNCATE`; FK de organización en `CASCADE`; `changed_by` con FK a `auth.users`; `EXECUTE` de la función del trigger para `authenticated`. No se probó la variante `BEFORE` en vez de `AFTER`.
- **Pendiente (no ejecutado):** corrida contra la base compartida (necesita ventana exclusiva); E2E (`pnpm build` + `test:e2e`: no hay cambios de interfaz, pero el cleanup de E2E es el punto descrito arriba); revisión de un segundo agente.

### Tras fusionar `main` (llamado incluido) — 2026-10-14
Se fusionó `main` (`ca04004`) en esta rama (sin tocar `main`). Conflictos resueltos a mano solo en documentación y `tests/rls/helpers.ts` (`deleteOrg` conserva el reintento de `main` y la purga del historial). El ADR de esta rama pasó de 0010 a **0012** (0010 es el del llamado y 0011 el del panel de sala, que está en `feat/panel-de-sala`). Instancia aislada reseteada con las migraciones fusionadas y el seed.
- `vitest` 123/123 · `eslint` sin hallazgos · `tsc --noEmit` OK.
- **RLS 346/346** con los tiempos por defecto (ya endurecidos en `main`); sin restos `tt-*` al terminar. Las 5 pruebas de concurrencia que antes agotaban el tiempo pasan.
- **Primera pasada (entorno defectuoso, superada):** E2E 102/104 con un build con webpack y `node_modules` enlazado: el CSS salía sin utilidades de Tailwind (`llamados.spec.ts:47` y `mesas.spec.ts:221`). No era del historial.
- La limpieza de E2E con historial quedó escrita pero ningún E2E de esta rama edita precios todavía: su efecto se probó solo por las pruebas de RLS (`deleteOrg`, `global-setup`).

### Verificación final con `node_modules` propio — 2026-10-14
`node_modules` del *worktree* propio (`pnpm install --frozen-lockfile`, lockfile sin cambios; el del checkout principal intacto) e instancia Supabase aislada (`ucomenu-precios`, reseteada con las migraciones de la rama + seed). La base compartida no se reseteó ni se tocó.
- `pnpm test` **123/123** · `pnpm lint` sin hallazgos · `pnpm typecheck` OK.
- `pnpm test:rls` **346/346** con base fresca y tiempos por defecto.
- `pnpm build` OK (Turbopack). El CSS generado trae `min-h-12` y `print\:hidden`.
- `pnpm test:e2e` **104/104** (sin restos `e2e-*`/`tt-*` al terminar).
- **Tipos:** `supabase gen types typescript --local` contra la instancia aislada produce un archivo idéntico (salvo fin de línea) al `database.types.ts` editado a mano: no hay cambios que commitear.
- Mutaciones: no se repitieron (la migración y las pruebas de `price-history` no cambiaron desde las 15/15 detectadas).
- **Pendiente:** revisión de un segundo agente (solo lectura). Corrida en la base compartida solo cuando haya ventana y tras integrar (`pnpm db:reset` de quien integre).
### Revisión de Codex (solo lectura, `ca04004..393f0da`) — Aprobar con cambios
- **P2 corregido:** la purga de pruebas (`tests/rls/purge-price-history.ts`) solo validaba la URL de la API en `global-setup`, no el destino real de Docker. Ahora `asegurarDestinoLocal` rechaza, antes de ejecutar SQL, un contenedor que no sea `supabase_db_*` y un daemon que no sea local (`DOCKER_HOST`, o el contexto activo; `ssh://` y `tcp://` remoto se rechazan). Se aplica también a `sql()` de `tests/rls/helpers.ts`. Prueba sin base: `tests/unit/purge-price-history.test.ts` (6; `vitest.config.mts` incluye `tests/unit`); un mutante (aceptar cualquier daemon) hace fallar 2.
- **Segunda ronda de Codex: P2 de precedencia, corregido.** Docker da prioridad a `DOCKER_CONTEXT` sobre `DOCKER_HOST`; la validación hacía lo contrario. `daemonEfectivo(env, inspeccionar)` respeta ese orden (contexto → host → contexto activo) y rechaza nombres de contexto que empiezan con `-`. 10 pruebas sin base en `tests/unit/purge-price-history.test.ts` (incluye `DOCKER_HOST` local + `DOCKER_CONTEXT` remoto → rechazo); un mutante que ignora `DOCKER_CONTEXT` hace fallar 4. Camino real comprobado a mano: contenedor local aceptado y `DOCKER_CONTEXT=inexistente` rechazado.
- Tras la corrección, en la instancia aislada: unitarias **129/129** · lint y typecheck OK · RLS **346/346** · E2E **104/104**.

- Límite conocido: ningún E2E edita precios por la interfaz, así que la purga de `createTenant().cleanup()` solo se ejerce por las pruebas de RLS (`deleteOrg`, `global-setup`).

### Cómo se levantó la instancia aislada
`supabase start --workdir <carpeta temporal>` con una copia de `supabase/config.toml` con `project_id = "ucomenu-precios"` y puertos 55420–55429 (API 55421, base 55422), `migrations/` como enlace al worktree y copia de `seed.sql`; mismas exclusiones que `pnpm db:start`. Las pruebas se corrieron con `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55421`, las claves de esa instancia y `SUPABASE_DB_CONTAINER=supabase_db_ucomenu-precios`. Nada de esto está en el repositorio. Se apagó al terminar (`supabase stop --workdir <carpeta>`); la base compartida siguió encendida y sin cambios.

## Aprendizajes / cambios de decisión
- Primera versión con `ON DELETE RESTRICT` también en el plato: rompió `tenancy.rls` (miembro edita el precio y borra el plato, que la RLS permite) y la limpieza de las pruebas. Se pasó a «sin FK al plato» y `RESTRICT` solo en la organización.
- Un plato público (carta) no filtra su historial: la lectura del historial exige membresía aunque el plato sea legible por `anon`.

## (C) Invariantes
- Cada `UPDATE` que cambia `products.price_cents` deja exactamente una fila, en la misma transacción; ninguna otra operación deja filas.
- `old_price_cents <> new_price_cents`, ambos `>= 0`; la fila lleva la organización del plato.
- `changed_by` es `auth.uid()` de la sesión o NULL (operación técnica); nunca un valor del pedido.
- Las filas no cambian ni se borran por la API, `service_role` ni por un borrado de otra tabla; el aislamiento entre organizaciones se mantiene (lectura solo para miembros de la propia).

## (C) Fallas y manejo de errores
- Si la inserción del historial falla (p. ej. una restricción), el `UPDATE` del precio también falla: preferimos no cambiar el precio a cambiarlo sin rastro.
- Un `UPDATE` bloqueado por RLS/mora afecta 0 filas sin error (comportamiento existente) y no deja fila.
- El borrado de una organización con historial falla con 23503 (`RESTRICT`): el caso queda visible y hay que decidir una purga.

## (C) Seguridad y permisos
- Función del trigger `SECURITY DEFINER`, `search_path` vacío, sin `EXECUTE` para `anon`/`authenticated`/`public`; en la matriz de `acl.rls.test.ts`.
- Lectura por RLS con `private.is_org_member`; sin acceso `anon`; sin privilegios de escritura para ningún rol de la API.
- Riesgo residual: quien tenga la base como `postgres`/superusuario puede apagar el trigger de solo-agregado (por diseño: purga deliberada).

## (C) Migración y rollback
- `20261014061500_price_history.sql`: aditiva (tabla, 3 triggers, 1 política), sin tocar datos ni `products`. Rollback local: `git revert` + `pnpm db:reset`. Con datos: `drop trigger products_record_price_change on public.products; drop table public.price_history; drop function private.record_price_change(), private.price_history_append_only();` (se pierde el historial). Orden de integración: aplicar la migración antes de desplegar cualquier pantalla que lea la tabla.

## (C) Aceptación explícita del riesgo
- Lectura Dueño y Staff: aceptada por el usuario el 2026-10-14.
- Borrados (RESTRICT en organización, sin FK en plato y persona) y `changed_by = NULL` para lo técnico: **aceptados por el usuario el 2026-10-14** (ADR 0012 `aceptada`). Queda como restricción abierta: definir retención y purga antes del borrado de organizaciones en «SuperAdmin».

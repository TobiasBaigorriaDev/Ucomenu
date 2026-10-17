# Cambio: desactivar y reactivar sucursales

Estado: **Integrado a `main`; migración confirmada en staging** (aprobación humana del cambio: 2026-10-17; comprobación remota: 2026-10-17, 20:17 UTC). Nivel **C**: toca el tope del plan (dinero), la publicación de cartas y QR (exposición) y funciones públicas de base. Rama de implementación: `feat/desactivar-sucursales`.

## Reglas ya decididas
Las fija [gestión de sucursales](gestion-de-sucursales.md), «Decisiones pendientes», punto 1: la inactiva no cuenta para el tope; su carta y los QR de sus mesas dicen «no disponible» (no 404); no admite llamados nuevos y sale de la Sala; reactivar respeta el tope. No se repiten aquí.

## Puntos de partida (verificados en el código el 2026-10-17)
- **Versión vigente de cada función a reemplazar:** `public_menu_status` es la de `20261022100000_historial_slug_sucursal.sql` (ya resuelve alias de slug); partir de ella y no de la original de `plans_and_entitlements`. `resolve_table_qr`: `20261014050902_waiter_calls.sql`. `create_waiter_call`: `20261016140000_cerrar_sesion_al_atender_la_cuenta.sql`. `enforce_branch_limit` y `org_entitlements`: `20261014003848_plans_and_entitlements.sql` y `20261017100000_superadmin_planes_pagos_suspension.sql`.
- **Lecturas de sucursales que hoy no distinguen activas:** `src/lib/public-menu.ts` (filtro con alias), `src/lib/sala/pending.ts`, `src/lib/mesas/tables.ts`, `src/lib/llamados/config.ts`, `src/lib/sucursales/branches.ts`, `src/lib/admin/branches.ts` y el Resumen de `/panel/[org]`.
- **Interacción con los identificadores históricos:** un alias de una sucursal inactiva debe mostrar «no disponible» igual que su dirección actual; los alias siguen reservados mientras esté inactiva.

## Decisiones (aprobadas por el usuario el 2026-10-17, tal como se propusieron)
1. Desactivan y reactivan **solo el Dueño**; el SuperAdmin no, por ahora.
2. Se puede desactivar la **última sucursal activa**, con aviso: la organización queda sin carta pública hasta reactivar.
3. Las **mesas** de una sucursal inactiva se conservan intactas, con tokens y estado; no se tocan.
4. Con la cuenta en **solo lectura o suspendida no se puede reactivar**: sigue la regla de escrituras del catálogo.
5. **Sin `audit_log`**: hoy no se audita nada del Dueño; se agrega solo si el usuario lo pide.

## Implementación (2026-10-17)
- **Migración** `20261023100000_desactivar_sucursales.sql` (aditiva; rollback en su cabecera): `branches.is_active boolean not null default true`; `GRANT UPDATE (is_active)` a `authenticated` (la política `UPDATE` existente ya exige Dueño y cuenta al día; el `INSERT` no recibe la columna, así que nace activa).
- **Tope:** `private.enforce_branch_limit` cuenta solo activas y corre también al **reactivar** (nuevo trigger `before update of is_active`); activa→inactiva nunca se bloquea y renombrar no consume cupo. `org_entitlements.usage.branches` = activas.
- **Publicación:** la política de lectura pública de `branches` exige `is_active`; `public_menu_status` devuelve `inactive` (la cuenta suspendida tiene prioridad) y resuelve alias; `resolve_table_qr` devuelve `status: inactive` y `calls_enabled: false`; `create_waiter_call` responde `unavailable`. La carta pública y el QR muestran «Esta sucursal no está disponible» (200, sin datos de la carta).
- **Panel:** `/panel/{slug}/sucursales` muestra activas e inactivas con «Desactivar» (confirmación con aviso; aviso reforzado si es la última activa) y «Reactivar». Mesas, Llamados, Disponibilidad, Sala, Resumen y la guía de primeros pasos muestran solo sucursales activas. El Resumen avisa si todas están desactivadas.
- **Cuenta bloqueada:** en solo lectura/suspendida no se cambia el estado en ningún sentido (la política `UPDATE` ya lo impone; decisión 4 pedía bloquear la reactivación y se bloquean ambas, por consistencia con las demás escrituras).
- **Llamados pendientes:** no se borran ni se tocan; salen de la Sala mientras la sucursal esté inactiva y reaparecen al reactivar si no vencieron (30 minutos).

## Aceptación
- [x] El Dueño desactiva y reactiva; el tope del plan cuenta solo activas y reactivar sobre el tope se rechaza con mensaje claro.
- [x] Carta (directa, por alias y por QR) de una inactiva: «no disponible», sin datos; el resto de las sucursales no cambia.
- [x] Sin llamados nuevos para sus mesas; sale de la Sala; los pendientes existentes no se pierden.
- [x] Staff, ajenos y anónimos no cambian el estado; cuenta bloqueada tampoco, ni por API directa.
- [x] Migración aditiva y reversible; RLS y E2E de las superficies afectadas con evidencia ligada al commit.

## (C) Invariantes
- Solo el owner de la organización cambia `is_active`, con la cuenta al día; nunca `anon` ni Staff. Ninguna otra columna cambia por esta vía (`slug`, `organization_id` e `id` siguen sin `UPDATE`); no hay `DELETE`.
- Activas ≤ tope del plan en todo momento (alta y reactivación, con *advisory lock* por organización). Desactivar nunca falla por el tope.
- Una sucursal inactiva no se lee por la API pública, no publica carta ni acepta llamados nuevos; sus mesas, tokens y llamados se conservan; su `slug` y alias siguen reservados.
- Ninguna escritura bloqueada queda guardada ni informada como éxito (se piden las filas de vuelta).

## (C) Fallos y recuperación
- Migración en una sola transacción: si falla, no queda nada a medias. Rollback documentado en su cabecera (revocar el privilegio, quitar el trigger, restaurar las cinco funciones y la política anteriores, y borrar la columna solo si no hay inactivas).
- Desactivada por error: «Reactivar» devuelve todo como estaba (mismos QR y mesas). Si no hay cupo, desactivar otra o cambiar de plan.
- Caché de la carta: la sucursal se resuelve siempre en vivo (la caché es por organización), así que desactivar tiene efecto inmediato en la carta.
- Plan reducido por debajo de las activas: igual que antes, no se desactiva nada solo; reactivar/crear quedan bloqueadas hasta bajar.

## Evidencia (2026-10-17, base local compartida; código en `505cbd4`, implementación inicial en `4075b0e`)
`pnpm lint` y `pnpm typecheck` limpios · `pnpm test` 453/453 al implementar (más 2 de mensajes en `sucursales.test.ts`) · `pnpm build` · `pnpm test:rls` completo **628/628** tras `pnpm db:reset` con la migración (21 nuevas en `tests/rls/desactivar-sucursales.rls.test.ts`, repetidas 5 veces la de carrera sin variar; `acl` suma `branches.is_active` como única columna nueva actualizable) · `database.types.ts` regenerado con `pnpm db:types` · `pnpm exec playwright test` completo: **250 pasaron, 2 cayeron y repetidas pasaron** (6 nuevas en `e2e/desactivar-sucursales.spec.ts`, a 390 px; `e2e/sucursales.spec.ts` ajustado: el formulario manipulado ahora toma el primer `input[name="id"]`, porque cada fila suma el formulario de desactivar).
Fallos ajenos al cambio, anotados: `carta.spec.ts` «tope de platos activos» (test de ~46 s, cae bajo carga paralela y pasa solo y con su spec completa 18/18) y, una vez, `sucursales.spec.ts:148` junto con un *worker* caído (`0xC0000409`); ambos pasan al repetir.
Mutaciones en la base (una a la vez, restauradas con `db:reset`): sin el trigger de reactivación → falla el tope (3 pruebas); política pública sin `is_active` → falla la lectura pública; `create_waiter_call` sin el chequeo de sucursal → falla «sin llamados nuevos»; la versión anterior de `create_waiter_call` (estado leído antes del lock) → falla la prueba de carrera.
**No ejecutado en esa validación local:** teléfono real ni aplicación remota. Staging se comprobó después, como se registra abajo; producción sigue fuera de alcance y requiere autorización.

## Verificación de la migración en staging (2026-10-17, 20:17 UTC)

Comprobación desde `fdcb066`, sin ejecutar migraciones, modificar datos ni leer tablas de negocio. Proyecto enlazado confirmado con `pnpm exec supabase projects list --output json`: **`ucomenu-staging`**, `ACTIVE_HEALTHY`.

- `pnpm exec supabase migration list --linked`: las 24 versiones locales y remotas coinciden; incluye **`20261023100000`**. El identificador de versión no indica la fecha de aplicación: la comprobación ocurrió el 17 de octubre.
- `pnpm exec supabase db query --linked --file output/verificacion-staging-desactivar.sql --output json`: consulta exclusivamente a catálogos e historial de migraciones. Registro remoto `20261023100000`, nombre `desactivar_sucursales`; columna `branches.is_active` de tipo boolean, `NOT NULL`, default `true`; RLS habilitada.
- Trigger `branches_enforce_limit_on_activate` instalado como `BEFORE UPDATE OF is_active`, ejecutando `private.enforce_branch_limit()`.
- Política `branches: lectura pública de activas y publicadas` para SELECT de `anon`/`authenticated` exige `is_active`, organización publicada y activa. Privilegio UPDATE de la columna presente en `authenticated` y ausente en `anon` (la autorización por rol de negocio depende además de la política existente, probada en local).
- Los cuerpos remotos de **las cinco funciones** coinciden con el archivo local `supabase/migrations/20261023100000_desactivar_sucursales.sql`: `private.enforce_branch_limit`, `public.org_entitlements`, `public.public_menu_status`, `public.resolve_table_qr`, `public.create_waiter_call`. Comparación por MD5 de `pg_proc.prosrc` y cuerpo SQL local, normalizando CRLF a LF. Incluye la corrección de concurrencia de `create_waiter_call`.

**Resultado:** migración aplicada y objetos comprobados en staging. No se ejecutaron pruebas funcionales ni RLS/E2E contra staging, no se verificó el despliegue de la app en Fly y no se tocó producción. Esta evidencia confirma la base; no sustituye la prueba del flujo en la interfaz desplegada ni una aprobación humana nueva.

## Revisión y aprobación
- **Ronda 1 (Codex, `4075b0e`):** APROBAR CON CAMBIOS, dos hallazgos. (1) **Real y corregido** (`505cbd4`): `create_waiter_call` leía el estado de la sucursal antes de esperar el *lock* de la mesa y podía crear un llamado ya confirmada la desactivación; ahora lo relee después del lock con `FOR SHARE` (orden de bloqueos mesa → sucursal) y hay prueba de carrera que falla sin el cambio. Una primera versión de la prueba no reproducía nada (el *builder* de supabase-js es perezoso y la llamada salía tarde): se detectó rompiendo la defensa y se corrigió. (2) **Válido, atendido:** la ficha no registraba evidencia; está arriba.
- **Ronda 2 (verificación, `505cbd4`):** APROBAR CON CAMBIOS; el código del arreglo quedó confirmado («corregido»). Dos hallazgos. (1) **Real, corregido:** la prueba de carrera usaba esperas fijas y podía pasar con la función anterior si el RPC llegaba tarde. Ahora se sincroniza con `pg_locks` (el retenedor tiene el lock; el llamado espera), el retenedor se libera por stdin sin tiempos fijos (el primer intento con `pg_sleep` chocaba con el `statement_timeout` de `anon`) y falla 3 de 3 contra la función anterior y pasa 5 de 5 con la actual. (2) **Obsoleto:** «la ficha no registra evidencia» describe `505cbd4`; la evidencia entró en el commit de documentación siguiente.
- **Sin ronda 3:** los cambios posteriores a la ronda 2 son solo de la prueba de carrera. Queda a criterio del usuario pedir otra verificación. **Aprobación humana (permisos y tope del plan: nivel C): dada por el usuario el 2026-10-17** («Apruebo todo»); integrado a `main`.

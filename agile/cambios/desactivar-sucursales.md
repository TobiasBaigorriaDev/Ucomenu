# Cambio: desactivar y reactivar sucursales

Estado: **Implementado en `feat/desactivar-sucursales`; pendiente de revisión independiente e integración**. Nivel **C**: toca el tope del plan (dinero), la publicación de cartas y QR (exposición) y funciones públicas de base. Rama sugerida: `feat/desactivar-sucursales`, desde `main`.

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


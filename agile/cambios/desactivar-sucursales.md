# Cambio: desactivar y reactivar sucursales

Estado: **Seleccionado; decisiones aprobadas; sin implementar**. Nivel **C**: toca el tope del plan (dinero), la publicación de cartas y QR (exposición) y funciones públicas de base. Rama sugerida: `feat/desactivar-sucursales`, desde `main`.

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

## Aceptación (borrador)
- [ ] El Dueño desactiva y reactiva; el tope del plan cuenta solo activas y reactivar sobre el tope se rechaza con mensaje claro.
- [ ] Carta (directa, por alias y por QR) de una inactiva: «no disponible», sin datos; el resto de las sucursales no cambia.
- [ ] Sin llamados nuevos para sus mesas; sale de la Sala; los pendientes existentes no se pierden.
- [ ] Staff, ajenos y anónimos no cambian el estado; cuenta bloqueada tampoco, ni por API directa.
- [ ] Migración aditiva y reversible; RLS y E2E de las superficies afectadas con evidencia ligada al commit.

Invariantes, fallos y recuperación: completar al implementar. Evidencia: pendiente.

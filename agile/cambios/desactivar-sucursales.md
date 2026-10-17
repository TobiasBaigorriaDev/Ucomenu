# Cambio: desactivar y reactivar sucursales

Estado: **Seleccionado; sin implementar**. Nivel **C**: toca el tope del plan (dinero), la publicación de cartas y QR (exposición) y funciones públicas de base. Rama sugerida: `feat/desactivar-sucursales`, desde `main`.

## Reglas ya decididas
Las fija [gestión de sucursales](gestion-de-sucursales.md), «Decisiones pendientes», punto 1: la inactiva no cuenta para el tope; su carta y los QR de sus mesas dicen «no disponible» (no 404); no admite llamados nuevos y sale de la Sala; reactivar respeta el tope. No se repiten aquí.

## Puntos de partida (verificados en el código el 2026-10-17)
- **Versión vigente de cada función a reemplazar:** `public_menu_status` es la de `20261022100000_historial_slug_sucursal.sql` (ya resuelve alias de slug); partir de ella y no de la original de `plans_and_entitlements`. `resolve_table_qr`: `20261014050902_waiter_calls.sql`. `create_waiter_call`: `20261016140000_cerrar_sesion_al_atender_la_cuenta.sql`. `enforce_branch_limit` y `org_entitlements`: `20261014003848_plans_and_entitlements.sql` y `20261017100000_superadmin_planes_pagos_suspension.sql`.
- **Lecturas de sucursales que hoy no distinguen activas:** `src/lib/public-menu.ts` (filtro con alias), `src/lib/sala/pending.ts`, `src/lib/mesas/tables.ts`, `src/lib/llamados/config.ts`, `src/lib/sucursales/branches.ts`, `src/lib/admin/branches.ts` y el Resumen de `/panel/[org]`.
- **Interacción con los identificadores históricos:** un alias de una sucursal inactiva debe mostrar «no disponible» igual que su dirección actual; los alias siguen reservados mientras esté inactiva.

## Decisiones abiertas (a confirmar con el usuario antes de implementar)
1. ¿Quién desactiva y reactiva: solo el Dueño (propuesto) o también el SuperAdmin desde `/admin`?
2. ¿Se puede desactivar la última sucursal activa? (propuesto: sí, con aviso; la organización queda sin carta pública hasta reactivar).
3. ¿Las mesas de una sucursal inactiva se conservan intactas, con sus tokens y su estado? (propuesto: sí, sin tocarlas).
4. ¿Cuenta en solo lectura o suspendida: se puede reactivar? (propuesto: no; sigue la regla de escrituras del catálogo).
5. ¿Se registra en `audit_log`? Hoy no se audita nada del Dueño; proponer solo si el usuario lo pide.

## Aceptación (borrador)
- [ ] El Dueño desactiva y reactiva; el tope del plan cuenta solo activas y reactivar sobre el tope se rechaza con mensaje claro.
- [ ] Carta (directa, por alias y por QR) de una inactiva: «no disponible», sin datos; el resto de las sucursales no cambia.
- [ ] Sin llamados nuevos para sus mesas; sale de la Sala; los pendientes existentes no se pierden.
- [ ] Staff, ajenos y anónimos no cambian el estado; cuenta bloqueada tampoco, ni por API directa.
- [ ] Migración aditiva y reversible; RLS y E2E de las superficies afectadas con evidencia ligada al commit.

Invariantes, fallos y recuperación: completar al implementar. Evidencia: pendiente.

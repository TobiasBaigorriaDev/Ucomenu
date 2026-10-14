# Ahora (handoff entre sesiones y agentes)

> Debe poder leerse **aunque Engram o cualquier memoria falle**. Resumen corto: máximo una pantalla. Actualizar al cerrar cada sesión o antes de cambiar de agente.

- **Última actualización:** 2026-10-14 — agente: Claude Code
- **Objetivo actual:** «Planes y entitlements» (nivel C) implementado; Codex pidió dos correcciones (aplicadas); falta confirmarlas e integrar
- **Rama / último commit:** `feat/planes-y-entitlements` (sale de `main`, que está respaldado en GitHub: `origin/main`)
- **Nivel:** C
- **Ficha relevante:** `agile/cambios/planes-y-entitlements.md` (estado: verificado y corregido tras la revisión) · ADR 0006

## Estado
- En `main` (y en GitHub): esqueleto caminante y núcleo multi-tenant, ambos revisados por Codex.
- En la rama: migración `20261014003848_plans_and_entitlements.sql` (tablas `plans`, `addons`, `subscriptions`, `subscription_addons`; estado de mora derivado; límites por trigger con advisory lock; escrituras bloqueadas en solo lectura y suspendida; carta pública oculta si está suspendida; alta con prueba de 14 días; API `org_entitlements` y `public_menu_status`), ruta pública con «Carta temporalmente no disponible», seed con `resto-moroso`, tipos regenerados, ADR 0006, `tests/rls/{billing,limits}.rls.test.ts` y `acl` con matriz cerrada de funciones.
- Reglas del usuario aplicadas (2026-10-14): en `read_only` (días 8–15) y `suspended` (16+) no se escribe catálogo (ni Dueño ni Staff); alta con 14 días de Básico; los topes cuentan activos y bloquean crear y activar (activo → inactivo siempre se permite); `platform_admins`, pagos y auditoría quedan para «SuperAdmin».

## Pruebas (2026-10-14)
- typecheck · lint · build OK · unitarias 23/23 · RLS 176/176 (`catalog`, `tenancy`, `acl`, `billing`, `limits`) · E2E 16/16.
- Mutaciones: 26 defensas rotas de a una, 24 detectadas; 2 equivalentes (política pública de `products` sin `org_is_published`, cubierta por la de `categories`; guarda del trigger de sucursales, cubierta por el permiso de `INSERT`).
- Revisión de Codex (aprobar con cambios), corregido: (1) el trigger de límites filtraba tope y uso de otra organización → ahora verifica pertenencia antes de contar; (2) una sucursal inexistente en una organización suspendida daba 200 → `public_menu_status(org, sucursal)` y 404.
- No ejecutadas: rendimiento de `org_is_published` por fila con volumen, Safari/iOS, lector de pantalla, login desde la app (no existe), LCP, modo oscuro.

## Decisiones recientes
- Estado de mora derivado (`private.billing_state`): bordes inclusivos, gracia hasta +168 h, solo lectura hasta +360 h; «día N» = techo de las 24 h transcurridas.
- `anon` tiene `USAGE` en `private` y `EXECUTE` solo de `org_is_published`; la prueba de ACL fija la matriz de funciones (una función nueva rompe la prueba hasta declararla).
- Carta suspendida: la fila de organización sigue pública (nombre y slug); la ruta responde 200 con aviso y `noindex`.

## Bloqueos y riesgos
- Falta que Codex confirme las dos correcciones (una ronda, solo lectura) antes de integrar.
- Regla para triggers de límite futuros (mesas, modelos 3D): verificar pertenencia antes de contar y no revelar datos del tope a terceros.
- `org_is_published` se evalúa por fila en las políticas públicas: medir en «Rendimiento de la carta pública».
- `service_role` puede dejar una suscripción incoherente; la auditoría llega con «SuperAdmin».
- Trigger de mesas pendiente (la función `org_limit(org, 'tables_per_branch')` ya existe).
- Un `UPDATE`/`DELETE` bloqueado afecta 0 filas sin error; la app debe mostrar el estado con `org_entitlements.can_write`.
- `react-best-practices` no instalada ni aprobada.
- Windows: rutas de más de ~260 caracteres rompen `pnpm test`; `pnpm build` antes de `test:e2e`; `pnpm test:rls` necesita Docker (`docker exec` sobre `supabase_db_ucomenu`).

## Próxima acción probable
1. Confirmación de Codex sobre las correcciones; si pasa, integrar `feat/planes-y-entitlements` a `main` y subir a GitHub.
2. Luego: «Acceso del personal» (login, `/panel`, `/sala`, `/admin`, aviso de mora con `org_entitlements`) y después «Gestión de carta».

## Estado del worktree al cerrar
- `git status` limpio salvo lo ignorado a propósito (`impeccable`).

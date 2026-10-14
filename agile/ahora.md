# Ahora (handoff entre sesiones y agentes)

> Debe poder leerse **aunque Engram o cualquier memoria falle**. Resumen corto: máximo una pantalla. Actualizar al cerrar cada sesión o antes de cambiar de agente.

- **Última actualización:** 2026-10-14 — agente: Claude Code
- **Objetivo actual:** «Núcleo multi-tenant» (nivel C) implementado y verificado; falta la revisión independiente
- **Rama / último commit:** `feat/nucleo-multi-tenant` (sale de `main`, que ya integra el esqueleto caminante)
- **Nivel:** C
- **Ficha relevante:** `agile/cambios/nucleo-multi-tenant.md` (estado: verificado, pendiente de `agile-revisar`)

## Estado
- Primera iteración (esqueleto caminante): cerrada e integrada a `main` (revisada por Codex; slug máx. 64 y RLS reforzada).
- Núcleo multi-tenant: migración `20261014000121_tenant_core_memberships_and_write_policies.sql` (tabla `memberships`, esquema `private` con `is_org_member`/`is_org_owner`, políticas de escritura y grants por columna), tipos regenerados, ADR 0005, `tests/rls/{helpers,catalog,tenancy}.rls.test.ts`.
- Reglas clave: la autorización sale de `memberships` (no del JWT); solo el servidor escribe membresías/organizaciones/sucursales; `organization_id` no se puede cambiar por la API; owner y staff gestionan carta; solo owner renombra organización y sucursal.

## Pruebas (2026-10-14)
- typecheck · lint · build OK · unitarias 23/23 · RLS 71/71 · E2E 11/11.
- Mutación: 8 defensas rotas una por una, todas detectadas (una requirió una prueba nueva: miembro de dos organizaciones).
- No ejecutadas: login/sesiones desde la app (aún no existen), rendimiento de las políticas con volumen, Safari/iOS, lector de pantalla, LCP, modo oscuro.

## Decisiones recientes
- Rama principal `main`. Analítica básica desde Pro. Pack extra WebAR +USD 10/mes por 10 platos 3D. `price_history` aprobado.
- `impeccable` y sus agentes: en `.gitignore`.
- `platform_admins` se crea en el ítem SuperAdmin; el SuperAdmin opera con `service_role` desde el servidor.

## Bloqueos y riesgos
- Los límites de plan y la mora aún no se aplican en las escrituras: «Gestión de carta» depende también de «Planes y entitlements».
- Un `UPDATE`/`DELETE` fuera de la organización afecta 0 filas sin error; la app debe tratarlo así.
- `react-best-practices` no instalada ni aprobada.
- Windows: rutas de más de ~260 caracteres rompen `pnpm test`. `pnpm build` antes de `test:e2e`.

## Próxima acción probable
1. `agile-revisar` del Núcleo con un segundo agente (solo lectura) sobre `feat/nucleo-multi-tenant`; corregir y, si pasa, integrar a `main`.
2. Luego, por dependencias: «Acceso del personal» (login y `/panel`, `/sala`, `/admin`) o «Planes y entitlements».

## Estado del worktree al cerrar
- `git status` limpio salvo lo ignorado a propósito (`impeccable`).

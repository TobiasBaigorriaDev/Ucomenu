# Ahora (handoff entre sesiones y agentes)

> Debe poder leerse **aunque Engram o cualquier memoria falle**. Resumen corto: máximo una pantalla. Actualizar al cerrar cada sesión o antes de cambiar de agente.

- **Última actualización:** 2026-10-13 — agente: Claude Code
- **Objetivo actual:** cerrar la primera iteración (esqueleto caminante) y elegir la siguiente
- **Rama / último commit:** `feat/esqueleto-menu-publico`, commit `1d0400f` (sale de `master`, que tiene `fb5363a` de docs)
- **Nivel:** M
- **Ficha relevante:** `agile/cambios/esqueleto-menu-publico.md` (estado: verificado; pendiente `agile-revisar` e integración)

## Estado
- Hecho: proyecto Next 16 + Supabase local; migración con `organizations`, `branches`, `categories`, `products` (RLS activado, solo lectura pública); seed ficticio; carta pública en `/m/{org}/{sucursal}` con diseño propio; comandos documentados en `AGENTS.md`.
- Archivos relevantes: `supabase/migrations/`, `supabase/seed.sql`, `src/lib/public-menu.ts`, `src/components/menu/`, `tests/rls/`, `e2e/`.

## Pruebas
- Ejecutadas (resultado, 2026-10-13): typecheck OK · lint OK · build OK · unitarias 10/10 · RLS 24/24 · E2E 11/11. Prueba de mutación de RLS: 12/24 fallan con la protección rota, 24/24 al restaurar.
- Clon limpio: instalar, typecheck, lint, test y build OK (en ruta corta; ver riesgo de rutas largas).
- No ejecutadas / pendientes: `agile-revisar`, Safari/iOS y dispositivos reales, lector de pantalla, LCP, modo oscuro.

## Decisiones recientes
- `cacheComponents` desactivado: con él no se obtiene 404 real y cachear por slug público es riesgoso. El caché se diseña en «Rendimiento de la carta pública».
- Privilegios: `revoke all` y solo `SELECT` a `anon`/`authenticated`; las escrituras se abren en «Núcleo multi-tenant».
- Supabase local arranca con Auth (el CLI no muestra las claves sin él) y sin Realtime/Storage/Studio todavía.

## Bloqueos y riesgos
- La skill `impeccable` (con un `.exe`) sigue sin seguimiento y fuera de los commits: no es del kit ni está aprobada.
- `react-best-practices` no instalada ni aprobada.
- Sin plan asignado: analítica básica. Sin precio: pack extra de +10 platos 3D.
- Rama principal: el repo usa `master`, el entorno menciona `main`. Decidir antes de abrir PRs.
- Windows: rutas de más de ~260 caracteres rompen `pnpm test` (ver `AGENTS.md`).
- Un servidor `next start` viejo sirve CSS inexistente tras recompilar: `pnpm build` antes de `test:e2e`.

## Próxima acción probable
- `/agile-revisar` sobre la rama (idealmente con otro agente, solo lectura) y, si pasa, integrar a `master`.
- Siguiente ítem sugerido: «Núcleo multi-tenant» (nivel C): es lo que más riesgo reduce y desbloquea panel, planes y mesas.

## Estado del worktree al cerrar
- `git status` limpio: no — `.agents/skills/impeccable/`, `.claude/skills/impeccable/` y `.claude/agents/` siguen sin seguimiento a propósito.

# Ahora (handoff entre sesiones y agentes)

> Debe poder leerse **aunque Engram o cualquier memoria falle**. Resumen corto: máximo una pantalla. Actualizar al cerrar cada sesión o antes de cambiar de agente.

- **Última actualización:** 2026-10-13 — agente: Claude Code
- **Objetivo actual:** primera iteración cerrada e integrada a `main`; siguiente: «Núcleo multi-tenant» (C)
- **Rama / último commit:** `main` (antes `master`) con el esqueleto caminante integrado
- **Nivel:** M (cerrado)
- **Ficha relevante:** `agile/cambios/esqueleto-menu-publico.md` (estado: hecho)

## Estado
- Hecho: proyecto Next 16 + Supabase local; migraciones `create_catalog_core` y `slug_max_length`; carta pública en `/m/{org}/{sucursal}`; RLS de solo lectura; seed ficticio; comandos en `AGENTS.md`.
- Revisión: `agile-revisar` por Codex (solo lectura) → aprobar con cambios; corregido (slug máx 64 en base y ruta; RLS con `42501` y rol `authenticated`).

## Pruebas (2026-10-13, tras las correcciones)
- typecheck · lint · build OK · unitarias 23/23 · RLS 49/49 · E2E 11/11.
- Mutación de RLS y de los CHECK de slug: 15/49 fallan con la protección rota; 49/49 al restaurar.
- No ejecutadas: Safari/iOS y dispositivos reales, lector de pantalla, LCP, modo oscuro.

## Decisiones recientes
- Rama principal `main`. Analítica básica desde Pro. Pack extra WebAR: +USD 10/mes por 10 platos 3D. `price_history` aprobado (Staff u Dueño).
- Skill `impeccable` (con `.exe`) y sus agentes: ignorados en `.gitignore`; no se versionan.
- `cacheComponents` desactivado; el caché se diseña en «Rendimiento de la carta pública».

## Bloqueos y riesgos
- `react-best-practices` no instalada ni aprobada.
- Windows: rutas de más de ~260 caracteres rompen `pnpm test` (ver `AGENTS.md`).
- `pnpm build` antes de `test:e2e` (un servidor viejo sirve CSS inexistente).

## Próxima acción probable
- «Núcleo multi-tenant» (nivel C): ver su ficha en `agile/cambios/nucleo-multi-tenant.md` cuando exista.

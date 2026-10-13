# Ahora (handoff entre sesiones y agentes)

> Debe poder leerse **aunque Engram o cualquier memoria falle**. Resumen corto: máximo una pantalla. Actualizar al cerrar cada sesión o antes de cambiar de agente.

- **Última actualización:** 2026-10-13 — agente: Claude Code
- **Objetivo actual:** primera iteración: esqueleto caminante (bootstrap + menú público de solo lectura)
- **Rama / último commit:** `master`; primer commit = kit Agile SDD + documentación de la Etapa 1 (ver `git log`)
- **Nivel:** M
- **Ficha relevante:** `agile/cambios/esqueleto-menu-publico.md`

## Estado
- Hecho: exploración, producto, arquitectura, ADR 0001–0004 y backlog. Preguntas abiertas cerradas por el usuario e incorporadas a `docs/producto.md`. Herramientas aprobadas registradas. **Todavía no hay código de aplicación.**
- Archivos relevantes: `docs/producto.md`, `docs/arquitectura.md`, `docs/decisiones/`, `agile/tablero.md`, `agile/herramientas-aprobadas.md`

## Pruebas
- Ejecutadas (resultado): solo `python tools/sincronizar_skills.py --check`: las skills `agile-*` están sincronizadas; `impeccable` difiere entre `.agents/` y `.claude/` (preexistente).
- No ejecutadas / pendientes: todo lo de la ficha; los comandos de `AGENTS.md` siguen en `TODO`.

## Decisiones recientes
- Precios y límites por plan (Básico USD 20 / Pro 40 / Premium 70; add-on WebAR +25) parametrizables en base; cobro manual; prueba de 14 días del Básico sin tarjeta.
- Mora: gracia días 1–7, solo lectura 8–15, carta no disponible desde el 16; estado derivado de fechas.
- Roles: solo Dueño y Staff/Mozo (el Staff gestiona platos, precios, stock y mesas); sin rol de encargado.
- Tarjeta de fidelidad por organización; alta con nombre + teléfono + consentimiento; >10 sucursales: alta + «Principales».
- Supuestos confirmados: cooldown 60 s, vencimiento 30 min, 1 sello/día, identificadores en inglés.
- Aprobado: pnpm, Supabase CLI (solo local), Docker, Context7, Playwright, `frontend-design`.

## Bloqueos y riesgos
- La skill `impeccable` (con un `.exe`) está sin seguimiento y **fuera del commit**: no es parte del kit y no está aprobada en `herramientas-aprobadas.md`. Decidir si se versiona.
- `react-best-practices` no está instalada ni aprobada con fuente y versión.
- Sin plan asignado: analítica básica. Sin precio: pack extra de +10 platos 3D.
- La rama es `master`; el entorno hace referencia a `main` como rama principal. Decidir antes de abrir PRs.

## Próxima acción probable
- `/agile-iterar` sobre `agile/cambios/esqueleto-menu-publico.md`.

## Estado del worktree al cerrar
- `git status` limpio: no — `.agents/skills/impeccable/`, `.claude/skills/impeccable/` y `.claude/agents/` siguen sin seguimiento a propósito.

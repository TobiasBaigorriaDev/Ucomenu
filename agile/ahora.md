# Ahora (handoff)

Actualizado: 2026-10-16 · agente: Claude Code · historial anterior en `agile/historial.md` (no leer salvo un detalle puntual).

## Punto de retomada
- Rama `main`, árbol limpio salvo `.claude/worktrees/` (worktree temporal del agente; sin versionar). `origin/main` en `0feaa45`; en local, sin subir, están la integración de Codex (`231f45e`) y los dos cambios de esta sesión. Subir cuando el usuario lo pida.
- **Hechos esta sesión:** (1) el alta de SuperAdmin crea la **primera sucursal** (migración `20261016120000`; ficha `agile/cambios/alta-con-primera-sucursal.md`). (2) **Textos legales** `/terminos`, `/privacidad` y `/alergenos`, enlazados desde portada, login y carta (ficha `agile/cambios/textos-legales.md`).
- Antes: purga de `waiter_calls` (nivel C, 14 días, ADR 0014) y revisión de Codex automatizada (`pnpm revision:codex`, ver `AGENTS.md`).
- Tras actualizar `main` en otra máquina: `pnpm db:reset` (hay migraciones nuevas).

## Bloqueos y riesgos
- **Los textos legales son un borrador:** necesitan revisión de un abogado/a, el responsable y el email de contacto reales (`NEXT_PUBLIC_CONTACT_EMAIL`) antes de producción; detalle en la ficha de textos legales.
- **La purga no corre sola:** falta programarla (pg_cron u otro) en «Salida a producción»; el texto de privacidad ya promete 14 días. Requiere aprobación de despliegue.
- Sin probar en teléfono real: ticket de visita, pantalla «Llamados» y ahora los textos legales y el formulario de alta (tablero, «Mejoras y deuda técnica»).
- Producción: checklist en el ítem «Salida a producción»; falta el `WAITER_CALL_CLIENT_SECRET` propio.
- Las suites de RLS y E2E comparten base: no correrlas a la vez ni desde dos worktrees.

## Próximo paso
Elegir el próximo ítem desbloqueado del tablero. Opciones: retención de `price_history` (C; prerrequisito del borrado de organizaciones; conviene sesión con el usuario presente), repaso de diseño del historial de precios (S), `expectNoHorizontalOverflow` con falsos aprobados (S), o producto del MVP (variantes, buscador, identidad del local). Preparar «Salida a producción» no requiere aprobación hasta desplegar.

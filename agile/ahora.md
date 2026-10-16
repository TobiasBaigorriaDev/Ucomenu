# Ahora (handoff)

Actualizado: 2026-10-15 · agente: Claude Code · historial anterior en `agile/historial.md` (no leer salvo un detalle puntual).

## Punto de retomada
- Rama `main`, con `origin/main` en `7240d0e`: subir solo cuando el usuario lo pida.
- **Purga de `waiter_calls` (nivel C)**: implementada y verificada en local, ficha `agile/cambios/purga-de-waiter-calls.md`, ADR 0014 (propuesta). `purge_waiter_calls(retención, lote)`: 30 días por defecto, piso de 7, solo `service_role`. Las corridas y mutaciones están en la ficha.
- **Tarea S hecha en paralelo** por otro agente en un worktree: el SuperAdmin que inicia sesión sin `next` aterriza en `/admin` (`aea92a8`, ya en `main`). Su worktree temporal está en `.claude/worktrees/` (sin versionar).
- Primer cambio C con el flujo nuevo, para medir el ahorro: 1 escritor, 1 corrida completa de verificación (más repeticiones filtradas), 1 ronda de revisión (aprobar con cambios: 1 bloqueante y 1 importante, corregidos).

## Bloqueos y riesgos
- **Pendiente de la purga:** (1) que el revisor confirme las correcciones del piso (corte efectivo) y de `SKIP LOCKED`, (2) aprobación del usuario del plazo de 30 días, (3) definir un respaldo o aceptar que lo purgado no vuelve **antes** de programarla en producción (pg_cron u otro: «Salida a producción»).
- Sin probar en teléfono real: ticket de visita y pantalla «Llamados» (tablero, «Mejoras y deuda técnica»).
- Producción: checklist en el ítem «Salida a producción»; falta el `WAITER_CALL_CLIENT_SECRET` propio.
- Riesgos de producto abiertos y recetas locales: `agile/historial.md`, secciones «Bloqueos y riesgos» y «Para usar la app en local».
- Las suites de RLS y E2E comparten base: no correrlas a la vez ni desde dos worktrees. Tras actualizar `main` en otra máquina: `pnpm db:reset` (hay migración nueva).

## Próximo paso
1. Confirmación del revisor sobre las correcciones y, con la aprobación del plazo, pasar la ficha a *integrado* y mover el ítem a «Hecho».
2. Siguiente ítem desbloqueado: retención de `price_history` (prerrequisito del borrado de organizaciones), «primera sucursal en el alta» (S), textos legales (S, ya incluye el identificador derivado de la IP) o el repaso de diseño del historial de precios (S).

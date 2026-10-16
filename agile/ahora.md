# Ahora (handoff)

Actualizado: 2026-10-16 · agente: Claude Code · historial anterior en `agile/historial.md` (no leer salvo un detalle puntual).

## Punto de retomada
- Rama `main`, árbol limpio salvo `.claude/worktrees/` (worktree temporal del agente; sin versionar). `origin/main` sigue en `7240d0e`: subir solo cuando el usuario lo pida. Hay varios commits locales por subir.
- **Hechos esta sesión:** (1) purga de `waiter_calls` (nivel C): `purge_waiter_calls`, **14 días** por defecto, piso de 7, solo `service_role`; ficha `agile/cambios/purga-de-waiter-calls.md`, ADR 0014 aceptada. El usuario fijó los 14 días y **aceptó la pérdida sin respaldo** (2026-10-16). (2) SuperAdmin sin `next` aterriza en `/admin` (`aea92a8`).
- Medición del flujo nuevo en el primer cambio C: 1 escritor, 2 rondas de revisión (la 1.ª, «aprobar con cambios»: un bloqueante y un importante; la 2.ª, aprobada), 1 corrida completa de verificación más repeticiones filtradas. Un agente aparte hizo la tarea S en un worktree sin tocar la base.

## Bloqueos y riesgos
- **La purga no corre sola:** falta programarla (pg_cron u otro) en «Salida a producción»; requiere aprobación de despliegue.
- Sin probar en teléfono real: ticket de visita y pantalla «Llamados» (tablero, «Mejoras y deuda técnica»).
- Producción: checklist en el ítem «Salida a producción»; falta el `WAITER_CALL_CLIENT_SECRET` propio.
- Riesgos de producto abiertos y recetas locales: `agile/historial.md`, secciones «Bloqueos y riesgos» y «Para usar la app en local».
- Las suites de RLS y E2E comparten base: no correrlas a la vez ni desde dos worktrees. Tras actualizar `main` en otra máquina: `pnpm db:reset` (hay migración nueva).

## Próximo paso
Elegir el próximo ítem desbloqueado del tablero. Opciones: retención de `price_history` (C; prerrequisito del borrado de organizaciones), primera sucursal en el alta del SuperAdmin (S), textos legales (S; ya incluyen el identificador derivado de la IP con 14 días), repaso de diseño del historial de precios (S). Si hay dos agentes, separar por archivos y bases: el que toque la base va solo.

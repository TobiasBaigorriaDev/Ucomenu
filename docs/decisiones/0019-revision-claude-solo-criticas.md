# 0019 — Reservar la skill de revisión de Claude a tareas críticas

- Estado: aceptada por pedido del usuario.
- Fecha: 2026-10-17.
- Reemplaza el disparador general de Codex → Claude del [ADR 0018](0018-revision-cruzada-automatica.md).

## Decisión y motivos

Limitar `ciclo-revision-claude` exclusivamente a tareas C. El usuario acotó expresamente el alcance después de integrar las CLI: la revisión automática de Claude debe reservarse a consecuencias críticas, en lugar de acompañar cualquier implementación. La clasificación continúa definida por `AGENTS.md`.

## Consecuencias

Codex solicita a Claude una revisión al completar y verificar una tarea C; no activa esta skill en S/M. Se conservan los dos sentidos del procedimiento y la aprobación humana de operaciones peligrosas. Las opciones de las CLI y la skill existente Claude → Codex no cambian. Uso en la [guía](../revision-entre-agentes.md).

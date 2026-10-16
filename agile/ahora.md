# Ahora (handoff)

Actualizado: 2026-10-15 · agente: Claude Code · historial anterior en `agile/historial.md` (no leer salvo un detalle puntual).

## Punto de retomada
- Rama `main`, árbol limpio tras dos commits locales sobre `af6272e` (SuperAdmin mínimo, nivel C): el orden del repositorio y la simplificación de Agile-SDD (ficha `agile/cambios/simplificacion-agile-sdd.md`, cerrada).
- `origin/main` sigue en `7240d0e`: subir solo cuando el usuario lo pida.
- Tras la revisión de Codex se reclasificó el backlog con el criterio por consecuencias: ahora son **C** la cuenta existente como Dueño, las purgas de `price_history` y `waiter_calls` (esta baja a M si hay respaldo recuperable) y los borrados de mesas y de categorías/platos.
- El código de producto no cambió: la última verificación completa figura en la ficha del SuperAdmin.

## Bloqueos y riesgos
- **Docker Desktop estaba apagado** al cerrar la sesión. Para pruebas de base o E2E: encenderlo, `pnpm db:start` y `pnpm db:reset` (también tras actualizar `main` en otra máquina: migración y seed del SuperAdmin).
- Sin probar en teléfono real: ticket de visita y pantalla «Llamados» (tablero, «Mejoras y deuda técnica»).
- Producción: checklist en el ítem «Salida a producción» del tablero; falta el `WAITER_CALL_CLIENT_SECRET` propio.
- Riesgos abiertos de producto (retención de `price_history`, dato derivado de la IP, contraseñas temporales, almacenamiento) y recetas locales (usuarios del seed, probar desde un teléfono con `next dev`): `agile/historial.md`, secciones «Bloqueos y riesgos» y «Para usar la app en local».
- Las suites de RLS y E2E comparten base: no correrlas a la vez ni desde dos worktrees.

## Próximo paso
1. Elegir el próximo ítem desbloqueado del tablero. Sugerido: **purga de `waiter_calls`** (prerrequisito legal; nivel C) con la ficha de invariantes, fallos y recuperación. Alternativas: retención de `price_history` (prerrequisito del borrado de organizaciones), siguientes incrementos de SuperAdmin o el repaso de diseño del historial de precios (S).
2. Primer cambio C con el flujo nuevo: ficha con invariantes, pruebas RLS/E2E por impacto, **una** revisión independiente en solo lectura y aprobación del usuario. Anotar en la ficha cuántas corridas y rondas hubo, para medir el ahorro.

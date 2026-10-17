# Ahora (handoff)

Actualizado: 2026-10-17 · agente saliente: Claude Code · historial anterior en `agile/historial.md`.

## Punto de retomada

`main` contiene todo el trabajo local hasta ahora: identidad del local, paginación de la carta, buscador y filtros dietarios con su aviso de alérgenos, disponibilidad por sucursal y corrección de slug por SuperAdmin. `main` está subido a `origin/main` (sin CI ni despliegue automático). Evidencia en las fichas respectivas del tablero; no se copia aquí.

## Siguiente tarea (seleccionada)

**[C] Desactivar sucursales**, ficha [desactivar-sucursales](cambios/desactivar-sucursales.md). Las reglas ya están decididas; la ficha trae puntos de partida verificados (qué versión de cada función de base reemplazar, qué lecturas hoy no distinguen sucursales activas) y las **cinco decisiones ya aprobadas por el usuario** (2026-10-17), así que se puede empezar. Crear la rama `feat/desactivar-sucursales` desde `main`. Rigor C: ficha con invariantes, pruebas de RLS y E2E, revisión independiente y aprobación humana.

## Bloqueos y riesgos

- La revisión independiente C de búsqueda y disponibilidad no se hizo en sesión limpia; se integró por decisión del usuario. Opcional: `pnpm revision:codex` sobre `dc4d102..HEAD` cuando vuelva la cuota de Codex.
- Las migraciones de identidad, carta, disponibilidad y slugs existen solo en local; aplicarlas a staging o producción requiere autorización. La base local se reseteó el 2026-10-17 y el seed funciona de cero (RLS completo en verde).
- Producción sigue bloqueada por dominio, Supabase de producción, contacto y revisión legal: [ficha](cambios/salida-a-produccion.md), ADR 0015. RLS y E2E comparten base: no ejecutarlos a la vez.
- Los E2E contra `pnpm dev` usan `e2e/detalle-plato-dev.spec.ts` (variables en el propio archivo); la suite normal corre contra el build.

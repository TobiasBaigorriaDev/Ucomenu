# Ahora (handoff)

Actualizado: 2026-10-17 · agente saliente: Claude Code · historial anterior en `agile/historial.md`.

## Punto de retomada

`main` contiene ahora todo el trabajo local: buscador y filtros dietarios con su aviso de alérgenos, disponibilidad por sucursal, corrección de slug por SuperAdmin y el arreglo del detalle del plato en desarrollo. Integración por avance rápido, decidida por el usuario; sin push ni despliegue. Aceptación y evidencia, en las fichas de [buscador](cambios/buscador-y-filtros-dietarios.md), [disponibilidad](cambios/disponibilidad-por-sucursal.md) y [slug](cambios/correccion-slug-sucursal.md). No se copian resultados aquí.

## Bloqueos y riesgos

- La revisión independiente C de búsqueda y disponibilidad no se hizo en sesión limpia; se integró por decisión del usuario tras una lectura de Claude Code sin hallazgos bloqueantes. Si se desea, hacerla después con `pnpm revision:codex` sobre `dc4d102..HEAD`.
- Las migraciones de identidad, carta, disponibilidad y slugs existen solo en local; ensayo en staging y producción requiere autorización. No se hizo `db:reset` para preservar la demo; conviene hacerlo en algún momento para probar el seed de cero.
- La demo local quedó con la sucursal `centro` y `central` como alias reservado (inofensivo). El slug de una sucursal no se puede liberar una vez usado.
- Producción sigue bloqueada: [ficha](cambios/salida-a-produccion.md), ADR 0015. RLS y E2E comparten base: ejecutar en secuencia.

## Próximo paso

1. Elegir del backlog el ítem desbloqueado de mayor valor; los pendientes grandes (staging, purga, dominio, producción) dependen de decisiones del usuario.
2. Cuando haya autorización: aplicar las migraciones al staging, desplegar `main` y probar con sesión SuperAdmin, sucursales, variantes, disponibilidad y el aviso de alérgenos.
3. Opcional: `db:reset` local y revisión independiente con Codex cuando vuelva la cuota.

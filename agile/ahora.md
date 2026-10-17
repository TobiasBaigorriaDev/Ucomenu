# Ahora (handoff)

Actualizado: 2026-10-17 · agente saliente: Claude Code (Codex sin cuota; el usuario eligió que Claude implemente y pruebe) · historial anterior en `agile/historial.md`.

## Punto de retomada

Corregido el detalle del plato en `pnpm dev` (evidencia en la ficha del buscador). Rama `feat/correccion-slug-sucursal`, desde `5331d0d`; commits de código `6a6a0aa` y cierre documental `8e50471`. La corrección del identificador de una sucursal por SuperAdmin está terminada y verificada de nuevo por Claude Code, sin defectos. Aceptación, comandos y evidencia en [su ficha](cambios/correccion-slug-sucursal.md); motivos en ADR 0017. No se copian resultados aquí.

La rama contiene también búsqueda/filtros dietarios y disponibilidad por sucursal (`ead868e`, `7be826f`, `5331d0d`). Siguen **Para verificar** por revisión independiente C y aprobación humana; esta tarea no las aprueba.

## Bloqueos y riesgos

- Aviso de alérgenos solo dentro del detalle; el listado filtrado no lo repite. Decidir si se muestra junto a los filtros.
- Las migraciones de identidad, carta, disponibilidad y slugs se aplicaron solo en local; ensayo remoto requiere autorización. Nunca se hizo `db:reset` para preservar la demo manual.
- Producción sigue bloqueada: [ficha](cambios/salida-a-produccion.md), ADR 0015. RLS y E2E comparten base: ejecutar en secuencia.

## Próximo paso

1. Revisión independiente C de búsqueda/disponibilidad (sesión limpia o `pnpm revision:codex` cuando vuelva la cuota) y `db:reset` local para comprobar el seed.
2. Con el usuario: probar la corrección de slug desde `/admin` sobre un local de demo; luego integrar la rama y retomar staging.

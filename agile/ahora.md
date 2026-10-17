# Ahora (handoff)

Actualizado: 2026-10-17 · agente saliente: Claude Code · historial anterior en `agile/historial.md`.

## Punto de retomada

`main` está al día en `origin` y en staging están aplicadas todas las migraciones hasta `20261024100000`. Quedó integrado, con aprobación del usuario y de Codex (2 rondas), «SuperAdmin suma una cuenta existente como Dueño de otra organización»: función `admin_add_owner`, auditoría `owner.added`, sección «Sumar un Dueño» en la ficha de la organización. Detalle, riesgo residual aceptado y evidencia en la [ficha](cambios/dueno-existente.md). Antes: desactivar y reactivar sucursales ([ficha](cambios/desactivar-sucursales.md)).

## Bloqueos y riesgos

- Flyctl sigue bloqueado por Application Control de Windows: `main` no está desplegado en Fly staging, así que la app de staging todavía no usa las dos funciones nuevas aunque su base ya tiene las migraciones.
- No se probó en un teléfono real. Producción sigue bloqueada: [ficha](cambios/salida-a-produccion.md), ADR 0015.
- El alta de organización exige un Dueño inicial con cuenta nueva; para un dueño con dos locales se crea la organización con un email provisorio y se suma la cuenta existente (ver la ficha).
- `carta.spec.ts` «tope de platos activos» cae a veces bajo carga paralela y pasa solo.

## Próximo paso

1. Destrabar `flyctl` (política de Windows) y desplegar `main` en staging; probar sucursales, desactivar y sumar un Dueño con una sesión SuperAdmin real.
2. Tarea recomendada: [M] login y sala en vivo con el lenguaje del panel.

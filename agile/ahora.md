# Ahora (handoff)

Actualizado: 2026-10-17 · agente saliente: Claude Code · historial anterior en `agile/historial.md`.

## Punto de retomada

`main` está al día en `origin`, y staging tiene aplicadas las migraciones hasta `20261024100000` y la app de `main` (`8e7396a`) desplegada en Fly (2026-10-17; rutas públicas 200, salud OK). Quedó integrado, con aprobación del usuario y de Codex (2 rondas), «SuperAdmin suma una cuenta existente como Dueño de otra organización»: función `admin_add_owner`, auditoría `owner.added`, sección «Sumar un Dueño» en la ficha de la organización. Detalle, riesgo residual aceptado y evidencia en la [ficha](cambios/dueno-existente.md). Antes: desactivar y reactivar sucursales ([ficha](cambios/desactivar-sucursales.md)).

## Bloqueos y riesgos

- `flyctl.exe` sigue bloqueado por Smart App Control (no está firmado); se despliega con la imagen `flyio/flyctl` en Docker y la sesión en el volumen `ucomenu-fly-config` (procedimiento en `docs/produccion.md`).
- No se probó en un teléfono real. Producción sigue bloqueada: [ficha](cambios/salida-a-produccion.md), ADR 0015.
- El alta de organización exige un Dueño inicial con cuenta nueva; para un dueño con dos locales se crea la organización con un email provisorio y se suma la cuenta existente (ver la ficha).
- `carta.spec.ts` «tope de platos activos» cae a veces bajo carga paralela y pasa solo.

## Próximo paso

1. Probar en staging, con una sesión SuperAdmin real y en un teléfono, sucursales (desactivar/reactivar) y «Sumar un Dueño».
2. Tarea recomendada: [M] login y sala en vivo con el lenguaje del panel.

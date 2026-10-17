# Ahora (handoff)

Actualizado: 2026-10-17 · agente saliente: Claude Code · historial anterior en `agile/historial.md`.

## Punto de retomada

`main` está al día en `origin`, y staging tiene aplicadas las migraciones hasta `20261024100000` y la app de `main` (`8e7396a`) desplegada en Fly (2026-10-17; rutas públicas 200, salud OK). Quedó integrado, con aprobación del usuario y de Codex (2 rondas), «SuperAdmin suma una cuenta existente como Dueño de otra organización»: función `admin_add_owner`, auditoría `owner.added`, sección «Sumar un Dueño» en la ficha de la organización. Detalle, riesgo residual aceptado y evidencia en la [ficha](cambios/dueno-existente.md). Antes: desactivar y reactivar sucursales ([ficha](cambios/desactivar-sucursales.md)).

Integrado a `main` y desplegado en staging (`7fb1ca8`, 2026-10-17): el login y los llamados de la sala en vivo usan el lenguaje del panel (celdas, Gloock + Schibsted, paleta de UcoNext en el login). Solo presentación; E2E completo 257 verdes. [Ficha](cambios/ui-login-y-sala.md).

## Bloqueos y riesgos

- `flyctl.exe` sigue bloqueado por Smart App Control (no está firmado); se despliega con la imagen `flyio/flyctl` en Docker y la sesión en el volumen `ucomenu-fly-config` (procedimiento en `docs/produccion.md`).
- No se probó en un teléfono real. Producción sigue bloqueada: [ficha](cambios/salida-a-produccion.md), ADR 0015.
- El alta de organización exige un Dueño inicial con cuenta nueva; para un dueño con dos locales se crea la organización con un email provisorio y se suma la cuenta existente (ver la ficha).
- `carta.spec.ts` «tope de platos activos» cae a veces bajo carga paralela y pasa solo.

## Próximo paso

1. Probado por el usuario en staging (2026-10-17): desactivar/reactivar sucursales y «Sumar un Dueño» funcionaron bien. Falta probar el login y la sala rediseñados en el teléfono.
2. Elegir otra tarea desbloqueada del backlog (ver el tablero).

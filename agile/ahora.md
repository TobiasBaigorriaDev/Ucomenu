# Ahora (handoff)

Actualizado: 2026-10-26 · agente saliente: Codex. Historia en Git y fichas.

## Punto de retomada

**Propina sugerida por sucursal (nivel C):** rama `feat/propina-sugerida`, implementación `ad2e3cb`, desde `41c82c2`. El usuario aprobó desarrollar la propuesta: configuración en Sucursales por el Dueño, porcentaje y desglose opcional en la cuenta del cliente y en la precuenta imprimible. Alcance, decisiones, revisión aprobada por Claude y evidencia en la [ficha](cambios/propina-sugerida.md). La migración `20261209100000` está aplicada únicamente en la base local. No se autorizó desplegar ni aplicar migraciones remotas. El consumo y la analítica conservan sus importes originales. Disponible para comprobar por el usuario en local.

**Staging permanece en Fly v62**, imagen `personal-sucursal-a14dded`, migración `20261208100000`; esta sesión no cambió su estado. El último registro de despliegue es `41c82c2`. No se subieron commits a origin durante esta sesión.

**Personal por sucursal, solo pantalla (M):** sigue pendiente la comprobación manual con sesiones reales en staging; ver [ficha](cambios/personal-por-sucursal.md) y [tablero](tablero.md). El aislamiento real por RLS sigue en Backlog: hoy las asignaciones filtran las pantallas y una llamada directa todavía puede operar con ids de otra sucursal de la organización.

## Límites y bloqueos

- Producción continúa bloqueada por revisión legal y preparación operativa; ver [ficha legal](cambios/informacion-alimentaria-y-textos-legales.md).
- Siguen abiertas las decisiones sobre etiquetas por sucursal, alergias en observaciones y limpieza de `rate_key`.
- Preservar `tools/escenarios-locales.mjs`, ajeno y sin seguimiento.
- RLS y E2E comparten base: ejecutarlos separados. Para E2E usar build vigente y un worker; los fallos del entorno se registran en la ficha. Docker Desktop es requisito. Siguiente migración libre: `20261210100000`.

## Próximo paso

Probar la propina en local o, con autorización explícita, aplicar primero su migración y después desplegar la app en staging. La ficha explica el rollback compatible. Mantener pendiente la comprobación manual de personal por sucursal y la decisión de subir cambios a origin.

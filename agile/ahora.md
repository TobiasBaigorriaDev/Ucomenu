# Ahora (handoff)

Actualizado: 2026-10-17 · agente saliente: Claude Code · historial anterior en `agile/historial.md`.

## Punto de retomada

`main` está al día en `origin` (desactivar sucursales, revisión cruzada de Codex, ensayos de restauración y Wake Lock) y las migraciones hasta `20261023100000` están aplicadas en staging.

Rama `feat/dueno-existente` (desde `main`, **sin integrar**): SuperAdmin suma una cuenta existente como Dueño de otra organización desde la ficha de la organización («Sumar un Dueño»). Dos pasos: buscar (muestra en qué locales trabaja la cuenta) y confirmar con casilla; la confirmación queda atada al `user_id` mostrado. Función de base `admin_add_owner` (solo `service_role`), auditoría `owner.added`, migración `20261024100000_sumar_dueno_existente.sql`. Detalle, riesgo residual aceptado, evidencia (RLS 644 con acl ajustado, E2E 257 verdes) y las dos rondas de Codex (rechazo con dos hallazgos reales, ya corregidos; luego aprobación) en la [ficha](cambios/dueno-existente.md).

Nivel C: **falta la aprobación humana** de la implementación; el veredicto de Codex no la reemplaza.

## Bloqueos y riesgos

- La migración `20261024100000` existe solo en local. Aplicarla en staging requiere autorización.
- Flyctl sigue bloqueado por Application Control de Windows: `main` no está desplegado en Fly staging, así que la app de staging no usa aún lo último.
- El alta de organización sigue exigiendo un Dueño inicial con cuenta nueva; el flujo para un dueño con dos locales está en la ficha.

## Próximo paso

1. Que el usuario apruebe (o corrija) `feat/dueno-existente`; luego integrar a `main`, subir y, con autorización, aplicar la migración en staging.
2. Siguiente tarea recomendada: [M] login y sala en vivo con el lenguaje del panel.

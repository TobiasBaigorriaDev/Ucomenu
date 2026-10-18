# Ahora (handoff)

Actualizado: 2026-10-18 · agente saliente: Claude Code · historial anterior en `agile/historial.md`.

## Punto de retomada

Rama **`feat/aviso-push-llamados`** (sale de `main` en `1645ddd`; `main` no se tocó): [aviso de llamados con la pestaña cerrada por Web Push](cambios/aviso-push-de-llamados.md), Android y Windows (C, [ADR 0020](../docs/decisiones/0020-aviso-de-llamados-por-web-push.md)). Implementado, revisado por Codex en tres rondas (todos los hallazgos reales corregidos con regresión; la última corrección sin cuarta verificación) y **probado por el usuario en su Chrome de Windows con la sala cerrada (2026-10-18)**.

**Desplegado a staging** (2026-10-18): migración `20261025100000` aplicada, claves VAPID propias en los secretos de Fly, app en `https://ucomenu-staging.fly.dev`. Producción no tocada; sin integrar a `main`. La base local tiene la misma migración.

## Bloqueos y riesgos

- Falta probarlo en un **Android** contra staging: hace falta una cuenta en una organización con plan Pro y una mesa (la organización `demo` de staging no tiene cuentas; se suma una desde SuperAdmin).
- En Windows el aviso solo llega si Chrome/Edge siguen en ejecución; iPhone es otro ítem.
- `.env.local` tiene claves VAPID de prueba (no versionado) y `cafe-ejemplo` quedó en plan Pro en la base local (`pnpm db:reset` lo revierte).
- `flyctl.exe` lo bloquea Smart App Control: se despliega con la imagen `flyio/flyctl` (ver `docs/produccion.md`). Producción sigue bloqueada (ficha `salida-a-produccion`).

## Próximo paso

1. Probar en Android contra staging; si va bien y el usuario aprueba, integrar a `main`, pasar el ítem a «Hecho» y seguir con «Aviso también desde el panel».
2. Decidir si se pide una cuarta verificación a Codex (la regla manda consultar tras la tercera).

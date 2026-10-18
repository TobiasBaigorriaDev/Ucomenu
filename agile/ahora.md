# Ahora (handoff)

Actualizado: 2026-10-18 · agente saliente: Claude Code · historial anterior en `agile/historial.md`.

## Punto de retomada

[Aviso de llamados con la pestaña cerrada por Web Push](cambios/aviso-push-de-llamados.md) (C, [ADR 0020](../docs/decisiones/0020-aviso-de-llamados-por-web-push.md)): **integrado a `main` y subido a `origin`**, aprobado por el usuario tras probarlo en Windows y en Android contra staging (2026-10-18). Revisado por Codex en tres rondas.

Staging está al día: migraciones hasta `20261025100000` aplicadas, app desplegada en `https://ucomenu-staging.fly.dev` y claves VAPID propias en los secretos de Fly. Producción no existe todavía. La base local quedó en seed limpio.

## Bloqueos y riesgos

- **Producción:** sigue bloqueada (dominio, proyecto de Supabase de producción, revisión legal; ficha `salida-a-produccion`). Al salir hay que generar **otro par VAPID** (`pnpm push:claves`) y cargarlo como secreto; `pnpm prod:check` lo verifica.
- En Windows el aviso solo llega si Chrome/Edge siguen en ejecución; iPhone queda en el tablero (PWA).
- `.env.local` conserva claves VAPID de prueba (no versionado).
- `flyctl.exe` lo bloquea Smart App Control: se despliega con la imagen `flyio/flyctl` (ver `docs/produccion.md`).
- `revision-codex.test.ts › --uncommitted` falla solo con cambios sin confirmar en `.env.example`.

## Próximo paso

Elegir una tarea desbloqueada del [tablero](tablero.md). Recomendada: **[M] aviso de llamados también desde el panel** (`/panel/{slug}`), que ahora está desbloqueada; reutiliza `src/lib/push/registration.ts` y el service worker. Alternativas: lectura de pagos y auditoría por el Dueño (C) o la retención de `price_history` (necesita política del usuario).

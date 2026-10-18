# Ahora (handoff)

Actualizado: 2026-10-18 · agente saliente: Claude Code · historial anterior en `agile/historial.md`.

## Punto de retomada

[Aviso de llamados también desde el panel](cambios/aviso-push-desde-el-panel.md) (M): **implementado y confirmado en la rama `feat/aviso-push-panel`**, sin integrar a `main`. El Resumen del panel (`/panel/{slug}`) ofrece activar el aviso con el plan que incluye el llamado y claves VAPID; el bloque y el hook `usePush` ahora viven en `src/components/push/` y los comparten la sala y el panel. No cambia el esquema ni el envío; el registro sigue siendo por local y dispositivo. Pruebas en local verdes (ver la ficha). El item está en «Para verificar» del tablero.

Base de [aviso con la pestaña cerrada](cambios/aviso-push-de-llamados.md) (C, [ADR 0020](../docs/decisiones/0020-aviso-de-llamados-por-web-push.md)): en `main` y en staging (`https://ucomenu-staging.fly.dev`, migraciones hasta `20261025100000`). Staging **todavía no tiene** el aviso desde el panel.

## Bloqueos y riesgos

- **Producción:** sigue bloqueada (dominio, proyecto de Supabase de producción, revisión legal; ficha `salida-a-produccion`). Al salir hace falta **otro par VAPID** (`pnpm push:claves`); `pnpm prod:check` lo verifica.
- En Windows el aviso solo llega si Chrome o Edge siguen en ejecución; iPhone queda en el tablero (PWA).
- Regla vigente del service worker: no avisa solo si esa sala está a la vista **y con foco**; con la sala visible en otro monitor y el panel con foco, avisa (preferible repetido a perdido). El usuario puede pedir relajarla a «solo a la vista».
- `.env.local` conserva claves VAPID de prueba (no versionado). `flyctl.exe` lo bloquea Smart App Control: se despliega con la imagen `flyio/flyctl` (ver `docs/produccion.md`).
- Si el editor guarda una copia vieja de un archivo de `agile/`, lo pisa (pasó con `tablero.md`): recargar o revertir, nunca sobrescribir.

## Próximo paso

El usuario prueba el aviso desde el Resumen en su dispositivo (local o staging). Si lo aprueba: integrar la rama a `main`, pasar el ítem a «Hecho» y, si quiere, desplegar a staging. Después, elegir otra tarea desbloqueada del [tablero](tablero.md) (por ejemplo lectura de pagos y auditoría por el Dueño, nivel C).

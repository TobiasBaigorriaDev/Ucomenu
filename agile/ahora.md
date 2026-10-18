# Ahora (handoff)

Actualizado: 2026-10-18 · agente saliente: Claude Code · historial anterior en `agile/historial.md`.

## Punto de retomada

[Aviso de llamados también desde el panel](cambios/aviso-push-desde-el-panel.md) (M): **implementado y confirmado en la rama `feat/aviso-push-panel`**, sin integrar a `main`. Lo pedido era poder navegar el panel y ver arriba un aviso si una mesa llama: un **cartel fijo dentro del panel** (`llamados-banner.tsx`, sondea `/sala/{slug}/estado`) lo hace; además el Resumen ofrece activar el aviso del sistema (plan con llamado y claves VAPID). El bloque y el hook `usePush` ahora viven en `src/components/push/` y los comparten la sala y el panel. No cambia el esquema ni el envío; el registro sigue siendo por local y dispositivo. Pruebas en la ficha; el ítem está en «Para verificar».

Base ([aviso con la pestaña cerrada](cambios/aviso-push-de-llamados.md), [ADR 0020](../docs/decisiones/0020-aviso-de-llamados-por-web-push.md)): en `main` y en staging (`https://ucomenu-staging.fly.dev`), que **todavía no tiene** esto.

## Bloqueos y riesgos

- **Producción:** sigue bloqueada (dominio, proyecto de Supabase de producción, revisión legal; ficha `salida-a-produccion`). Al salir hace falta **otro par VAPID** (`pnpm push:claves`); `pnpm prod:check` lo verifica.
- En Windows el aviso del sistema solo llega con Chrome o Edge en ejecución; iPhone queda en el tablero (PWA).
- Regla vigente del service worker: no muestra el aviso del sistema si la sala o el panel de ese local están a la vista **y con foco** (ya se ven); con la sala visible en otro monitor, avisa (preferible repetido a perdido). Puede relajarse a «solo a la vista».
- La base local quedó con `cafe-ejemplo` en plan Pro para la prueba manual: `pnpm db:reset` antes de las pruebas E2E.
- `.env.local` conserva claves VAPID de prueba (no versionado). Fly se despliega con la imagen `flyio/flyctl` (ver `docs/produccion.md`).

## Próximo paso

El usuario prueba el aviso desde el Resumen en su dispositivo (local o staging). Si lo aprueba: integrar la rama a `main`, pasar el ítem a «Hecho» y, si quiere, desplegar a staging. Después, elegir otra tarea desbloqueada del [tablero](tablero.md) (por ejemplo lectura de pagos y auditoría por el Dueño, nivel C).

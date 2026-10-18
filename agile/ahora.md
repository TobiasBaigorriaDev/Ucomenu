# Ahora (handoff)

Actualizado: 2026-10-18 · agente saliente: Claude Code · historial anterior en `agile/historial.md`.

## Punto de retomada

[Aviso de llamados también desde el panel](cambios/aviso-push-desde-el-panel.md) (M): **integrado a `main`**, probado y aprobado por el usuario en su Chrome. Incluye el cartel fijo de llamados pendientes en el panel, «Sala en vivo» en modo alerta con contador, el sonido que sigue al salir de la sala (módulo `src/components/panel/sonido-llamados.ts`) y la activación del aviso del sistema desde el Resumen. No cambió esquema ni envío.

**Staging no tiene esto todavía** (`https://ucomenu-staging.fly.dev`): no hay migración nueva, basta redesplegar con la imagen `flyio/flyctl` (ver `docs/produccion.md`) cuando el usuario lo pida. La base local quedó en seed limpio y el servidor local, apagado.

Base: [aviso con la pestaña cerrada](cambios/aviso-push-de-llamados.md), [ADR 0020](../docs/decisiones/0020-aviso-de-llamados-por-web-push.md).

## Bloqueos y riesgos

- **Producción:** bloqueada (dominio, Supabase de producción, revisión legal; ficha `salida-a-produccion`). Al salir hace falta **otro par VAPID** (`pnpm push:claves`); `pnpm prod:check` lo verifica.
- En Windows el aviso del sistema solo llega con Chrome o Edge en ejecución; iPhone queda en el tablero (PWA).
- Regla del *service worker*: no muestra el aviso del sistema si la sala o el panel de ese local están a la vista **y con foco**; con la sala visible en otro monitor, avisa (preferible repetido a perdido).
- El E2E con 2 o más *workers* tumba el servidor de pruebas de esta máquina (Windows): usar `--workers=1` y repetir de a uno lo que falle.
- `.env.local` conserva claves VAPID de prueba (no versionado).

## Próximo paso

Elegir del [tablero](tablero.md) (hoy «Seleccionado» está vacío). Desbloqueadas: lectura de pagos y auditoría por el Dueño (C, dentro de «SuperAdmin, incrementos pendientes»), analítica básica (M), carta en varios idiomas (M), aviso en iPhone por PWA (M) o redesplegar staging. La retención de `price_history` necesita política del usuario.

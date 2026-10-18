# Ahora (handoff)

Actualizado: 2026-10-18 · agente saliente: Claude Code · historial anterior en `agile/historial.md`.

## Punto de retomada

[Aviso de llamados en iPhone y iPad](cambios/aviso-push-iphone.md) (M): **integrado a `main`**, desplegado a staging y aprobado por el usuario tras probarlo en un iPhone real (instaló la app desde Safari y recibió los avisos con la app cerrada). Con esto el aviso con la app cerrada funciona en Android, Windows e iPhone/iPad ([ADR 0020](../docs/decisiones/0020-aviso-de-llamados-por-web-push.md)); el aviso desde el panel ya estaba hecho.

Staging (`https://ucomenu-staging.fly.dev`) está al día con `main`: no hay migraciones pendientes ni secretos nuevos por cargar, así que un redespliegue solo hace falta cuando cambie el código. La base local está en seed y el servidor local, apagado.

## Bloqueos y riesgos

- **Producción:** bloqueada (dominio, Supabase de producción, revisión legal; ficha `salida-a-produccion`). Al salir hace falta **otro par VAPID** (`pnpm push:claves`) y un `VAPID_SUBJECT` real (Apple lo valida); `pnpm prod:check` lo verifica.
- iPhone: solo con la sala instalada en la pantalla de inicio (iOS 16.4+); desde Chrome o Edge del iPhone no se probó. Apple siempre muestra el aviso aunque la sala esté a la vista (si no, revoca la suscripción).
- E2E: usar `--workers=1` (con más, el servidor de pruebas de esta máquina cae); repetir de a uno lo que falle.
- `.env.local` conserva claves VAPID de prueba (no versionado).

## Próximo paso

Elegir del [tablero](tablero.md) (hoy «Seleccionado» está vacío). Desbloqueadas: lectura de pagos y auditoría por el Dueño (C, dentro de «SuperAdmin, incrementos pendientes»), analítica básica (M) o carta en varios idiomas (M). La retención de `price_history` necesita política del usuario.

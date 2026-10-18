# Ahora (handoff)

Actualizado: 2026-10-18 · agente saliente: Claude Code · historial anterior en `agile/historial.md`.

## Punto de retomada

[Aviso de llamados en iPhone y iPad](cambios/aviso-push-iphone.md) (M): **implementado y confirmado en la rama `feat/aviso-iphone`**, sin integrar a `main` ni desplegado. La sala y el panel se pueden instalar como app (`public/sala.webmanifest`, íconos en `public/icons/` generados con `tools/generar-iconos.mjs`, metadatos solo en `/sala` y `/panel`); en Safari de iPhone el bloque del aviso explica cómo instalar; y el *service worker* **siempre muestra** el aviso si la suscripción es de Apple, que revoca las que no terminan en una notificación visible. Pruebas locales verdes (ficha). El ítem está en «Para verificar».

**Falta lo que no se puede probar acá:** un iPhone real (iOS 16.4+). Pasos: desplegar la rama a staging (imagen `flyio/flyctl`, ver `docs/produccion.md`), abrir `https://ucomenu-staging.fly.dev/sala` en Safari, instalar con Compartir → «Agregar a pantalla de inicio», abrir desde el ícono, activar los avisos y llamar desde una mesa con la app cerrada. Si Apple rechaza el envío, mirar primero el `VAPID_SUBJECT` de staging (hoy `https://ucomenu-staging.fly.dev`).

La base local está en seed y el servidor local, apagado. Staging tiene `main` (incluye el cartel del panel).

## Bloqueos y riesgos

- **Producción:** bloqueada (dominio, Supabase de producción, revisión legal; ficha `salida-a-produccion`). Al salir hace falta **otro par VAPID** (`pnpm push:claves`) y un `VAPID_SUBJECT` real.
- E2E: usar `--workers=1` (con más, el servidor de pruebas de esta máquina cae); repetir de a uno lo que falle.
- `.env.local` conserva claves VAPID de prueba (no versionado).

## Próximo paso

El usuario prueba en un iPhone (con staging desplegado). Si funciona: integrar a `main`, pasar el ítem a «Hecho» y subir. Si no, ajustar según lo que falle. Después elegir otra tarea del [tablero](tablero.md).

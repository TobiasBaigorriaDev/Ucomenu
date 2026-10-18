# Ahora (handoff)

Actualizado: 2026-10-18 · agente saliente: Claude Code · historial anterior en `agile/historial.md`.

## Punto de retomada

Rama **`feat/aviso-push-de-llamados`** (sale de `main` en `1645ddd`; `main` no se tocó): [aviso de llamados con la pestaña cerrada por Web Push](cambios/aviso-push-de-llamados.md), Android y Windows (C, [ADR 0020](../docs/decisiones/0020-aviso-de-llamados-por-web-push.md)). Implementado y probado en local, revisado por Codex en **tres rondas** (todas «aprobar con cambios»; todos los hallazgos reales corregidos con regresión; la última corrección no tuvo cuarta verificación). **Probado por el usuario en su Chrome de Windows con la sala cerrada (funciona, 2026-10-18).** Desplegado a **staging** (migración aplicada, claves VAPID de staging cargadas en Fly, 2026-10-18); producción no tocada; sin integrar a `main`. La base local quedó con la migración `20261025100000` aplicada.

Qué hay: tabla `push_subscriptions` cerrada a la API y cinco funciones, envío desde `after()` en la acción pública del comensal (`src/lib/push/`), `public/sala-sw.js`, bloque «Avisarme aunque cierre la sala» en `/sala/{slug}`, baja al cerrar sesión, `pnpm push:claves` y comprobaciones nuevas en `pnpm prod:check`. Se instaló `web-push` 3.6.7 (aprobado).

## Bloqueos y riesgos

- Para que el aviso funcione hacen falta claves VAPID en el entorno (`pnpm push:claves`; en `.env.local` para `pnpm dev` y como secretos en Fly para staging). Sin ellas la pantalla no lo ofrece. **No se pusieron claves en ningún lado.**
- En Windows el aviso solo llega si Chrome/Edge siguen en ejecución; iPhone queda para otro ítem.
- Falta probarlo en un **Android** contra staging (`https://ucomenu-staging.fly.dev`; hace falta una cuenta en una organización con plan Pro y una mesa). El Chrome automatizado se suscribe de forma intermitente (ver la ficha). `.env.local` tiene claves VAPID de prueba (no versionado) y el local `cafe-ejemplo` quedó en plan Pro en la base local (`pnpm db:reset` lo revierte).
- `revision-codex.test.ts › --uncommitted` falla solo con cambios sin confirmar en `.env.example`; pasa con el árbol limpio.
- `flyctl.exe` lo bloquea Smart App Control: se despliega con la imagen `flyio/flyctl` (ver `docs/produccion.md`). Producción sigue bloqueada (ficha `salida-a-produccion`).

## Próximo paso

1. Decidir con el usuario si se pide una cuarta verificación a Codex (la regla manda consultar tras la tercera) o se aprueba con lo hecho.
2. Con aprobación: generar claves para staging, `fly secrets set`, desplegar (el Dockerfile ahora copia `public/`), activar el aviso en un Android y en la PC y comprobar con la sala cerrada.
3. Si el usuario aprueba: integrar a `main`, pasar el ítem a «Hecho» y seguir con «Aviso también desde el panel».

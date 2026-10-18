# Ahora (handoff)

Actualizado: 2026-10-18 · agente saliente: Claude Code · historial anterior en `agile/historial.md`.

## Punto de retomada

Rama **`feat/aviso-push-de-llamados`** (sale de `main` en `1645ddd`; `main` no se tocó): [aviso de llamados con la pestaña cerrada por Web Push](cambios/aviso-push-de-llamados.md), Android y Windows (C, [ADR 0020](../docs/decisiones/0020-aviso-de-llamados-por-web-push.md)). Implementado y probado en local, **sin integrar a `main`, sin desplegar y sin revisión independiente todavía**. La base local quedó con la migración `20261025100000` aplicada.

Qué hay: tabla `push_subscriptions` cerrada a la API y cinco funciones, envío desde `after()` en la acción pública del comensal (`src/lib/push/`), `public/sala-sw.js`, bloque «Avisarme aunque cierre la sala» en `/sala/{slug}`, baja al cerrar sesión, `pnpm push:claves` y comprobaciones nuevas en `pnpm prod:check`. Se instaló `web-push` 3.6.7 (aprobado).

## Bloqueos y riesgos

- Para que el aviso funcione hacen falta claves VAPID en el entorno (`pnpm push:claves`; en `.env.local` para `pnpm dev` y como secretos en Fly para staging). Sin ellas la pantalla no lo ofrece. **No se pusieron claves en ningún lado.**
- En Windows el aviso solo llega si Chrome/Edge siguen en ejecución; iPhone queda para otro ítem.
- Las pruebas con Chrome real fueron intermitentes por el entorno automatizado (ver la ficha); falta probarlo en un Android y en la PC del salón con HTTPS.
- `revision-codex.test.ts › --uncommitted` falla solo con cambios sin confirmar en `.env.example`; pasa con el árbol limpio.
- `flyctl.exe` lo bloquea Smart App Control: se despliega con la imagen `flyio/flyctl` (ver `docs/produccion.md`). Producción sigue bloqueada (ficha `salida-a-produccion`).

## Próximo paso

1. Pedir **una ronda de revisión a Codex** (`pnpm revision:codex --commit HEAD --ficha agile/cambios/aviso-push-de-llamados.md --nivel C`, skill `ciclo-revision-codex`) y corregir.
2. Con aprobación: generar claves para staging, `fly secrets set`, desplegar (el Dockerfile ahora copia `public/`), activar el aviso en un Android y en la PC y comprobar con la sala cerrada.
3. Si el usuario aprueba: integrar a `main`, pasar el ítem a «Hecho» y seguir con «Aviso también desde el panel».

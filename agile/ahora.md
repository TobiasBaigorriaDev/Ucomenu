# Ahora (handoff)

Actualizado: 2026-10-19 · agente saliente: Claude Code · historial anterior en `agile/historial.md`.

## Punto de retomada

Hechas e integradas a `main` y **desplegadas a staging** (`https://ucomenu-staging.fly.dev`, migraciones hasta `20261027100000`) en esta tanda, todas aprobadas por el usuario:
- [El Dueño lee sus pagos y el historial de su cuenta](cambios/dueno-lee-pagos-y-auditoria.md) (C, [ADR 0021](../docs/decisiones/0021-el-dueno-lee-pagos-y-auditoria.md)): `/panel/{slug}/suscripcion`.
- [Analítica básica](cambios/analitica-basica.md) (C, [ADR 0022](../docs/decisiones/0022-analitica-basica.md)): `/panel/{slug}/analitica`, solo Dueño con plan Pro; vistas de platos como contadores anónimos (ruta `/api/vista-plato`, nada en el dispositivo) y llamados por hora de los últimos 14 días, con detalle al pasar el cursor o tocar.
- Antes: aviso de llamados desde el panel y en iPhone ([ADR 0020](../docs/decisiones/0020-aviso-de-llamados-por-web-push.md)).

`main` está varios commits por delante de `origin`: **falta el push** (el usuario no lo pidió). La base local tiene datos de ejemplo de analítica y `cafe-ejemplo` en Pro: `pnpm db:reset` antes de las pruebas. El servidor local (puerto 3000) puede seguir encendido.

## Bloqueos y riesgos

- **Producción:** bloqueada (dominio, Supabase de producción, revisión legal; ficha `salida-a-produccion`). La revisión legal debe incluir la oración nueva de `/privacidad` sobre el conteo de vistas. Al salir hace falta otro par VAPID y un `VAPID_SUBJECT` real.
- Abuso aceptado de la analítica: cualquiera puede inflar el contador de una carta (sin límite por IP a propósito, para no guardar un identificador del comensal).
- E2E: usar `--workers=1`; algún fallo por tiempo ajeno (p. ej. `carta.spec.ts:266`) pasa al repetirlo solo. La corrida completa de RLS falló una vez sin causa conocida y pasó al repetirla.
- Mutaciones: correrlas en tandas de ~6 (una sola corrida larga se cortó por falta de memoria).

## Próximo paso

Elegir del [tablero](tablero.md) (hoy «Seleccionado» está vacío). Desbloqueadas: carta en varios idiomas (M), subdominio o dominio propio por organización (M), add-ons y desactivar organizaciones de SuperAdmin (C). La retención de `price_history` necesita política del usuario.

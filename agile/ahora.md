# Ahora (handoff)

Actualizado: 2026-10-21 · agente saliente: Claude · historial anterior en `agile/historial.md`.

## Punto de retomada

**Cuatro correcciones (C) implementadas y probadas en local; falta la revisión de Codex y la aprobación humana.** Rama `main`. [Ficha](cambios/proteger-cuentas-globales.md) · [ADR 0032](../docs/decisiones/0032-reserva-de-cuentas-globales.md) (propuesta).

1. Una cuenta de SuperAdmin no se restablece ni se borra desde un local (aunque esté como Staff); la baja le quita el local y conserva la cuenta.
2. Carrera con `admin_add_owner`: una *reserva* por cuenta, tomada junto con la comprobación en la base, impide que se sume una membresía mientras se cambia la contraseña o se borra la cuenta (`account_busy`).
3. Auth caído ya no da 401 en la sala: `/sala/{slug}/estado` y el `proxy` responden 503 y la pantalla sigue reintentando.
4. `pnpm respaldo` incluye `organization-logos` (archivos `storage/<bucket>/…`, manifiesto versión 2).

**Migración nueva** `20261104100000_proteger_cuentas_globales.sql`. Staging **no** la tiene (requiere aprobación).

Pendiente de antes: el [borrado de mesas](cambios/borrado-de-mesas.md) (aprobado por Codex, sin aprobación humana) y el de categorías y platos ya en staging. Decisión de docs: fase 2 = feed de videos en Premium con **Mux Video** ([ADR 0031](../docs/decisiones/0031-feed-de-videos-cortos.md)); sigue `[C] Catálogo: retirar webar y sumar video_feed`.

## Bloqueos y riesgos

- **Producción:** bloqueada (dominio, Supabase de producción, revisión legal).
- Residuos de la reserva (ADR 0032): una llamada a Auth colgada más de 2 min reabre la ventana; el alta de SuperAdmin por SQL no está coordinada.
- Flaky conocido: en RLS completo, `owner-lectura` puede chocar con otro archivo que toca `audit_log`; y un worker caído `0xC0000409`. Se repiten una vez.
- E2E con `--workers=1`; RLS y E2E no a la vez.

## Próximo paso

1. `pnpm revision:codex --commit HEAD --ficha agile/cambios/proteger-cuentas-globales.md --nivel C`; corregir lo confirmado y registrarlo en la ficha.
2. El usuario aprueba; recién entonces subir a `origin`, aplicar las migraciones pendientes en staging y desplegar.
3. Ensayar la restauración mensual incluyendo un logo.

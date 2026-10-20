# Ahora (handoff)

Actualizado: 2026-10-19 · agente saliente: Claude Code · historial anterior en `agile/historial.md`.

## Punto de retomada

Integrado a `main` y a `origin` (merge `6e93fbd`, 2026-10-20, aprobado por el usuario): [add-ons y baja de organizaciones](cambios/addons-y-baja-de-organizaciones.md) (C, [ADR 0025](../docs/decisiones/0025-baja-de-organizaciones-y-addons.md)), implementado y verificado en local. El SuperAdmin activa, cambia (packs, fin) y finaliza WebAR, y da de baja / reactiva una organización desde `/admin/organizaciones/{slug}`. La baja cierra el acceso del local por RLS (`is_org_member`/`is_org_owner` exigen `is_active`), no borra nada y se revierte. Alcance elegido por el usuario: **sin borrado**.

Revisado por Codex en tres rondas (APROBAR). **Falta aplicar la migración `20261030100000` en staging y desplegar la app**: el `db push --dry-run` listó solo esa; el `db push` real lo bloqueó el control de permisos de la sesión (hay que correr `pnpm exec supabase db push` y el despliegue a Fly, o dar el permiso). Nada se tocó en producción.

Anterior: [anular pagos](cambios/anular-pagos.md) ya está en `main` y en staging (migración y app, 2026-10-19). Falta que el usuario pruebe esa pantalla con su sesión de SuperAdmin en staging. La organización `demo` no tiene traducciones ni pagos.

Pendiente del usuario: resultado del vencimiento a las 3 h del ticket de visita en teléfono real.

## Bloqueos y riesgos

- **Producción:** bloqueada (dominio, Supabase de producción, revisión legal; ficha `salida-a-produccion`).
- **Borrado de organizaciones:** bloqueado hasta que el usuario defina la retención y purga de `price_history`, `payments` y `payment_voids` (ADR 0012/0025).
- E2E: usar `--workers=1`. En esta sesión el servidor de pruebas se cayó a mitad de la corrida completa (`ERR_CONNECTION_REFUSED` desde `idiomas`); se repitieron los archivos restantes. RLS completo ~12 min; RLS y E2E no se corren a la vez.
- Una baja pública devuelve 404 (como una organización inexistente); un «no disponible» para quien escanea un QR es una mejora aparte.

## Próximo paso

1. Aplicar la migración en staging y desplegar (docs/produccion.md, pasos 1 y 3b); probar la pantalla nueva con la sesión de SuperAdmin.
2. Elegir del [tablero](tablero.md): spike de `<model-viewer>` (S) u otro ítem desbloqueado.

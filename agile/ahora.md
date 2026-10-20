# Ahora (handoff)

Actualizado: 2026-10-19 · agente saliente: Claude Code · historial anterior en `agile/historial.md`.

## Punto de retomada

Rama `feat/addons-y-baja-organizaciones` (sin integrar a `main`): [add-ons y baja de organizaciones](cambios/addons-y-baja-de-organizaciones.md) (C, [ADR 0025](../docs/decisiones/0025-baja-de-organizaciones-y-addons.md)), implementado y verificado en local. El SuperAdmin activa, cambia (packs, fin) y finaliza WebAR, y da de baja / reactiva una organización desde `/admin/organizaciones/{slug}`. La baja cierra el acceso del local por RLS (`is_org_member`/`is_org_owner` exigen `is_active`), no borra nada y se revierte. Alcance elegido por el usuario: **sin borrado**.

Falta: revisión independiente de Codex (nivel C: `ciclo-revision-codex`), aprobación humana, integrar a `main` y, con aprobación, aplicar la migración `20261030100000` en staging y desplegar. Nada se tocó fuera de local.

Anterior: [anular pagos](cambios/anular-pagos.md) ya está en `main` y en staging (migración y app, 2026-10-19). Falta que el usuario pruebe esa pantalla con su sesión de SuperAdmin en staging. La organización `demo` no tiene traducciones ni pagos.

Pendiente del usuario: resultado del vencimiento a las 3 h del ticket de visita en teléfono real.

## Bloqueos y riesgos

- **Producción:** bloqueada (dominio, Supabase de producción, revisión legal; ficha `salida-a-produccion`).
- **Borrado de organizaciones:** bloqueado hasta que el usuario defina la retención y purga de `price_history`, `payments` y `payment_voids` (ADR 0012/0025).
- E2E: usar `--workers=1`. En esta sesión el servidor de pruebas se cayó a mitad de la corrida completa (`ERR_CONNECTION_REFUSED` desde `idiomas`); se repitieron los archivos restantes. RLS completo ~12 min; RLS y E2E no se corren a la vez.
- Una baja pública devuelve 404 (como una organización inexistente); un «no disponible» para quien escanea un QR es una mejora aparte.

## Próximo paso

1. Revisión de Codex del commit de la rama y corregir lo que haga falta.
2. Aprobación del usuario → integrar a `main`; aplicar la migración en staging solo con su OK.
3. Elegir del [tablero](tablero.md): spike de `<model-viewer>` (S) u otro ítem desbloqueado.

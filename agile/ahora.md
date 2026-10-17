# Ahora (handoff)

Actualizado: 2026-10-16 (noche) · agente: Claude Code · historial anterior en `agile/historial.md` (no leer salvo un detalle puntual).

## Punto de retomada
- Rama `main`, árbol limpio salvo `.claude/worktrees/` (sin versionar). Integrado en local y **sin subir**: variantes y adicionales, SuperAdmin (plan, suspensión, pagos, prueba), gestión de sucursales, deuda técnica, cierre de sesión por cuenta atendida (10 min de gracia), guía de primeros pasos y rendimiento de la carta. Los dos últimos se hicieron en paralelo con agentes en `git worktree` (ya borrados).
- **Salida a producción** (ficha `agile/cambios/salida-a-produccion.md`, «Bloqueado»; ADR 0015). Staging ensayado el 2026-10-16: `https://ucomenu-staging.fly.dev`, con purga programada, respaldo y restauración probados.
- **Un proyecto de Supabase por entorno** (staging y producción), no por cliente.

## Bloqueos y riesgos
- **Solo el usuario puede:** crear el proyecto de Supabase de producción, decidir y comprar el dominio, elegir el correo de contacto y contratar la revisión legal. `flyctl` (no `fly`) tiene sesión iniciada.
- **Archivos con claves y datos del staging:** `C:\Users\tobib\staging.env` y `C:\Users\tobib\respaldos-ucomenu`; borrarlos al terminar el ensayo.
- **Purga:** programada solo en staging (06:00 UTC). Repetir el paso 4 de `docs/produccion.md` en producción.
- **No imprimir QR** hasta tener el dominio definitivo. Sin probar en teléfono real: ticket de visita, «Llamados», textos legales y alta.
- RLS y E2E comparten base: no correrlas a la vez. Para trabajo en paralelo, segundo Supabase con otros puertos y `E2E_PORT` / `SUPABASE_DB_CONTAINER`.

## Próximo paso
1. **Al retomar:** ver la primera purga real (`pnpm exec supabase db query --linked` sobre `cron.job_run_details`; esperado `succeeded`).
2. **Aplicar en staging** (con aprobación) las migraciones `20261016140000_cerrar_sesion_al_atender_la_cuenta.sql`, `20261017100000_superadmin_planes_pagos_suspension.sql`, `20261018100000_gestion_de_sucursales.sql` y `20261019100000_variantes_y_adicionales.sql`, y mirar la memoria de Fly (512 MB) con la reducción de fotos.
3. **Con el usuario:** teléfono real; dominio, revisión legal y producción; retención de `price_history` (C).
4. **Sin el usuario:** buscador y filtros, disponibilidad por sucursal, identidad del local (M). Decisiones abiertas de la guía y de variantes en sus fichas.

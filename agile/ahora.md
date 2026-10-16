# Ahora (handoff)

Actualizado: 2026-10-16 (noche) · agente: Claude Code · historial anterior en `agile/historial.md` (no leer salvo un detalle puntual).

## Punto de retomada
- Rama `main`, árbol limpio salvo `.claude/worktrees/` (worktree temporal del agente; sin versionar). Todo subido a `origin/main`.
- **Hecho:** alta de SuperAdmin con primera sucursal; textos legales en borrador; purga de `waiter_calls` (14 días); revisión de Codex automatizada.
- **Salida a producción** (ficha `agile/cambios/salida-a-produccion.md`, «Bloqueado» en el tablero; estrategia en el ADR 0015). **Staging ensayado el 2026-10-16:** Supabase con las 15 migraciones, app `ucomenu-staging` en Fly (`https://ucomenu-staging.fly.dev`), SuperAdmin, organización de ensayo, plato con foto, purga programada, respaldo y restauración probados. Evidencia en la ficha.
- **Un proyecto de Supabase por entorno** (staging y producción), no por cliente: es multi-inquilino y cada negocio se da de alta desde `/admin`.
- Tras actualizar `main` en otra máquina: `pnpm db:reset` (hay migraciones nuevas).

## Bloqueos y riesgos
- **Solo el usuario puede:** crear el proyecto de Supabase de producción (otra organización), decidir y comprar el dominio, elegir el correo de contacto y contratar la revisión legal. `flyctl` (usar `flyctl`, no `fly`) tiene sesión iniciada.
- **Archivos con claves y datos del staging:** `C:\Users\tobib\staging.env` y `C:\Users\tobib\respaldos-ucomenu`; borrarlos al terminar el ensayo. `flyctl apps destroy ucomenu-staging` si no se quiere dejarlo armado (cuesta centavos).
- **Purga:** programada solo en staging (06:00 UTC, es decir 03:00 en Argentina). Repetir el paso 4 de `docs/produccion.md` en producción.
- **No imprimir QR** hasta tener el dominio definitivo.
- Sin probar en teléfono real: ticket de visita, «Llamados», textos legales y alta.
- Las suites de RLS y E2E comparten base: no correrlas a la vez.

## Próximo paso
1. **Al retomar (mañana):** ver la primera purga real. Consulta de solo lectura: `pnpm exec supabase db query --linked "select status, start_time, return_message from cron.job_run_details order by start_time desc limit 5;"` (proyecto ya enlazado). Esperado: `succeeded`; comprobar también que no queden `waiter_calls` de más de 14 días.
2. **Con el usuario:** ensayo con teléfono real; luego dominio, revisión legal y producción.
3. **Sin el usuario** (desbloqueados): repaso de diseño del historial de precios (S), `expectNoHorizontalOverflow` con falsos aprobados (S), variantes y adicionales, buscador y filtros (M). La retención de `price_history` es C: con el usuario presente. Pendiente menor: mencionar las copias de seguridad en la política de privacidad.

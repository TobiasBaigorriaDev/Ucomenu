# Ahora (handoff)

Actualizado: 2026-10-16 · agente: Claude Code · historial anterior en `agile/historial.md` (no leer salvo un detalle puntual).

## Punto de retomada
- Rama `main`, árbol limpio salvo `.claude/worktrees/` (worktree temporal del agente; sin versionar). Todo subido a `origin/main` (2026-10-16).
- **Hecho:** alta de SuperAdmin con primera sucursal; textos legales; purga de `waiter_calls` (14 días); revisión de Codex automatizada.
- **Salida a producción** (ficha `agile/cambios/salida-a-produccion.md`, «Bloqueado» en el tablero): estrategia en el ADR 0015. **Staging ensayado el 2026-10-16:** Supabase de staging con las 15 migraciones, app `ucomenu-staging` en Fly (`https://ucomenu-staging.fly.dev`), primer SuperAdmin, organización de ensayo, plato con foto, `pg_cron` con la purga programada y respaldo con restauración probados. Evidencia en la ficha. Producción espera al dominio.
- Tras actualizar `main` en otra máquina: `pnpm db:reset` (hay migraciones nuevas).

## Bloqueos y riesgos
- **Solo el usuario puede:** crear el proyecto de Supabase de producción (otra organización), decidir y comprar el dominio (pospuesto al backlog), elegir el correo de contacto y contratar la revisión legal. `flyctl` (v0.4.118, en `~\.fly\bin`; usar `flyctl`, no `fly`) ya tiene sesión iniciada.
- **Archivos temporales con claves del staging:** `C:\Users\tobib\staging.env` y los respaldos en `C:\Users\tobib\respaldos-ucomenu`; borrarlos al terminar el ensayo.
- **Textos legales en borrador:** revisión profesional, identidad del operador y `NEXT_PUBLIC_CONTACT_EMAIL` pendientes.
- **Purga:** programada solo en staging; comprobar `cron.job_run_details` tras su primera ejecución (06:00 UTC) y repetir el paso 4 en producción.
- **No imprimir QR** hasta tener el dominio definitivo (cada QR lo codifica).
- Sin probar en teléfono real: ticket de visita, «Llamados», textos legales y alta.
- Las suites de RLS y E2E comparten base: no correrlas a la vez.

## Próximo paso
1. **Con el usuario:** ver la primera purga real en staging; ensayar el dueño y la carta pública con teléfono real; luego dominio, revisión legal y producción (`docs/produccion.md`).
2. **Sin el usuario**, ítems desbloqueados del tablero: repaso de diseño del historial de precios (S), `expectNoHorizontalOverflow` con falsos aprobados (S), variantes y adicionales, buscador y filtros (M). La retención de `price_history` es C: conviene con el usuario presente.

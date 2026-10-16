# Ahora (handoff)

Actualizado: 2026-10-16 · agente: Claude Code · historial anterior en `agile/historial.md` (no leer salvo un detalle puntual).

## Punto de retomada
- Rama `main`, árbol limpio salvo `.claude/worktrees/` (worktree temporal del agente; sin versionar). Todo subido a `origin/main` (2026-10-16).
- **Hecho:** alta de SuperAdmin con primera sucursal; textos legales; purga de `waiter_calls` (14 días); revisión de Codex automatizada.
- **Salida a producción** (ficha `agile/cambios/salida-a-produccion.md`, «Bloqueado» en el tablero): estrategia en el ADR 0015. Supabase Free con respaldos propios (`pnpm respaldo`), staging en otra organización de Supabase, hosting en un contenedor de Fly.io en São Paulo (~USD 6 por mes), Sentry postergado. Listo en local: `Dockerfile`, `fly*.toml`, `docs/operacion.md`, `docs/produccion.md`; la imagen pasó 179/179 pruebas E2E.
- Tras actualizar `main` en otra máquina: `pnpm db:reset` (hay migraciones nuevas).

## Bloqueos y riesgos
- **Solo el usuario puede:** crear la cuenta de Fly (tarjeta) e iniciar sesión, crear los proyectos de Supabase, decidir y comprar el dominio (pospuesto al backlog), elegir el correo de contacto y contratar la revisión legal. `flyctl` v0.4.118 ya está instalado en `~\.fly\bin` (usar `flyctl`, no `fly`).
- **`fly.toml` y `fly.staging.toml` sin validar:** validar exige iniciar sesión (`flyctl auth login`); después `flyctl config validate -c fly.staging.toml`.
- **Textos legales en borrador:** revisión profesional, identidad del operador y `NEXT_PUBLIC_CONTACT_EMAIL` pendientes.
- **La purga no corre sola:** programarla con `pg_cron` (paso 4 de `docs/produccion.md`) y comprobarla antes de publicar.
- **No imprimir QR** hasta tener el dominio definitivo (cada QR lo codifica).
- Sin probar en teléfono real: ticket de visita, «Llamados», textos legales y alta.
- Las suites de RLS y E2E comparten base: no correrlas a la vez.

## Próximo paso
1. **Con el usuario, en orden:** proyecto de Supabase de staging (`docs/produccion.md`, 1b) → cuenta de Fly e inicio de sesión → desplegar staging (3b) → ensayar respaldo, restauración y purga → producción (que además espera al dominio).
2. **Sin el usuario**, ítems desbloqueados del tablero: repaso de diseño del historial de precios (S), `expectNoHorizontalOverflow` con falsos aprobados (S), variantes y adicionales, buscador y filtros (M). La retención de `price_history` es C: conviene con el usuario presente.

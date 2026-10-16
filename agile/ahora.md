# Ahora (handoff)

Actualizado: 2026-10-16 · agente: Claude Code · historial anterior en `agile/historial.md` (no leer salvo un detalle puntual).

## Punto de retomada
- Rama `main`, árbol limpio salvo `.claude/worktrees/` (worktree temporal del agente; sin versionar). Todo subido a `origin/main` (2026-10-16).
- **Hecho:** alta de SuperAdmin con primera sucursal; textos legales (`/terminos`, `/privacidad`, `/alergenos`); purga de `waiter_calls` (14 días); revisión de Codex automatizada.
- **Salida a producción** (ficha `agile/cambios/salida-a-produccion.md`, «Bloqueado» en el tablero): estrategia en el ADR 0015. Supabase Free con respaldos propios (`pnpm respaldo`), staging en otra organización de Supabase, hosting en un contenedor de Fly.io en São Paulo (~USD 6 por mes), Sentry postergado. Listo en local: `Dockerfile`, `fly*.toml`, `docs/operacion.md`, `docs/produccion.md`, `pnpm prod:check`. La imagen pasó 179/179 pruebas E2E.
- Tras actualizar `main` en otra máquina: `pnpm db:reset` (hay migraciones nuevas).

## Bloqueos y riesgos
- **Solo el usuario puede:** crear la cuenta de Fly (tarjeta), instalar `flyctl`, crear los proyectos de Supabase, comprar el dominio, elegir el correo de contacto y contratar la revisión legal. No se hizo nada de eso.
- **`fly.toml` y `fly.staging.toml` sin validar:** primer paso con `flyctl`: `fly config validate -c fly.staging.toml`.
- **Textos legales en borrador:** revisión profesional, identidad del operador y `NEXT_PUBLIC_CONTACT_EMAIL` pendientes.
- **La purga no corre sola:** programarla con `pg_cron` (paso 4 de `docs/produccion.md`) y comprobarla antes de publicar.
- **No imprimir QR** hasta tener el dominio definitivo (cada QR lo codifica).
- Sin probar en teléfono real: ticket de visita, «Llamados», textos legales y formulario de alta.
- Las suites de RLS y E2E comparten base: no correrlas a la vez.

## Próximo paso
1. **Con el usuario, en orden:** dominio (disponibilidad y precio) → proyecto de Supabase de staging → cuenta de Fly y `flyctl` → desplegar staging (`docs/produccion.md`, 3b) → ensayar respaldo, restauración y purga → recién entonces producción.
2. **Sin el usuario**, ítems desbloqueados del tablero: repaso de diseño del historial de precios (S), `expectNoHorizontalOverflow` con falsos aprobados (S), variantes y adicionales, buscador y filtros (M). La retención de `price_history` es C: conviene con el usuario presente.

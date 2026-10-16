# Ahora (handoff)

Actualizado: 2026-10-16 · agente: Claude Code · historial anterior en `agile/historial.md` (no leer salvo un detalle puntual).

## Punto de retomada
- Rama `main`, árbol limpio salvo `.claude/worktrees/` (worktree temporal del agente; sin versionar). `origin/main` en `52ae537`; hay commits locales sin subir (handoff, preparación de producción y estrategia). Subir cuando el usuario lo pida.
- **Hecho:** el alta de SuperAdmin crea la primera sucursal; textos legales `/terminos`, `/privacidad` y `/alergenos`; purga de `waiter_calls` (14 días); revisión de Codex automatizada (`pnpm revision:codex`).
- **Salida a producción:** estrategia aceptada en el ADR 0015 (Supabase Free con respaldos propios, staging gratuito en otra organización, hosting por decidir, Sentry postergado, dominio sin comprar). Preparado en local: `docs/operacion.md` (configuración, respaldos, criterios para subir de plan, evaluación de Netlify), `docs/produccion.md`, `pnpm respaldo` y `pnpm prod:check`. Ficha: `agile/cambios/salida-a-produccion.md`. Está en «Bloqueado»: ejecutarla exige cuentas, compras y secretos del usuario.
- Tras actualizar `main` en otra máquina: `pnpm db:reset` (hay migraciones nuevas).

## Bloqueos y riesgos
- **Sondeo de la sala vs. hosting gratuito:** estimado ~230–420 de 300 créditos/mes de Netlify Free por pantalla (sin medir); agotarlos pausa todo el proyecto. Decidir la opción antes de un local real (`docs/operacion.md`, sección 5).
- **Textos legales en borrador:** revisión profesional, identidad del operador y correo real (`NEXT_PUBLIC_CONTACT_EMAIL`) pendientes (ficha de textos legales).
- **La purga no corre sola:** falta programarla (`pg_cron`, paso 4 de `docs/produccion.md`); la privacidad ya promete 14 días, así que se comprueba antes de publicar.
- Sin probar en teléfono real: ticket de visita, pantalla «Llamados», textos legales y formulario de alta.
- Las suites de RLS y E2E comparten base: no correrlas a la vez ni desde dos worktrees.

## Próximo paso
Con el usuario: elegir hosting y la opción para el sondeo, comprobar disponibilidad y precio del dominio, y crear el staging. Sin él: elegir un ítem desbloqueado del tablero (la retención de `price_history` es C y conviene hacerla con el usuario presente; también el repaso de diseño del historial de precios, `expectNoHorizontalOverflow` con falsos aprobados, o producto del MVP).

# Ahora (handoff)

Actualizado: 2026-10-23 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

S1 y S2 del incremento «Salón y crecimiento» están **hechas** y en staging: sucursal adicional, reseñas, vistas previas, [zona horaria](cambios/zona-horaria-por-sucursal.md) y [promociones con precio efectivo](cambios/promociones-y-precio-efectivo.md) (aprobada por Codex y por el usuario).

**Últimas piezas (Fly versión 40, `origin/main` al día, migración `20261124100000` aplicada):**
- [Panel de promociones](cambios/panel-de-promociones.md) (M): `/panel/{slug}/promociones`; `save_promotion` (`SECURITY INVOKER`).
- [Carta con precio promocional](cambios/carta-con-precio-promocional.md) (M): la carta y el feed leen `effective_prices` en vivo. **No se midió el LCP.**
- [Historial de promociones](cambios/historial-de-promociones.md) (S).

Verificado: RLS 1276/1276, E2E 440 de 441 (un *worker* caído, ajeno). M y S sin revisión de Codex.

## Bloqueos y límites

- **Claves de Supabase de staging**: las claves *legacy* están desactivadas. La app se compila con la `sb_publishable_…` y el secreto `SUPABASE_SERVICE_ROLE_KEY` de Fly es ahora la clave secreta `default` (lo puso el usuario, 2026-10-23). Falta comprobar con sesión real SuperAdmin, personal y llamados desde la mesa.
- Clientes recurrentes (S4) espera a un abogado. Siguen pendientes el dominio, la revisión legal de los comentarios y programar las purgas (bloquean producción).
- `pnpm test` tiene una falla ajena: `textos.test.ts` («Menufeed»). Intermitentes: `sala.spec:323`, `videos-mux.spec:145`, `owner-lectura.rls` y *workers* con `0xC0000409`. E2E: usar `--workers=3`. Si `pnpm build` da `EPERM` en `.next/server`, borrar esa carpeta y repetir. `tools/escenarios-locales.mjs` es ajeno y sin seguir.
- Despliegue desde Windows: `flyctl deploy -c fly.staging.toml` con las cuatro `NEXT_PUBLIC_*` como `--build-arg` (la `publishable`, nunca una secreta); ver `docs/produccion.md`.
- Next.js 16.4.3 con excepción `minimumReleaseAgeExclude` en `pnpm-workspace.yaml`: quitarla cuando cumpla la antigüedad.

## Próximo paso

1. Probar en staging con sesión real SuperAdmin, personal, llamados, promociones, carta y zona horaria.
2. Cambiar la clave secreta de local (`.env.local`) y de otros entornos si usaban la legacy.
3. S3 «Pedidos del mozo» (nivel C): usa `effective_prices`.
4. Pendientes anteriores: teléfono real (llamado, likes, comentarios), `/admin/cuentas` y **rotar la `service_role` legacy de staging** (urgente: se imprimió por error en una sesión del 2026-10-23).

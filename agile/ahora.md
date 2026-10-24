# Ahora (handoff)

Actualizado: 2026-10-23 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

S1 y S2 del incremento «Salón y crecimiento» están **hechas**. En staging (migraciones y Fly versión 38, `origin/main` hasta `36bd655`): sucursal adicional, reseñas, vistas previas, [zona horaria](cambios/zona-horaria-por-sucursal.md) y [promociones con precio efectivo](cambios/promociones-y-precio-efectivo.md) (aprobada por Codex y por el usuario).

**Solo en local, commiteado (`779171c`) y sin subir:**
- [Panel de promociones](cambios/panel-de-promociones.md) (M): `/panel/{slug}/promociones`; migración `20261124100000` (`save_promotion`, `SECURITY INVOKER`).
- [Carta con precio promocional](cambios/carta-con-precio-promocional.md) (M): la carta y el feed leen `effective_prices` en vivo. **No se midió el LCP.**
- [Historial de promociones](cambios/historial-de-promociones.md) (S).

Verificado: RLS completa 1276/1276, E2E completo 440 de 441 (un *worker* caído, ajeno), lint, typecheck y build. M y S sin revisión de Codex por su nivel.

## Bloqueos y límites

- Subir la migración nueva y desplegar la app pide aprobación del usuario.
- Clientes recurrentes (S4) espera a un abogado. Siguen pendientes el dominio, la revisión legal de los comentarios y programar las purgas (bloquean producción).
- `pnpm test` tiene una falla ajena: `textos.test.ts` («Menufeed»). Intermitentes: `sala.spec:323`, `videos-mux.spec:145`, `owner-lectura.rls` y *workers* con `0xC0000409`. E2E: usar `--workers=3`. Si `pnpm build` da `EPERM` en `.next/server`, borrar esa carpeta y repetir. `tools/escenarios-locales.mjs` es ajeno y sin seguir.
- Despliegue desde Windows: `flyctl deploy -c fly.staging.toml` con las cuatro `NEXT_PUBLIC_*` como `--build-arg` (clave `anon`, nunca la de servicio); ver `docs/produccion.md`.
- Next.js 16.4.3 con excepción `minimumReleaseAgeExclude` en `pnpm-workspace.yaml`: quitarla cuando cumpla la antigüedad.

## Próximo paso

1. Decidir si se sube a staging (`supabase db push` + `flyctl deploy`) y se pushea.
2. Probar en staging con sesión real promociones, carta y zona horaria.
3. S3 «Pedidos del mozo» (nivel C): usa `effective_prices`.
4. Pendientes anteriores: teléfono real (llamado, likes, comentarios), `/admin/cuentas` y **rotar la `service_role` legacy de staging** (urgente: se imprimió por error en una sesión del 2026-10-23).

# Ahora (handoff)

Actualizado: 2026-10-23 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

S1 y S2 del incremento «Salón y crecimiento» están **hechas**. En staging (migraciones y Fly versión 38, `origin/main` hasta `36bd655`): sucursal adicional, enlace e invitación de reseñas, vistas previas de funciones, [zona horaria por sucursal](cambios/zona-horaria-por-sucursal.md) y [promociones con precio efectivo](cambios/promociones-y-precio-efectivo.md) (esta, aprobada por Codex en 3 rondas y por el usuario).

**Hecho solo en local, commiteado y sin subir** (el commit de cierre de S2 está en `main` local, por delante de `origin`):
- [Panel de promociones](cambios/panel-de-promociones.md) (M): `/panel/{slug}/promociones` con alta, edición, pausa, duplicado, borrado, aviso de superposición y vista previa por día y hora; migración `20261124100000` (`save_promotion`, `SECURITY INVOKER`).
- [Carta con precio promocional](cambios/carta-con-precio-promocional.md) (M): la carta y el feed leen `effective_prices` en vivo y muestran tachado, promocional y «hasta cuándo» (es/en/pt). **No se midió el LCP.**
- [Historial de promociones](cambios/historial-de-promociones.md) (S).

Verificado: suite completa de RLS 1276/1276, E2E completo 440 de 441 (1 *worker* caído, ajeno), lint, typecheck y build. M y S sin revisión independiente de Codex por su nivel.

## Bloqueos y límites

- Subir la migración nueva a staging y desplegar la app pide tu aprobación (es lo visible al público).
- Clientes recurrentes (S4) espera la revisión de un abogado; los pedidos (S3) ya no esperan nada técnico. Siguen pendientes el dominio, la revisión legal de los comentarios y programar las purgas (bloquean producción).
- `pnpm test` tiene una falla ajena: `textos.test.ts` («Menufeed», commit `07facba`). Intermitentes: `sala.spec:323`, `videos-mux.spec:145`, `owner-lectura.rls` y *workers* con `0xC0000409`. Los E2E fallan por carga con los *workers* por defecto: usar `--workers=3`. Un `pnpm build` puede fallar con `EPERM` en `.next/server`: borrar `.next/server` y repetir. `tools/escenarios-locales.mjs` es ajeno y sin seguir.
- Despliegue en Fly desde Windows: `flyctl deploy -c fly.staging.toml --build-arg …` con las cuatro `NEXT_PUBLIC_*` (clave pública `anon`, nunca la de servicio); ver `docs/produccion.md`.
- Next.js está en **16.4.3** con una excepción `minimumReleaseAgeExclude` en `pnpm-workspace.yaml`: se puede quitar cuando cumpla la antigüedad mínima.

## Próximo paso

1. Decidir si se sube a staging (`supabase db push` + `flyctl deploy`) y se pushea a `origin`.
2. Probar en staging con sesión real: promociones (alta, pausa, vista previa), la carta con una promoción y la zona horaria.
3. Siguiente incremento: S3 «Pedidos del mozo», que usa `effective_prices` (nivel C: esquema, precio calculado por la base, estados, cierre y purga).
4. Pendientes anteriores: teléfono real (llamado, likes, comentarios), `/admin/cuentas` y **rotar la `service_role` legacy de staging** (urgente: se imprimió por error en el registro de una sesión del 2026-10-23).

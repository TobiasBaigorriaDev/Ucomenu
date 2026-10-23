# Ahora (handoff)

Actualizado: 2026-10-23 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

Del incremento «Salón y crecimiento» (diseño aprobado el 2026-10-23) están hechas y en staging (Fly versión 35) las tres primeras piezas de S1:

- **Sucursal adicional (C)**, [ficha](cambios/sucursal-adicional.md): migración `20261119100000`. Aprobada por Codex y por el usuario.
- **Enlace de reseñas de Google (M)**, [ficha](cambios/enlace-de-resenas-de-google.md): migración `20261120100000`.
- **Invitación a reseñar en la carta (M)**, [ficha](cambios/invitacion-a-resenar.md): en `origin/main` y en staging.

**Vistas previas de funciones por organización (C)**, [ficha](cambios/vistas-previas-de-funciones.md): implementada y verificada en **local**, migración `20261121100000` (tabla `organization_feature_previews`, `plan_grants` = plan ∪ vistas previas vigentes, dos funciones de SuperAdmin con auditoría y el bloque en la ficha de la organización). Aprobada por Codex y por el usuario. Migración y app en staging (Fly versión 36) y commits en `origin/main`. Ninguna de las cuatro funciones (`orders`, `promotions`, `review_invite`, `customers`) la lee todavía: cada ficha de función cablea la suya.

## Bloqueos y límites

- Codex aprobó (2 rondas, commit `eb5d1d4`) y el usuario aprobó subir la migración y la app, ya en staging. Falta probar el bloque con sesión real.
- Clientes recurrentes (S4) espera la revisión de un abogado; los pedidos (S3) esperan la función de precio efectivo de S2.
- Siguen pendientes: el dominio, la revisión legal de los comentarios y programar las purgas (bloquean producción).
- `pnpm test` tiene una falla ajena: `textos.test.ts` («Menufeed», commit `07facba`). Intermitentes: `sala.spec:323`, `videos-mux.spec:145` y `owner-lectura.rls` (pasa sola). `tools/escenarios-locales.mjs` es un archivo ajeno sin seguir: no se tocó.
- Next.js está en **16.4.3**; `pnpm-workspace.yaml` tiene una excepción `minimumReleaseAgeExclude` solo para `next@16.4.3` y sus `@next/*`: se puede quitar cuando cumpla la antigüedad mínima.

## Próximo paso

1. Probar en staging, con sesión de SuperAdmin, el bloque de vistas previas (habilitar, cambiar el fin, terminar).
2. Probar en staging, con sesión de SuperAdmin y de Dueño, la sucursal adicional y el enlace de reseñas, y la invitación a reseñar desde un teléfono.
3. Siguiente de S2: zona horaria por sucursal (M); luego promociones y función de precio efectivo (C).
4. Pendientes anteriores: probar en un teléfono real (llamado, likes, comentarios), `/admin/cuentas` y rotar la `service_role` legacy de staging (urgente: se imprimió por error en el registro de una sesión del 2026-10-23).

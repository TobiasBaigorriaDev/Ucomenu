# Ahora (handoff)

Actualizado: 2026-10-23 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

Del incremento «Salón y crecimiento» (diseño aprobado el 2026-10-23) están hechas, aprobadas y en staging (Fly versión 33, migraciones `20261119100000` y `20261120100000`) las dos primeras piezas de S1:

- **Sucursal adicional (C)**, [ficha](cambios/sucursal-adicional.md): migración `20261119100000` (catálogo con `extra_branch`, `org_limit`, `admin_set_extra_branches`, `admin_change_plan`), bloque en la ficha de SuperAdmin con elección de las sucursales a desactivar, y cupo, precio y aviso «Pedí una sucursal adicional» para el Dueño. Verificada con RLS (23 pruebas propias, concurrencia incluida), unitarias y E2E. Codex la revisó (1 ronda sobre `295046e`, sin hallazgos, APROBAR) y el usuario aprobó subirla a staging.
- **Enlace de reseñas de Google (M)**, [ficha](cambios/enlace-de-resenas-de-google.md): migración `20261120100000` y formulario en Sucursales. Verificado en local y en staging; la carta todavía no lo muestra.

Ambas están en `origin/main` (`eeec5f2`, subido el 2026-10-23) y en staging. El upgrade de Next (`34e17fa`) está en `origin/main` (`4dd6aeb`) y en staging.

## Bloqueos y límites

- Clientes recurrentes (S4) espera la revisión de un abogado; los pedidos (S3) esperan la función de precio efectivo de S2.
- Siguen pendientes: el dominio, la revisión legal de los comentarios y programar las purgas (bloquean producción).
- `pnpm test` tiene una falla ajena: `textos.test.ts` («Menufeed», commit `07facba`). Intermitentes: `sala.spec:323`, `videos-mux.spec:145` y `owner-lectura.rls` (pasa sola). `tools/escenarios-locales.mjs` es un archivo ajeno sin seguir: no se tocó.
- Next.js quedó en **16.4.3** (commit `34e17fa`, aviso de seguridad de 16.4.0; aprobado por el usuario). Verificado en un worktree: typecheck, lint y build limpios, `pnpm test` con la falla ajena de siempre y 123 E2E en verde. `pnpm` agregó a `pnpm-workspace.yaml` una excepción `minimumReleaseAgeExclude` solo para `next@16.4.3` y sus `@next/*` (la versión es más nueva que la antigüedad mínima); se puede quitar cuando cumpla la antigüedad. Desplegado en staging (Fly versión 34). No se ejecutó el comando de telemetría ni el `experimental.agentUpgrade` que sugería la guía del CLI.

## Próximo paso

1. Probar en staging, con sesión de SuperAdmin y de Dueño, vender y quitar una sucursal adicional y guardar un enlace de reseñas.
2. Invitación a reseñar en la carta (M, ya desbloqueada) y vistas previas por organización (C).
3. Pendientes anteriores: probar en un teléfono real (llamado, likes, comentarios), `/admin/cuentas` y rotar la `service_role` legacy de staging.

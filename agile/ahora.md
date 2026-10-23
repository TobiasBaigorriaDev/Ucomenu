# Ahora (handoff)

Actualizado: 2026-10-23 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

Del incremento «Salón y crecimiento» (diseño aprobado el 2026-10-23) están hechas, aprobadas y en staging (Fly versión 33, migraciones `20261119100000` y `20261120100000`) las dos primeras piezas de S1:

- **Sucursal adicional (C)**, [ficha](cambios/sucursal-adicional.md): migración `20261119100000`, bloque en la ficha de SuperAdmin y cupo, precio y aviso para el Dueño. Revisada por Codex (sin hallazgos) y aprobada para staging.
- **Enlace de reseñas de Google (M)**, [ficha](cambios/enlace-de-resenas-de-google.md): migración `20261120100000` y formulario en Sucursales. Verificado en local y en staging; la carta lo muestra desde la invitación.

- **Invitación a reseñar en la carta (M)**, [ficha](cambios/invitacion-a-resenar.md): enlace en el pie para todos los planes e invitación tras «Pedir la cuenta» con Pro o superior (una vez al día por dispositivo), textos fijos es/en/pt. Verificada en local; commit local sin subir ni desplegar.

Las dos primeras están en `origin/main` (`eeec5f2`, subido el 2026-10-23) y en staging. El upgrade de Next (`34e17fa`) está en `origin/main` (`4dd6aeb`) y en staging.

## Bloqueos y límites

- Clientes recurrentes (S4) espera la revisión de un abogado; los pedidos (S3) esperan la función de precio efectivo de S2.
- Siguen pendientes: el dominio, la revisión legal de los comentarios y programar las purgas (bloquean producción).
- `pnpm test` tiene una falla ajena: `textos.test.ts` («Menufeed», commit `07facba`). Intermitentes: `sala.spec:323`, `videos-mux.spec:145` y `owner-lectura.rls` (pasa sola). `tools/escenarios-locales.mjs` es un archivo ajeno sin seguir: no se tocó.
- Next.js está en **16.4.3** (`34e17fa`, aviso de seguridad; en staging, Fly versión 34). `pnpm-workspace.yaml` tiene una excepción `minimumReleaseAgeExclude` solo para `next@16.4.3` y sus `@next/*`: se puede quitar cuando cumpla la antigüedad mínima.

## Próximo paso

1. Probar en staging, con sesión de SuperAdmin y de Dueño, vender y quitar una sucursal adicional y guardar un enlace de reseñas.
2. Subir y probar en staging la invitación a reseñar (con enlace cargado, plan Pro, pedir la cuenta desde un teléfono); luego vistas previas por organización (C).
3. Pendientes anteriores: probar en un teléfono real (llamado, likes, comentarios), `/admin/cuentas` y rotar la `service_role` legacy de staging.

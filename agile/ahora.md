# Ahora (handoff)

Actualizado: 2026-10-23 · agente saliente: Claude Code. Historia anterior en Git y fichas.

## Punto de retomada

Del incremento «Salón y crecimiento» (diseño aprobado el 2026-10-23) están hechas en local las dos primeras piezas de S1:

- **Sucursal adicional (C)**, [ficha](cambios/sucursal-adicional.md): migración `20261119100000` (catálogo con `extra_branch`, `org_limit`, `admin_set_extra_branches`, `admin_change_plan`), bloque en la ficha de SuperAdmin con elección de las sucursales a desactivar, y cupo, precio y aviso «Pedí una sucursal adicional» para el Dueño. Verificada con RLS (23 pruebas propias, concurrencia incluida), unitarias y E2E. **Falta la revisión independiente de Codex y la aprobación** antes de aplicarla en staging.
- **Enlace de reseñas de Google (M)**, [ficha](cambios/enlace-de-resenas-de-google.md): migración `20261120100000` y formulario en Sucursales. Verificado en local; la carta todavía no lo muestra.

Ambas están en un solo commit local, sin subir a `origin` ni a staging. Los incrementos anteriores siguen en `origin/main` (`98a0c23`) y staging (Fly versión 32).

## Bloqueos y límites

- Clientes recurrentes (S4) espera la revisión de un abogado; los pedidos (S3) esperan la función de precio efectivo de S2.
- Siguen pendientes: el dominio, la revisión legal de los comentarios y programar las purgas (bloquean producción).
- `pnpm test` tiene una falla ajena: `textos.test.ts` («Menufeed», commit `07facba`). Intermitentes: `sala.spec:323`, `videos-mux.spec:145` y `owner-lectura.rls` (pasa sola). `tools/escenarios-locales.mjs` es un archivo ajeno sin seguir: no se tocó.
- `next build` y `eslint` a veces se detienen una vez por un aviso de actualización de seguridad de Next (CLI); repetir el comando continúa. No se ejecutó `next upgrade`: instalar o actualizar dependencias exige aprobación.

## Próximo paso

1. Revisión de Codex de la sucursal adicional (`ciclo-revision-codex`, nivel C) y, con su aprobación, `db push` y despliegue a staging.
2. Invitación a reseñar en la carta (M, ya desbloqueada) y vistas previas por organización (C).
3. Pendientes anteriores: probar en un teléfono real (llamado, likes, comentarios), `/admin/cuentas` y rotar la `service_role` legacy de staging.

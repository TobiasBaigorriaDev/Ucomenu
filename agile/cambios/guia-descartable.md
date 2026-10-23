# Cambio: Guía de primeros pasos descartable por cuenta y resumen por sucursal
Estado: **implementado y verificado en local (2026-10-23); falta subir a staging.** Resuelve las dos «decisiones pendientes» de [alta guiada del dueño](alta-guiada-del-dueno.md#decisiones-pendientes-para-quien-integra).
Nivel: **M** — esquema nuevo pero solo una preferencia de la persona (no cambia permisos, planes, dinero ni borrados); mismo molde que la [vista por sucursal](vista-por-sucursal.md) (ADR 0034).

## Objetivo
Decisión del usuario (2026-10-23): (1) cada persona puede **ocultar la guía** del Resumen, **guardado en su cuenta** (no en el navegador); (2) con **varias sucursales** la guía muestra el avance de cada una.

## Decisiones (particulares)
1. **Preferencia por persona y local**, tabla `member_guide_dismissals` (una fila por persona y local; vale para todos sus dispositivos), sin permisos ni políticas por la API; solo `set_my_guide_dismissed(org, ocultar)` y `my_guide_dismissed(org)`, para miembros. La clave foránea a `memberships` la borra al quitar a la persona del local. Migración `20261118100000`.
2. **Ocultar no esconde para siempre**: queda un renglón «Mostrar la guía de primeros pasos». Vale tanto para los pasos como para la guía completa. Dueño y Staff ocultan la suya; no se afectan entre sí ni entre locales.
3. **Ante un error de la base se muestra la guía** (falla abierto): no se esconde ayuda por una falla pasajera.
4. **Resumen por sucursal**, solo con más de una sucursal activa: «Por sucursal: Centro: 4 mesas activas · Norte: sin mesas activas.» en el paso de mesas y en el resumen de la guía completa, y un aviso por cada sucursal sin mesas activas («no tiene QR»). **La condición de «guía completa» no cambia** (carta visible + alguna mesa activa): la carta es central (ADR 0035) y no se exige mesas en todas las sucursales para no dar por incompleto un local que decidió no usarlas.
5. Sin JavaScript también funciona: el botón es un formulario con una acción de servidor.

## Aceptación
- [x] Ocultar y volver a mostrar persisten al recargar y desde otro dispositivo; el Staff conserva la suya; también se oculta la guía completa.
- [x] Solo un miembro guarda o lee la preferencia; `anon` no ejecuta las funciones; la tabla no se toca por la API (ni `service_role`); quitar la membresía la borra.
- [x] Con dos sucursales el resumen nombra las mesas de cada una y avisa de la que no tiene; con una sola no aparece.
- [x] Sin desborde a 390 px.

## Evidencia
Sobre el diff sin commitear de `main` (2026-10-23):
- `pnpm typecheck`, `pnpm lint` limpios · `pnpm db:reset` con la migración nueva · `pnpm db:types`.
- RLS: `guia-descartable` y `acl` 29/29. Unitarias de la guía 20/20 (`pnpm test` 907/908; la única falla es `textos.test.ts` («Menufeed»), ajena).
- E2E contra el build: `alta-guiada` 15/15 (ocultar/mostrar, otro dispositivo, Staff, guía completa, dos sucursales, una sola).

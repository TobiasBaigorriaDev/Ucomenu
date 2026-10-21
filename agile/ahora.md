# Ahora (handoff)

Actualizado: 2026-10-21 · agente saliente: Claude · historial anterior en `agile/historial.md`.

## Punto de retomada

**Vista por sucursal (nivel C) implementada y probada en local; falta la revisión de Codex y la aprobación humana.** [Ficha](cambios/vista-por-sucursal.md) · [ADR 0034](../docs/decisiones/0034-vista-por-sucursal.md) (propuesta). Migración nueva `20261106100000_vista_por_sucursal.sql` (tabla `member_branch_views`, `set_my_branch_view`, `my_branch_view` y `push_targets_for_call`). Staging **no** la tiene.

Cada persona (Dueño o Staff) elige qué sucursales mira: la sala, el cartel del panel, el sonido y el push siguen su elección; vacío = todas, y ante la duda se avisa. Es una preferencia, no un permiso (la membresía sigue por organización). La sala muestra cuántos llamados quedan en las otras sucursales; la analítica abre en la elegida. Fuera de alcance: asignar sucursales al Staff con restricción real.

Esperan aprobación humana, además: tanda 4 de UX ([ficha](cambios/detalle-retorno-y-confirmaciones.md), `06cd1bf`), tanda 3 ([ficha](cambios/formularios-cuenta-y-mensajes.md), `1ea4ca6`), [listas, orden e imágenes atómicos](cambios/orden-e-imagenes-atomicos.md) (ADR 0033, migración `20261105100000`), [cuentas globales](cambios/proteger-cuentas-globales.md) (ADR 0032, migración `20261104100000`) y el [borrado de mesas](cambios/borrado-de-mesas.md). Las tres últimas con migración están aprobadas por Codex. Fase 2 = feed de videos con **Mux Video** ([ADR 0031](../docs/decisiones/0031-feed-de-videos-cortos.md)).

## Bloqueos y riesgos

- **Producción:** bloqueada (dominio, Supabase de producción, revisión legal).
- Siguen con paginación por offset: carta pública, idiomas, sucursales, opciones de un plato y disponibilidad (ver la ficha de la tanda 2).
- No hay `global-error.tsx`: un error del layout raíz usa la pantalla por defecto de Next.
- Flaky conocido: en RLS completo, `owner-lectura` choca a veces con otro archivo que toca `audit_log`, y un worker puede caer con `0xC0000409`. Se repiten una vez.
- E2E con `--workers=1`; RLS y E2E no a la vez.

## Próximo paso

1. Revisión de Codex de la vista por sucursal: `pnpm revision:codex --commit HEAD --ficha agile/cambios/vista-por-sucursal.md --nivel C`.
2. El usuario aprueba; recién entonces subir a `origin`, aplicar las migraciones pendientes en staging y desplegar.
3. Probar en teléfonos reales el push con dos personas eligiendo sucursales distintas.

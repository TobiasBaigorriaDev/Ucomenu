# Ahora (handoff)

Actualizado: 2026-10-21 · agente saliente: Claude · historial anterior en `agile/historial.md`.

## Punto de retomada

**Carta central con precio, disponibilidad y visibilidad por sucursal (nivel 2a, nivel C) implementada y probada en local; Codex revisó 3 rondas y corregí lo confirmado; queda una decisión tuya sobre el rollback del historial y la aprobación humana.** Commits `2c9c465` … último de la serie. [Ficha](cambios/carta-por-sucursal.md) · [ADR 0035](../docs/decisiones/0035-carta-central-con-ajustes-por-sucursal.md) (propuesta). Migración nueva `20261107100000_carta_por_sucursal.sql` (columnas `price_cents` e `is_visible` en `product_availability`, `price_history.branch_id`, trigger del historial y RPC `create_product_in_branches`). Staging **no** la tiene.

Un catálogo por organización; cada sucursal puede tener precio propio de un plato (`$ 0` vale; sin precio hereda el general), marcarlo agotado u ocultarlo. La carta pública lee esos ajustes en vivo. Los topes del plan y los permisos no cambian. Con una sola sucursal la pantalla es la de siempre, salvo que ya haya ajustes. Fuera de alcance: cartas independientes, categorías o variantes por sucursal.

Esperan aprobación humana, además: la [vista por sucursal](cambios/vista-por-sucursal.md) (ADR 0034, con una decisión tuya sobre el criterio de aviso), las tandas 3 y 4 de UX, [orden e imágenes atómicos](cambios/orden-e-imagenes-atomicos.md) (ADR 0033), [cuentas globales](cambios/proteger-cuentas-globales.md) (ADR 0032) y el [borrado de mesas](cambios/borrado-de-mesas.md).

## Bloqueos y riesgos

- **Producción:** bloqueada (dominio, Supabase de producción, revisión legal).
- El rollback de la migración deja el historial por sucursal mezclado para el código anterior; los datos se conservan. Decidir si se acepta o se rediseña en una tabla propia (ficha, «Revisión independiente»).
- Sin cambios tuyos commiteados: `docs/decisiones/0031…`, hunks de Mux en `docs/` y `agile/tablero.md`, y `tools/escenarios-locales.mjs`.
- E2E con `--workers=1`; RLS y E2E no a la vez.

## Próximo paso

1. **Decidir** la limitación del rollback del historial (ficha).
2. El usuario aprueba; recién entonces subir, aplicar migraciones pendientes en staging y desplegar.
3. Probar en un teléfono real el alta con sucursales y los precios propios.

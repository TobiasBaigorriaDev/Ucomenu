# Ahora (handoff)

Actualizado: 2026-10-17 · agente saliente: Claude Code · historial anterior en `agile/historial.md`.

## Punto de retomada

`main` contiene ahora el rediseño de la carta pública (Bento + Editorial + Cards, Gloock + Schibsted, bandas de categoría pegajosas, cards de plato, dock de llamado), aprobado por el usuario y revisado de forma independiente. Evidencia en la [ficha](cambios/ui-carta-publica.md). El contexto de diseño vive en [`PRODUCT.md`](../PRODUCT.md) y [`DESIGN.md`](../DESIGN.md) (con su sidecar `.impeccable/design.json`); el contrato de dirección, en `.impeccable/surfaces/`.

La demo se llena con `pnpm db:demo` (fotos, 7 categorías por local, logo, plan Pro; `--sin-fotos` y `--sin-logo` para el peor caso). Antes de correr RLS o E2E hay que volver al seed limpio: `pnpm db:reset` o `pnpm db:demo --quitar`. Detener `pnpm dev` antes de `pnpm build` o de los E2E y reiniciarlo después: compilar con el servidor vivo le deja el CSS desactualizado.

## Bloqueos y riesgos

- En la última verificación, dos corridas completas de E2E seguidas se cayeron porque el servidor de prueba desapareció sin error; en tres tandas en primer plano la suite pasó entera. Causa del entorno sin diagnosticar: si vuelve a pasar, correr por tandas.
- La terracota de Oliva pasó a `#a43f22` por contraste; el resto de las paletas no cambió.
- Pendiente de la revisión de la carta: la ficha de detalle no se rehízo como bento y sigue con radios y estructura anteriores; el tope de 6 opciones en cards chicas solo tiene prueba unitaria (el seed no tiene un plato con más).
- Las migraciones de identidad, carta, disponibilidad y slugs existen solo en local; ensayo remoto requiere autorización. Producción sigue bloqueada: [ficha](cambios/salida-a-produccion.md), ADR 0015.

## Próximo paso

1. Elegir del backlog el ítem desbloqueado de mayor valor. Está listo para retomar «Desactivar sucursales» ([ficha](cambios/desactivar-sucursales.md)), con sus cinco decisiones ya aprobadas por el usuario.
2. Cuando haya autorización: aplicar migraciones a staging, desplegar `main` y probar con sesión SuperAdmin, sucursales, disponibilidad y la carta nueva en un teléfono real.
3. Opcional: rehacer la ficha de detalle del plato como bento.

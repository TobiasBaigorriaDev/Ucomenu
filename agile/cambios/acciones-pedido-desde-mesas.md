# Acciones del pedido desde Mesas

Nivel: M. Estado: implementado y verificado en local; pendiente publicación.

## Alcance y decisiones
- Mesas en vivo ofrece «Cerrar o anular pedido…» cuando muestra un pedido, tanto en tarjetas como en filas. Lleva al detalle con la confirmación existente abierta, con datos frescos del servidor.
- El detalle ofrece «Anotar plato» junto a «Volver a mesas» y conserva el botón inferior; se retira el cierre de la barra inferior.
- Se conserva acceso de cierre en el detalle para pedidos sin platos vigentes o con el plan deshabilitado: esos casos no aparecen como pedidos operables en el tablero.
- Solo navegación y presentación: no cambian acciones, permisos, importes ni reglas de cierre/anulación. Cancelar la confirmación abierta desde Mesas vuelve al tablero.

## Aceptación
- [x] Acceso de cierre en ambas vistas solo para mesas con pedido; abrirlo no cierra ni anula.
- [x] Cerrar y anular conservan resumen, advertencias, motivo obligatorio y retorno al tablero.
- [x] Ambos botones de anotar abren la misma carta; móvil sin desborde.
- [x] Se mantienen los accesos excepcionales indicados arriba.

## Evidencia
- Diff local desde `62c5ca8`: tres archivos de Sala y dos E2E. Después del build solo se ajustó indentación en JSX (sin cambios semánticos) y los tests.
- Lint focalizado, `pnpm typecheck` y `pnpm build`: correctos. Base local preparada con `pnpm db:start` y `pnpm db:reset`.
- `pnpm exec playwright test e2e/sala-anotar.spec.ts e2e/sala-operar.spec.ts --workers=1`: 12/13; el caso de anotación agotó 60 s buscando el nombre anterior «← Mesas». Se actualizó a «Volver a mesas», sin aumentar timeout.
- Repetición filtrada con `--grep 'el Staff anota un plato|cerrar el pedido avisa' --workers=1`: ambos casos pasan. Incluye apertura desde arriba/abajo, alineación móvil, cierre desde tarjetas, salida sin cambios y resumen. La primera corrida cubre anulación desde filas, motivo, concurrencia, pedido sin platos vigentes y plan deshabilitado.
- Capturas revisadas a 390 y 1280 px del detalle y tablero, en `output/playwright/acciones-pedido-*.png` y `output/playwright/cierre-mesas-*.png`; sin desbordes. No se ejecutó RLS: sin cambios en base, consultas ni autorización.
- Recuperación: revertir el incremento de presentación; sin migraciones. Sin push ni despliegue de este incremento.

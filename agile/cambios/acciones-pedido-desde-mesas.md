# Acciones del pedido desde Mesas

Nivel: M. Estado: desplegado en staging Fly v67; pendiente comprobación manual del usuario.

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

## Staging (2026-10-27)
- Usuario autorizó publicar. Snapshot limpio de `git archive d146c2e`, fuera del repositorio y sin el archivo ajeno `tools/escenarios-locales.mjs`.
- Primer intento falló por TLS handshake timeout de Docker Hub; el siguiente por conexión al descargar fuentes de Google. Se comprobó HTTP 200 a la fuente desde Windows y Docker; reconstrucción posterior correcta, sin modificar código ni configuración.
- Build y tipos en Docker correctos. `flyctl deploy -c fly.staging.toml --local-only --depot=false`: Fly **v67 complete**, imagen `registry.fly.io/ucomenu-staging:pedidos-d146c2e-git`, digest `sha256:00f6d50da4575faf61dc47a531129009a16e4c282617e8f597e3ff23f51ecdcf`; máquina started, control passing, smoke y DNS correctos.
- HTTP: inicio y login 200; sala sin sesión 307, sondeo 401. Ambos bundles nuevos responden 200 y contienen los accesos `cerrar-desde-mesas`, `abrir-carta-arriba` y la navegación `accion=cerrar`.
- Sin cambios de base, secretos ni producción. No se repitieron suites locales sin cambios de código. Falta comprobación manual con sesión real. Sin push a origin.
- Rollback: imagen `registry.fly.io/ucomenu-staging:mesas-300a9d7-git` (v66), sin operaciones de base.

# Ahora (handoff)

Actualizado: 2026-10-26 · agente saliente: Claude Code. Historia en Git y fichas.

## Punto de retomada

**Staging sigue en Fly v61** (imagen `ucomenu-staging:alimentaria-124bbc9`; marcha atrás: `apariencia-6b82cf2`, v60). **Lo nuevo no está desplegado.**

**Personal por sucursal, solo pantalla (nivel M):** [ficha](cambios/personal-por-sucursal.md). El Dueño asigna sucursales a un Staff o cocinero desde Personal («Sucursales» en la fila) y esa persona solo ve en pantalla (Mesas, Sala, Cocina, anotar, precuenta y avisos del celular) lo de ellas, sin nombres ni conteos de las demás; el Dueño no se restringe; si se desactivan todas las asignadas no ve nada. Columna `memberships.assigned_branch_ids` y migración `20261208100000` (solo local; **staging no la tiene**). Verificado en local (unitarias, lint, typecheck, RLS y E2E, detalle en la ficha). Está en «Para verificar» en el [tablero](tablero.md): falta tu comprobación manual.

**Pendiente anotado (nivel C):** la restricción real (RLS de `orders`, `order_items`, `tables`, `waiter_calls` y las funciones que escriben) está en el Backlog. Hoy una llamada directa a la API con ids de otra sucursal sigue funcionando.

## Límites y bloqueos

- **Producción sigue bloqueada** (abogado, datos de la razón social, correo de contacto, plazos comerciales, proveedor de IA, purgas sin programar); ver la [ficha legal](cambios/informacion-alimentaria-y-textos-legales.md).
- Decisiones abiertas del usuario: etiquetas por sucursal, alergias en observaciones, limpieza de `rate_key`.
- `acceso.spec` falla con varios workers por lentitud del ingreso y pasa con `--workers=1`. Si Windows repite `0xC0000409` con `forks`, repetir con `--pool=threads`. Si `pnpm build` falla con `EPERM` en `.next`, borrar `.next`. Docker Desktop encendido para RLS y E2E.
- Preservar `tools/escenarios-locales.mjs`, ajeno y sin seguimiento.

## Próximo paso

Probar a mano en local: asignar una sucursal a un mozo y a un cocinero y mirar sus pantallas. Si está bien, desplegar con su migración (requiere tu aprobación) y retomar el backlog (S4 Clientes recurrentes, o el [C] de personal por sucursal). Siguiente migración libre: `20261209100000`.

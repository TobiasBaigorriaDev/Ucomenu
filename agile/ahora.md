# Ahora (handoff)

Actualizado: 2026-10-26 · agente saliente: Claude. Historia en Git y fichas.

## Punto de retomada

**Rol de cocinero (nivel C): hecho, aprobado y en staging (Fly v59, migración `20261207100000` aplicada).** Pedido del usuario: un cocinero que ve los pedidos, marca cada plato «listo» y agota platos. Flujo anotado → listo → entregado; el cocinero solo hace lo de cocina; Pro y Premium en todas las sucursales. El usuario lo probó en local con una cuenta de cocinero y aprobó subirlo.

- Pantalla `/cocina/{slug}` con *Pedidos* y *Platos agotados*; el cocinero no entra a Sala ni a panel. El mozo ve «Listo para entregar» en Mesas y ya no tiene «En cocina».
- `is_org_member` pasó a ser solo Dueño o Staff: cualquier tabla o función nueva nace cerrada para el cocinero.
- Decisión en el [ADR 0048](../docs/decisiones/0048-rol-cocinero.md); aceptación, revisión (3 rondas de Codex) y evidencia de staging en la [ficha](cambios/rol-cocinero.md).

Antes: Mesas en vivo con filas y llamados dentro de Mesas, en staging (Fly v58); a probar con sesión real y teléfono.

Rama `main`, subida a `origin/main`.

## Límites y bloqueos

- S4 (Clientes recurrentes) bloqueado por la revisión legal. Producción bloqueada por dominio, revisión legal y purgas.
- Los locales demo de staging no tienen cocinero: para probarlo hay que crear uno desde Personal con un Dueño (plan Pro).
- Local: Café Ejemplo quedó en plan Pro con la cuenta `cocinero@cafe-ejemplo.test`; `pnpm db:reset` lo devuelve al seed.
- Si Windows repite `0xC0000409` con `forks`, repetir con `--pool=threads`. Si `pnpm build` falla con `EPERM` dentro de `.next`, borrar `.next` y repetir. Docker Desktop hay que encenderlo para RLS y E2E.
- Preservar `tools/escenarios-locales.mjs`, ajeno y sin seguimiento.

## Próximo paso

Probar en staging, en un teléfono: un Dueño crea un cocinero desde Personal, el mozo anota, la cocina marca «Listo» y agota un plato. Siguiente migración libre: `20261208100000`.

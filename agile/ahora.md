# Ahora (handoff)

Actualizado: 2026-10-26 · agente saliente: Claude. Historia en Git y fichas.

## Punto de retomada

**Rol de cocinero (nivel C): implementado, verificado en local y aprobado por Codex en la ronda 3; sin subir ni desplegar.** Pedido del usuario: un cocinero que ve los pedidos, marca cada plato «listo» y agota platos. Decisiones elegidas por el usuario: flujo anotado → listo → entregado, el cocinero solo hace lo de cocina, Pro y Premium en todas las sucursales.

- Pantalla `/cocina/{slug}` con *Pedidos* y *Platos agotados*; el cocinero no entra a Sala ni a panel. El mozo ve «Listo para entregar» en Mesas y ya no tiene «En cocina».
- Migración nueva `20261207100000_rol_cocinero.sql`, **aplicada solo en la base local**. `is_org_member` pasó a ser solo Dueño o Staff.
- Tres commits locales en `main`: `850d717`, `8ad8a71` y `5af09d9` (sin `push`). Decisión en el [ADR 0048](../docs/decisiones/0048-rol-cocinero.md); aceptación, revisión y evidencia en la [ficha](cambios/rol-cocinero.md).

Antes: Mesas en vivo con filas, en staging (Fly v58), y llamados dentro de Mesas; a probar con sesión real y teléfono.

Rama `main`, adelantada a `origin/main` por esos tres commits.

## Límites y bloqueos

- Falta tu aprobación para subir y desplegar el rol de cocinero (lleva migración y toca permisos). Nada contra staging ni producción sin ella.
- S4 (Clientes recurrentes) bloqueado por la revisión legal. Producción bloqueada por dominio, revisión legal y purgas.
- Si Windows repite `0xC0000409` con `forks`, repetir con `--pool=threads`. Si `pnpm build` falla con `EPERM` dentro de `.next`, borrar `.next` y repetir. Docker Desktop hay que encenderlo para RLS y E2E.
- Preservar `tools/escenarios-locales.mjs`, ajeno y sin seguimiento.

## Próximo paso

Aprobar el despliegue a staging (migración y app) y probarlo con un cocinero real: que el Dueño lo cree desde Personal, que anote el mozo, que la cocina marque «Listo» y agote un plato, todo en teléfono. Siguiente migración libre: `20261208100000`.

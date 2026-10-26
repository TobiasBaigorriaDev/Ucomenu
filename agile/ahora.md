# Ahora (handoff)

Actualizado: 2026-10-26 · agente saliente: Claude. Historia en Git y fichas.

## Punto de retomada

**Staging está en Fly v60** (imagen `ucomenu-staging:apariencia-6b82cf2`; marcha atrás: `rol-cocinero-0d926a7`, v59). Incluye el rol de cocinero (nivel C, migración `20261207100000` aplicada, [ADR 0048](../docs/decisiones/0048-rol-cocinero.md), [ficha](cambios/rol-cocinero.md)) y el arreglo de Apariencia.

- **Cocinero:** pantalla `/cocina/{slug}` con *Pedidos* y *Platos agotados*; no entra a Sala ni a panel. El mozo ve «Listo para entregar». `is_org_member` es solo Dueño o Staff: lo nuevo nace cerrado para el cocinero.
- **Apariencia (S):** tras guardar, React 19 reiniciaba el formulario y la opción marcada volvía a la anterior. Radios y fechas se remontan con una clave que incluye el valor guardado (`6b82cf2`, regresión en `e2e/identidad.spec.ts`). Sin migración.
- **Reseñas tras «Pedir la cuenta»:** funciona en Pro y Premium. No aparece si ya se mostró ese día en el dispositivo, si la cuenta ya estaba pendiente o si la sucursal no tiene enlace (comportamiento especificado).

Rama `main`, subida a `origin/main`.

## Límites y bloqueos

- S4 (Clientes recurrentes) bloqueado por la revisión legal. Producción bloqueada por dominio, revisión legal y purgas.
- Los locales demo de staging no tienen cocinero: para probarlo hay que crear uno desde Personal con un Dueño (plan Pro).
- Local: Café Ejemplo quedó en plan Pro con la cuenta `cocinero@cafe-ejemplo.test`; `pnpm db:reset` lo devuelve al seed.
- Si Windows repite `0xC0000409` con `forks`, repetir con `--pool=threads`. Si `pnpm build` falla con `EPERM` dentro de `.next`, borrar `.next` y repetir. Docker Desktop hay que encenderlo para RLS y E2E.
- Preservar `tools/escenarios-locales.mjs`, ajeno y sin seguimiento.

## Próximo paso

Probar en staging, en un teléfono: un Dueño crea un cocinero desde Personal, el mozo anota, la cocina marca «Listo» y agota un plato. Siguiente migración libre: `20261208100000`.

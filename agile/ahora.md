# Ahora (handoff)

Actualizado: 2026-10-31 · agente saliente: Claude.

## Punto de retomada

**Cerrado y desplegado en staging (Fly v88, `origin/main` en `63c3ad8`+):** Resumen del panel con datos del día, precio en Suscripción y **reservas de mesa, fase 1**. Las reservas: el personal carga reservas a mano en `/sala/{slug}/reservas` (por día o todas las «Próximas», sin duración por reserva: bloque fijo de 90 minutos), les asigna una mesa libre y las cancela, rechaza, sienta o marca «no vino»; plan Pro y Premium. Migración `20261215100000` aplicada en local y en `ucomenu-staging` (**la siguiente libre es `20261216100000`**). Revisada por Codex (3 rondas, APROBAR). Ver las fichas [reservas](cambios/reservas-de-mesa.md), [resumen](cambios/resumen-del-panel.md) y [precio](cambios/precio-en-suscripcion.md), y el [ADR 0051](../docs/decisiones/0051-reservas.md).

**Pospuesto por el usuario:** las fases 2 y 3 de reservas (formulario público con email, aviso push, disponibilidad automática); están en el [tablero](tablero.md) con lo que las bloquea (proveedor de correo y política de privacidad).

**Sin integrar:** estilo Hoja, animación del hero móvil y aparición de bloques de portada; falta tu visto bueno en teléfono (también el de la personalización de la carta).

**Git:** todo confirmado y en `origin/main`. Sin commit a propósito: `video/`, `.codegraph/`, `tools/demo-portada/mis-capturas/`, las skills de terceros y `security-audit`, `skills-lock.json`, `.claude/launch.json` y `tools/escenarios-locales.mjs`.

## Bloqueos y próximo paso

- Probar con una sesión real en staging (Aurelia está en Pro) el Resumen, la Suscripción y Reservas, y mirarlos en un teléfono.
- Base local con datos de demostración (Aurelia con pedidos y reservas, Café Ejemplo con la carga completa): `pnpm db:reset` las limpia y arregla `menu.spec.ts`. Docker Desktop hay que encenderlo y correr `pnpm db:start` para trabajar en local.
- Antes de producción: datos legales y su revisión, precios de portada contra el catálogo (catálogo en USD, portada en ARS), programar la purga de reservas, demo estable ([producción](../docs/produccion.md)).

Próximo paso: tu prueba en staging; después elegir entre la fase 2 de reservas, el cierre de lo que está «Para verificar» o lo que siga en el backlog.

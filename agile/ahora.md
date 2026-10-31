# Ahora (handoff)

Actualizado: 2026-10-31 · agente saliente: Claude.

## Punto de retomada

**Reservas de mesa, fase 1** (nivel C, en `origin/main` y **en staging, Fly v87**): el personal carga reservas a mano en `/sala/{slug}/reservas`, les asigna una mesa libre y las cancela, rechaza, sienta o marca «no vino»; plan Pro y Premium. Migración `20261215100000` aplicada en local y en `ucomenu-staging` (**la siguiente libre es `20261216100000`**). Revisada por Codex en 3 rondas (`c7b51f5`, APROBAR) y con las defensas de concurrencia comprobadas por mutación. Detalle en la [ficha](cambios/reservas-de-mesa.md) y el [ADR 0051](../docs/decisiones/0051-reservas.md). Faltan las fases 2 (botón «Reservar» en la carta, confirmación por email con proveedor a contratar, push al personal, política de privacidad) y 3 (disponibilidad automática y recordatorios).

**Ya en `origin/main` y staging (Fly v86):** Resumen del panel con datos del día y precio en Suscripción. Falta mirarlos con sesión real y en un teléfono.

**Sin integrar:** estilo Hoja, animación del hero móvil y aparición de bloques de portada.

**Git:** sin commit a propósito: `video/`, `.codegraph/`, `tools/demo-portada/mis-capturas/`, las skills de terceros y `security-audit`, `skills-lock.json`, `.claude/launch.json` y `tools/escenarios-locales.mjs`.

## Bloqueos y próximo paso

- Probar las reservas en staging con una sesión real (`aurelia` está en Pro) y en un teléfono.
- Antes de abrir el formulario público: actualizar la política de privacidad y programar la purga de reservas (`docs/produccion.md`, 4.d).
- Base local con datos de demostración (Aurelia, Café Ejemplo): `pnpm db:reset` las limpia y arregla `menu.spec.ts`.

Próximo paso: tu prueba en staging y decidir si arrancamos la fase 2 (contratar el proveedor de correo).

# Ahora (handoff)

Actualizado: 2026-10-31 · agente saliente: Claude.

## Punto de retomada

**Resumen del panel rediseñado** (nivel M, en `origin/main` `104004c` y **en staging, Fly v86**): `/panel/{slug}` ahora muestra *Ahora en el salón* (llamados, mesas con pedido, platos en cocina, por cobrar), *Ventas de hoy* contra el mismo día de la semana anterior con los últimos 7 días y los platos más pedidos (solo Dueño con Pro), *Para atender* (comentarios por revisar, platos agotados, plan cerca del tope) y *Tu carta pública* con copiar enlace y WhatsApp. La guía de primeros pasos sube arriba solo mientras está incompleta.  Sin migración; ver la [ficha](cambios/resumen-del-panel.md) y DESIGN.md.

**Precio en Suscripción** (nivel M, mismo commit y despliegue): arriba de `/panel/{slug}/suscripcion`, «Lo que pagás» muestra el precio de lista por mes o año (catálogo en USD), las sucursales adicionales aparte en ARS y el último pago. Ver la [ficha](cambios/precio-en-suscripcion.md).

**Ya en `origin/main` y staging:** aclaración de iOS (Fly v85), vibración (Fly v84; la siguiente migración libre es `20261215100000`) y tonos de aviso (Fly v83). Falta probarlos en un Android real.

**Sin integrar:** estilo Hoja, animación del hero móvil y aparición de bloques de portada; falta tu visto bueno en teléfono (también el de la personalización de la carta).

**Git:** sin commit a propósito: `video/`, `.codegraph/`, `tools/demo-portada/mis-capturas/`, las skills de HyperFrames y `security-audit`, `skills-lock.json`, `.claude/launch.json` y `tools/escenarios-locales.mjs`. Preservar `.agents/skills/security-audit/`, `.codegraph/`, `tools/escenarios-locales.mjs` y `video/`.

## Bloqueos y próximo paso

- Tu visto bueno del Resumen en un teléfono (y con una paleta clara).
- En la base local: Aurelia tiene pedidos de demostración que cargué yo, y Café Ejemplo la carga de demostración que rompe 3 pruebas de `menu.spec.ts`. `pnpm db:reset` limpia ambas; las pruebas RLS de `catalog`, `tenancy` y `push` también dependen de eso.
- Observación aparte: en el panel, a 390 px, la ventana de diseño del navegador se ensancha (~1435 px) por la lista de secciones; ya existía.
- Antes de producción: datos legales, precios de portada y demo estable ([producción](../docs/produccion.md), [tablero](tablero.md)).

Próximo paso: mirar el Resumen y la Suscripción en staging con una sesión real y en el teléfono.

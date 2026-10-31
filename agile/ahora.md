# Ahora (handoff)

Actualizado: 2026-10-31 · agente saliente: Claude Code.

## Punto de retomada

**Tonos de aviso elegibles** (nivel M): el Dueño elige en `/panel/{slug}/llamados` el tono del llamado de mesa y del pedido listo (los MP3 de siempre o cinco sintetizados con Web Audio), con «Escuchar». Verificado en local y **sin commit**; migración `20261213100000` aplicada solo en local (la siguiente libre es `20261214100000`). Evidencia, decisiones y lo no probado en la [ficha](cambios/tonos-de-aviso.md). Falta tu escucha de los cinco tonos y decidir si se integra y se despliega a staging.

**Personalización ampliada de la carta** (nivel C): integrada a `main` y subida a `origin/main` (HEAD `6c9f61b`), con sus tres migraciones aplicadas en local y en `ucomenu-staging`. Estado y revisión en la [ficha](cambios/personalizacion-ampliada-de-la-carta.md) y el [ADR 0050](../docs/decisiones/0050-personalizacion-ampliada-de-la-carta.md). Staging: Fly v82.

**Otros trabajos locales sin integrar:** estilo Hoja ([ficha](cambios/estilo-hoja.md)), animación del hero móvil ([ficha](cambios/animacion-hero-movil.md)) y aparición de bloques de portada ([ficha](cambios/aparicion-bloques-portada.md)); falta revisión visual en teléfono real.

**Git:** sin commit y ajenos a los tonos: este archivo, el tablero, `.impeccable/config.json`, dos fichas y `tests/rls/acl.rls.test.ts`. Preservar `.agents/skills/security-audit/`, `.codegraph/`, `tools/escenarios-locales.mjs` y `video/`.

## Bloqueos y próximo paso

- Personalización: tu visto bueno visual en teléfono (fuentes anchas con nombres largos) y probar Apariencia en staging con una sesión real.
- Pruebas RLS que fallan en mi base local por datos de demo ajenos (`catalog`, `tenancy`, `push`): conviene una base con `pnpm db:reset`, que borra la carga local de Café Ejemplo.
- Antes de producción: datos legales y su revisión, precios de portada contra el catálogo, demo estable. Ver [producción](../docs/produccion.md) y [tablero](tablero.md).

Próximo paso: escuchar los tonos en un dispositivo real; si te convencen, commit solo de los archivos de los tonos y despliegue a staging con tu aprobación.

# Ahora (handoff)

Actualizado: 2026-10-21 · agente saliente: Codex · historial anterior en `agile/historial.md`.

## Punto de retomada

**Borrado de categorías y platos (C) publicado y desplegado en staging**, por pedido del usuario tras revisión independiente. Rama `main`, código desplegado `7817aa1`; el commit posterior solo registra el cierre. [Ficha](cambios/borrado-de-categorias-y-platos.md) y [ADR 0029](../docs/decisiones/0029-borrado-de-categorias-y-platos.md).

- Confirmación en dos pasos, nombre y cantidad comprobados para categorías con platos; fotos limpiadas después del borrado. El historial se conserva.
- La corrección revisada evita limpiar fotos de platos que otra sesión movió de categoría y siguen existiendo.

Sin migración ni permisos nuevos: se conserva la RLS de Dueño y Staff. Staging está al día con la versión publicada. No se ejecutaron borrados ni se tocaron secretos o producción. Evidencia y recuperación en la ficha; falta probar el flujo autenticado en hosted.

Durante el cierre aparecieron cambios locales de **borrado de mesas**, incluida `20261103100000_borrado_de_mesas.sql`, posteriores al build de carta. Se preservaron y no se incluyeron en esta publicación: revisar Git antes de retomar y coordinar un solo escritor por worktree.

Integrado antes: [borrado de organizaciones](cambios/borrado-de-organizaciones.md), retenciones de `price_history` y pagos; [add-ons y baja](cambios/addons-y-baja-de-organizaciones.md) y [anular pagos](cambios/anular-pagos.md) en staging, falta la prueba manual del usuario con SuperAdmin.

Investigación abierta: [vencimiento en iPhone](cambios/ticket-de-visita.md#investigación-en-teléfono-real--2026-10-20).

## Bloqueos y riesgos

- **Producción:** bloqueada (dominio, Supabase de producción, revisión legal; ficha `salida-a-produccion`).
- **Plazo de 10 años de los pagos:** por confirmar con el contador antes de producción.
- Borrado de carta: irreversible; solo el respaldo (`pnpm respaldo`) lo cubre. Restringir categorías al Dueño sería un cambio de política aparte: hoy pueden ambos (con el nombre escrito).
- E2E: usar `--workers=1`. RLS completo ~12 min; RLS y E2E no se corren a la vez. Un worker caído con `0xC0000409` se repite una vez.

## Próximo paso

1. El usuario prueba el borrado de categorías y platos en staging con Dueño/Staff y datos de ensayo.
2. Prueba manual del usuario de las funciones pendientes de SuperAdmin, incluido el borrado de organizaciones.

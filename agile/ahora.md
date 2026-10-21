# Ahora (handoff)

Actualizado: 2026-10-21 · agente saliente: Claude · historial anterior en `agile/historial.md`.

## Punto de retomada

**Borrado de mesas (C) implementado, probado en local y aprobado por Codex** (ronda 1, sin hallazgos); sin aprobación humana todavía. Rama `main`; implementación `596704a`. [Ficha](cambios/borrado-de-mesas.md) y [ADR 0030](../docs/decisiones/0030-borrado-de-mesas.md) (propuesta).

- Dueño y Staff borran una mesa en dos pasos desde `/panel/{slug}/mesas`. Sus llamados se van por la cascada que ya existía (el historial dura 14 días, ADR 0014) y su QR impreso da 404.
- **Hay una migración nueva** (`20261103100000_borrado_de_mesas.sql`): permiso y política `DELETE` sobre `tables` (miembro y cuenta al día). Staging **no** la tiene: aplicarla es un paso aparte que requiere aprobación.
- Se pierden los llamados de esa mesa de los últimos 14 días en la estadística por franja horaria; la pantalla lo avisa.

El [borrado de categorías y platos](cambios/borrado-de-categorias-y-platos.md) ya está publicado y desplegado en staging (sin migración, código `7817aa1`); falta que el usuario lo pruebe con datos de ensayo.

Integrado antes: [borrado de organizaciones](cambios/borrado-de-organizaciones.md), retenciones de `price_history` y pagos; [add-ons y baja](cambios/addons-y-baja-de-organizaciones.md) y [anular pagos](cambios/anular-pagos.md) en staging, falta la prueba manual del usuario con SuperAdmin.

Investigación abierta: [vencimiento en iPhone](cambios/ticket-de-visita.md#investigación-en-teléfono-real--2026-10-20).

## Bloqueos y riesgos

- **Producción:** bloqueada (dominio, Supabase de producción, revisión legal; ficha `salida-a-produccion`).
- **Plazo de 10 años de los pagos:** por confirmar con el contador antes de producción.
- Borrados de carta y de mesas: irreversibles; solo el respaldo (`pnpm respaldo`) los cubre. Restringir el borrado de categorías al Dueño sería un cambio de política aparte.
- E2E: usar `--workers=1`. RLS completo ~7–12 min; RLS y E2E no se corren a la vez. Un worker caído con `0xC0000409` se repite una vez.

## Próximo paso

1. El usuario aprueba; recién entonces subir a `origin`, aplicar la migración en staging y desplegar.
2. El usuario prueba en staging el borrado de carta y de mesas (y lo pendiente de SuperAdmin).

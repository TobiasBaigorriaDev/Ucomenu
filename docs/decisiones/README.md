# Decisiones duraderas (ADR breves)

Registrá acá decisiones que seguirán vigentes y cuyo «por qué» se perdería: elección de stack, modelo de datos, estrategia de permisos, etc.

**No** es una transcripción de conversaciones. Un ADR ocupa media página.

## Convención
- Archivo: `NNNN-titulo-corto.md` (ej.: `0001-base-de-datos.md`), a partir de `_plantilla-adr.md`.
- Estados: `propuesta` → `aceptada` → (`reemplazada por NNNN` | `descartada`).
- Si una decisión cambia, **no borres el ADR**: creá uno nuevo y marcá el anterior como reemplazado.

## Índice
| N.º | Título | Estado | Fecha |
| --- | --- | --- | --- |
| 0001 | [Stack principal: Next.js + Supabase](0001-stack-principal.md) | aceptada | 2026-10-13 |
| 0002 | [WebAR sin app: `<model-viewer>` con GLB + USDZ](0002-webar-sin-app.md) | propuesta | 2026-10-13 |
| 0003 | [Fidelización con pases de Wallet y cercanía nativa](0003-fidelizacion-wallet-geofencing.md) | propuesta | 2026-10-13 |
| 0004 | [Multi-tenancy: organización con sucursales, aislada por RLS](0004-multi-tenant-rls-y-sucursales.md) | aceptada | 2026-10-13 |
| 0005 | [Autorización por membresía en la base, con permisos por columna](0005-autorizacion-por-membresia.md) | aceptada | 2026-10-14 |
| 0006 | [Planes, mora y límites resueltos en la base](0006-planes-mora-y-limites-en-la-base.md) | aceptada | 2026-10-14 |

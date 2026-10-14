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
| 0007 | [Acceso del personal: sesión por cookies, rol por membresía y alta desde el servidor](0007-acceso-del-personal.md) | aceptada | 2026-10-14 |
| 0008 | [Fotos de los platos: bucket público de Storage, ruta por organización y escritura con la cuenta al día](0008-fotos-de-platos-en-storage.md) | aceptada | 2026-10-14 |
| 0009 | [Mesas y QR: token opaco generado por la base, resolución pública por función y regeneración por trigger](0009-mesas-y-qr-token-opaco.md) | aceptada | 2026-10-14 |
| 0010 | [Llamado desde la mesa: una función de base como única puerta de escritura pública y límite por cliente como segunda línea](0010-llamado-desde-la-mesa.md) | aceptada | 2026-10-14 |
| 0011 | [Panel de sala: sondeo corto al servidor en vez de Supabase Realtime](0011-panel-de-sala-por-sondeo.md) | aceptada | 2026-10-14 |
| 0012 | [Historial de precios: trigger en la misma transacción, solo se agrega y sin borrado en cascada](0012-historial-de-precios.md) | aceptada | 2026-10-14 |

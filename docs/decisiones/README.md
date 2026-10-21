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
| 0013 | [SuperAdmin: rol de plataforma en tabla, alta de organizaciones en una función de base y auditoría de solo-agregado](0013-superadmin-alta-de-organizaciones-y-auditoria.md) | aceptada | 2026-10-14 |
| 0014 | [Purga de `waiter_calls`: retención de 14 días, función de base solo para el servidor y piso de 7 días](0014-purga-de-waiter-calls.md) | aceptada | 2026-10-15 |
| 0015 | [Estrategia de lanzamiento: Supabase Free con respaldos propios, hosting en un contenedor de Fly.io, staging aparte](0015-estrategia-de-lanzamiento.md) | aceptada | 2026-10-16 |
| 0016 | [Declaraciones dietarias cerradas y disponibilidad por sucursal en vivo](0016-etiquetas-y-disponibilidad-de-carta.md) | propuesta (implementada localmente) | 2026-10-16 |
| 0017 | [Conservar identificadores anteriores en la sucursal](0017-historicos-de-slug-por-sucursal.md) | aceptada (decisión técnica) | 2026-10-16 |
| 0018 | [Revisión cruzada automática entre Codex y Claude](0018-revision-cruzada-automatica.md) | aceptada; disparador reemplazado por 0019 | 2026-10-17 |
| 0019 | [Reservar la skill de revisión de Claude a tareas críticas](0019-revision-claude-solo-criticas.md) | aceptada | 2026-10-17 |
| 0020 | [Aviso de llamados con la pestaña cerrada: Web Push desde el servidor](0020-aviso-de-llamados-por-web-push.md) | aceptada | 2026-10-18 |
| 0021 | [El Dueño lee los pagos y el historial de su cuenta por funciones con proyección segura](0021-el-dueno-lee-pagos-y-auditoria.md) | aceptada (decisión técnica) | 2026-10-18 |
| 0022 | [Analítica básica: contadores anónimos por día y lectura solo para el Dueño con plan](0022-analitica-basica.md) | aceptada | 2026-10-18 |
| 0023 | [Carta en varios idiomas: traducciones escritas por el local, sin servicios externos](0023-carta-en-varios-idiomas.md) | aceptada | 2026-10-18 |
| 0024 | [Un pago mal cargado se anula con un asiento compensatorio; la vigencia vuelve a la de antes del pago](0024-anular-pagos-con-asiento-compensatorio.md) | aceptada | 2026-10-19 |
| 0025 | [Una organización se da de baja sin borrarla (cierra el acceso por RLS); los add-ons los gestiona el SuperAdmin con una función por acción](0025-baja-de-organizaciones-y-addons.md) | aceptada | 2026-10-19 |
| 0026 | [El historial de precios se purga solo al borrar la organización, tras 30 días de baja, por una función que nadie de la API ejecuta](0026-purga-del-historial-de-precios.md) | aceptada | 2026-10-20 |
| 0027 | [Los pagos sobreviven al borrado de la organización y se conservan 10 años; solo después se pueden purgar](0027-retencion-de-pagos.md) | aceptada | 2026-10-20 |
| 0028 | [El borrado definitivo de una organización es una sola función de base, tras 30 días de baja, con el slug escrito; los archivos se limpian después de confirmar](0028-borrado-definitivo-de-organizaciones.md) | aceptada | 2026-10-20 |
| 0029 | [Categorías y platos se borran con el cliente de la persona, con confirmación comprobada en el servidor y las fotos limpiadas después de confirmar](0029-borrado-de-categorias-y-platos.md) | aceptada | 2026-10-21 |

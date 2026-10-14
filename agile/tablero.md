# Tablero (backlog flexible)

> **No es un cronograma.** No hay obligación de ejecutar por orden. Se elige el próximo ítem **desbloqueado** de mayor valor, urgencia o reducción de riesgo. Sin microtareas numeradas salvo que tengan dependencias reales.

Estados: **Backlog · Seleccionado · En curso · Bloqueado · Para verificar · Hecho**

Formato por línea: `- [nivel S/M/C] Título — nota (bloqueado por: X) → ficha: agile/cambios/x.md`

## En curso
- (vacío)

## Seleccionado
- (vacío)

## Para verificar
- [C] Llamado desde la mesa: función de base `create_waiter_call` como única puerta de escritura pública (un pendiente por mesa y tipo, vencimiento derivado a 30 min, cooldown por mesa y tipo, límite por cliente, `unavailable` uniforme) y botones en `/t/{token}` — implementado en `feat/llamado-desde-la-mesa` (sin integrar): 123 unitarias, 308 de RLS, 104 E2E, 44 de 47 mutaciones detectadas (3 equivalentes); Codex: aprobar con cambios (P2 del límite por cliente corregido, falta su confirmación) → ficha: agile/cambios/llamado-desde-la-mesa.md · ADR 0010

## Bloqueado
- (vacío)

## Backlog
> Las fases agrupan por objetivo de entrega; dentro de cada una el orden es libre salvo las dependencias indicadas. Las fichas se crean al seleccionar el ítem.

### Fase 0 — Cimientos

### Fase 1 — MVP · Menú digital (plan Básico)
- [M] Variantes y adicionales: grupos de opciones en el panel y en el detalle del plato
- [M] Buscador y filtros dietarios en la carta pública
- [M] Disponibilidad por sucursal: marcar agotado; gestión de sucursales
- [M] Diseño gastronómico de alto impacto: sistema visual de la carta e identidad del local (logo y colores)
- [M] Rendimiento de la carta pública: caché, imágenes optimizadas, medición contra el objetivo de carga

### Fase 1 — MVP · Llamado al mozo (plan Pro)
- [M] Panel de sala en tiempo real: canal privado por sucursal, alerta sonora y visual, marcar atendido (con su política de `UPDATE`), recarga al reconectar; debe tratar como vencido todo pendiente con más de 30 min (desbloqueado: el llamado ya existe)
- [S] Configuración del llamado: UI para el cooldown por sucursal (`branches.waiter_call_cooldown_seconds`) y para silenciar una mesa (`tables.muted_until`); el vencimiento a 30 min ya es derivado y las columnas ya existen

### Fase 1 — MVP · Plataforma SaaS
- [C] SuperAdmin: alta de organizaciones, asignar/cambiar/suspender plan a mano, registro de pagos, prueba de 14 días, auditoría de cambios (bloqueado por: planes y entitlements)
- [S] ~~Aviso de mora al dueño en el panel~~ — resuelto dentro de «Acceso del personal» (hecho)
- [S] Historial de cambios de precio por trigger (`price_history`): quién, cuándo, valor anterior y nuevo; aprobado por el usuario (desbloqueado: la gestión de carta ya permite cambiar precios; hasta que exista, el Staff cambia precios sin registro)
- [S] Purga de `waiter_calls` por antigüedad (propuesta: 30 días) y textos legales sobre el identificador de cliente derivado de la IP — surgido de «Llamado desde la mesa»
- [M] Borrado de mesas: hoy solo se desactivan; se resuelve junto con el historial de llamados (surgido de «Mesas y QR»)
- [M] Borrado de categorías y platos: hoy solo se desactivan; borrar una categoría arrastra sus platos y sus fotos de Storage (hay que limpiar los archivos) — surgido de «Gestión de carta»
- [M] Alta guiada del dueño: primera sucursal, primera carta, primeros QR
- [S] Textos legales: términos, privacidad y aviso de alérgenos
- [M] Salida a producción: entornos de staging y producción, dominio, monitoreo de errores (requiere aprobación: despliegue y planes pagos)

### Fase 2 — Add-on WebAR
- [S] Spike descartable: `<model-viewer>` con un plato real en un iPhone y un Android — valida ADR 0002 y el presupuesto de peso
- [M] Catálogo de modelos 3D: carga desde SuperAdmin, validación de formato y peso, publicación (bloqueado por: spike WebAR, planes y entitlements)
- [M] «Ver en mi mesa»: botón por *feature flag*, visor bajo demanda, AR en iOS/Android y alternativa sin AR
- [S] Cupo de platos del add-on: 15 platos 3D y packs extra de +10 por USD 10/mes (definición comercial cerrada)

### Fase 3 — Fidelización, Wallet y cercanía (plan Premium)
- [S] Spike descartable: emitir un pase de prueba en Apple Wallet y Google Wallet con ubicaciones — valida ADR 0003 (bloqueado por: cuentas Apple Developer y emisor de Google Wallet; requiere aprobación y pago)
- [C] Programa de sellos: alta del socio con consentimiento, tarjeta, registro inmutable de sellos y canjes, escaneo desde `/sala`
- [C] Apple Wallet: firma del `.pkpass`, web service de actualización y push por APNs — manejo de certificados
- [C] Google Wallet: clase y objeto de fidelidad, enlace firmado, actualización por API — manejo de credenciales
- [M] Recordatorio por cercanía: coordenadas por sucursal, texto del recordatorio, actualización de pases al cambiar ubicaciones
- [M] Promociones por actualización de pase y baja del programa

### Fase 4 — Posterior al MVP
- [C] Cobro automático de la suscripción (Mercado Pago Suscripciones) con activación y suspensión por webhook
- [M] Subdominio o dominio propio por organización
- [M] Carta en varios idiomas
- [M] Analítica básica: platos más vistos y llamados por franja horaria — incluida desde el plan Pro

## Hecho
- [M] Mesas y QR: alta de mesas por sucursal, token opaco generado por la base, hoja imprimible, regenerar QR y entrada pública `/t/{token}` — revisado por Codex (aprobar con cambios; P2 de la sucursal perdida en el login corregido), 107 unitarias, 286 de RLS, 86 E2E y 46 de 51 mutaciones detectadas (5 equivalentes), integrado a `main` (2026-10-14); pendientes: confirmación de Codex del P2 y escaneo con un teléfono real → ficha: agile/cambios/mesas-y-qr.md · ADR 0009
- [M] Gestión de carta: categorías y platos con foto (Storage), orden y activo/inactivo, mensajes de tope (`53400`) y escrituras bloqueadas por mora — revisado por Codex (aprobar, una observación P3 corregida), 89 unitarias, 257 de RLS, 64 E2E y 32 de 34 mutaciones detectadas (2 equivalentes), integrado a `main` (2026-10-14) → ficha: agile/cambios/gestion-de-carta.md · ADR 0008
- [C] Acceso del personal: login y sesión (`@supabase/ssr`), `/panel` y `/sala` por rol, selector de local, gestión de personal por el Dueño, regla «una organización no se queda sin owner» en la base y aviso de mora (completo para el Dueño, reducido para el Staff) — revisado por Codex (aprobar), 43 unitarias, 226 de RLS, 46 E2E y 22/22 mutaciones detectadas, integrado a `main` (2026-10-14) → ficha: agile/cambios/acceso-del-personal.md · ADR 0007
- [C] Planes y entitlements: catálogo parametrizable, mora derivada (bordes al segundo), escrituras bloqueadas en solo lectura y suspendida, límites por plan con trigger, carta suspendida — revisado por Codex (2 rondas, aprobado), 176 pruebas de RLS, 16 E2E y 24 de 26 mutaciones detectadas (2 equivalentes), integrado a `main` (2026-10-14) → ficha: agile/cambios/planes-y-entitlements.md · ADR 0006
- [C] Núcleo multi-tenant: membresías, roles y RLS de escritura con aislamiento entre organizaciones — revisado por Codex (aprobar), 81 pruebas de RLS y mutaciones detectadas, integrado a `main` (2026-10-14) → ficha: agile/cambios/nucleo-multi-tenant.md · ADR 0005
- [M] Esqueleto caminante: bootstrap + carta pública de solo lectura con RLS — revisado por Codex (aprobar con cambios), correcciones aplicadas, integrado a `main` (2026-10-13) → ficha: agile/cambios/esqueleto-menu-publico.md
- [M] Exploración inicial: producto, arquitectura, ADR 0001–0004 y backlog (2026-10-13)

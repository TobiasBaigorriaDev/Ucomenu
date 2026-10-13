# Tablero (backlog flexible)

> **No es un cronograma.** No hay obligación de ejecutar por orden. Se elige el próximo ítem **desbloqueado** de mayor valor, urgencia o reducción de riesgo. Sin microtareas numeradas salvo que tengan dependencias reales.

Estados: **Backlog · Seleccionado · En curso · Bloqueado · Para verificar · Hecho**

Formato por línea: `- [nivel S/M/C] Título — nota (bloqueado por: X) → ficha: agile/cambios/x.md`

## En curso
- (vacío)

## Seleccionado
- [M] Esqueleto caminante: bootstrap + menú público de solo lectura — fija stack, comandos y forma de probar (instalaciones aprobadas el 2026-10-13) → ficha: agile/cambios/esqueleto-menu-publico.md

## Para verificar
- (vacío)

## Bloqueado
- (vacío)

## Backlog
> Las fases agrupan por objetivo de entrega; dentro de cada una el orden es libre salvo las dependencias indicadas. Las fichas se crean al seleccionar el ítem.

### Fase 0 — Cimientos
- [C] Núcleo multi-tenant: membresías, roles y políticas RLS de escritura con pruebas de aislamiento entre organizaciones (bloqueado por: esqueleto caminante)
- [M] Acceso del personal: login, sesión y estructura de `/panel`, `/sala` y `/admin` según rol (bloqueado por: núcleo multi-tenant)

### Fase 1 — MVP · Menú digital (plan Básico)
- [M] Gestión de carta en el panel del dueño: categorías y platos con foto, orden y activo/inactivo (bloqueado por: acceso del personal)
- [M] Variantes y adicionales: grupos de opciones en el panel y en el detalle del plato
- [M] Buscador y filtros dietarios en la carta pública
- [M] Mesas y QR: alta de mesas, token opaco, hoja imprimible, regenerar QR, entrada por `/t/{token}`
- [M] Disponibilidad por sucursal: marcar agotado; gestión de sucursales
- [M] Diseño gastronómico de alto impacto: sistema visual de la carta e identidad del local (logo y colores)
- [M] Rendimiento de la carta pública: caché, imágenes optimizadas, medición contra el objetivo de carga

### Fase 1 — MVP · Llamado al mozo (plan Pro)
- [C] Llamado desde la mesa: función de base validada con cooldown y un pendiente por tipo, límite por IP — escritura pública sin sesión (bloqueado por: mesas y QR)
- [M] Panel de sala en tiempo real: canal privado por sucursal, alerta sonora y visual, marcar atendido, recarga al reconectar (bloqueado por: llamado desde la mesa)
- [S] Configuración del llamado: cooldown por sucursal, silenciar mesa, vencimiento automático

### Fase 1 — MVP · Plataforma SaaS
- [C] Planes y entitlements: catálogo `plans` parametrizable, `subscriptions`, add-ons, `has_feature`, límites y estado de mora derivado, aplicados en base y servidor (bloqueado por: núcleo multi-tenant)
- [C] SuperAdmin: alta de organizaciones, asignar/cambiar/suspender plan a mano, registro de pagos, prueba de 14 días, auditoría de cambios (bloqueado por: planes y entitlements)
- [S] Aviso de mora al dueño en el panel y pantalla «Carta temporalmente no disponible» (bloqueado por: planes y entitlements)
- [S] Historial de cambios de precio por trigger (`price_history`) (bloqueado por: gestión de carta)
- [M] Alta guiada del dueño: primera sucursal, primera carta, primeros QR
- [S] Textos legales: términos, privacidad y aviso de alérgenos
- [M] Salida a producción: entornos de staging y producción, dominio, monitoreo de errores (requiere aprobación: despliegue y planes pagos)

### Fase 2 — Add-on WebAR
- [S] Spike descartable: `<model-viewer>` con un plato real en un iPhone y un Android — valida ADR 0002 y el presupuesto de peso
- [M] Catálogo de modelos 3D: carga desde SuperAdmin, validación de formato y peso, publicación (bloqueado por: spike WebAR, planes y entitlements)
- [M] «Ver en mi mesa»: botón por *feature flag*, visor bajo demanda, AR en iOS/Android y alternativa sin AR
- [S] Cupo de platos del add-on (bloqueado por: definición comercial del cupo)

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
- [M] Analítica básica: platos más vistos y llamados por franja horaria — sin plan asignado (bloqueado por: decidir en qué plan va)

## Hecho
- [M] Exploración inicial: producto, arquitectura, ADR 0001–0004 y backlog (2026-10-13)

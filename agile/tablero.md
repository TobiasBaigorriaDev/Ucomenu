# Tablero (backlog flexible)

> **No es un cronograma.** No hay obligación de ejecutar por orden. Se elige el próximo ítem **desbloqueado** de mayor valor, urgencia o reducción de riesgo. Sin microtareas numeradas salvo que tengan dependencias reales.

Estados: **Backlog · Seleccionado · En curso · Bloqueado · Para verificar · Hecho**

Formato por línea: `- [nivel S/M/C] Título — nota (bloqueado por: X) → ficha: agile/cambios/x.md`

## En curso
- (vacío)

## Seleccionado
- (vacío)

## Para verificar
- [M · C técnico] Buscador y filtros dietarios: implementado y verificado en local; pendiente revisión independiente → [ficha](cambios/buscador-y-filtros-dietarios.md)
- [M · C técnico] Disponibilidad por sucursal: implementado y verificado en local; pendiente revisión independiente → [ficha](cambios/disponibilidad-por-sucursal.md)

## Bloqueado
- [M] Salida a producción: la preparación local está hecha (`docs/produccion.md` y `pnpm prod:check`); estrategia en ADR 0015 (hosting: contenedor en Fly.io) y propuesta de operación en `docs/operacion.md`; staging ya está ensayado (2026-10-16); falta todo lo de producción (bloqueado por: el dominio —pospuesto, ver su ítem en el Backlog—, el proyecto de Supabase de producción en otra organización, `fly.toml` con claves propias, programar la purga y los respaldos, revisión legal de los textos y aprobación del usuario) → agile/cambios/salida-a-produccion.md

## Backlog
> Las fases agrupan por objetivo de entrega; dentro de cada una el orden es libre salvo las dependencias indicadas. Las fichas se crean al seleccionar el ítem.

### Fase 0 — Cimientos

### Fase 1 — MVP · Menú digital (plan Básico)
- [C] Desactivar sucursales: `is_active`; inactiva no cuenta para el tope, su carta y QR dicen «no disponible», sin llamados nuevos; reactivar respeta el tope (reglas decididas en la ficha; reemplaza `public_menu_status`, `resolve_table_qr`, `create_waiter_call` y `enforce_branch_limit`) → agile/cambios/gestion-de-sucursales.md

### Mejoras y deuda técnica (surgidas de «Pantalla del historial de precios»)
- [S] Probar en un teléfono real, a futuro: (1) el **ticket de visita** —dejar la carta abierta con la pantalla apagada más de 3 h, volver a la pestaña y comprobar que pide escanear de nuevo; ver cómo se comportan las pestañas que el navegador descarta— y (2) la pantalla **«Llamados»** (silenciar una mesa, cooldown, nombre largo con varios estados) en el salón; receta en `agile/historial.md` («Para usar la app en local»)
- [S] Probar en un teléfono real, sobre el staging (`https://ucomenu-staging.fly.dev`): los **textos legales** (`/terminos`, `/privacidad`, `/alergenos`) y el **alta** de una organización desde `/admin`, además de lo del ítem anterior (pendiente de «Salida a producción»)
- [S] Restaurar un respaldo en un proyecto de Supabase **nuevo** (en staging solo se vació y restauró el mismo): ensayar con `docs/operacion.md` y repetir una vez al mes; requiere crear un proyecto (aprobación del usuario) → agile/cambios/salida-a-produccion.md
- [S] Probar *Wake Lock* del panel de sala: exige HTTPS (túnel o certificado local; herramienta de terceros, requiere aprobación)

### Fase 1 — MVP · Llamado al mozo (plan Pro)
- (fase completa: llamado desde la mesa, panel de sala, ticket de visita y configuración del llamado están en «Hecho»)

### Fase 1 — MVP · Plataforma SaaS
- [C] SuperAdmin, incrementos pendientes: add-ons, desactivar organizaciones y lectura de la auditoría y de los pagos por el Dueño. **Antes de implementar el borrado de organizaciones: definir retención y purga de `price_history` y de `payments`** (`ON DELETE RESTRICT`, ADR 0012). Pendiente de producto: pantalla para corregir un pago mal cargado (hoy, SQL)
- [C] SuperAdmin: sumar una cuenta **existente** como Dueño de otra organización (hoy el alta exige un email nuevo) — surgido de «SuperAdmin: alta de organizaciones»
- [S] ~~Aviso de mora al dueño en el panel~~ — resuelto dentro de «Acceso del personal» (hecho)
- [C] Retención y purga de `price_history` (política y procedimiento aprobados, apagando el trigger a propósito): **prerrequisito del borrado de organizaciones en SuperAdmin** — surgido de «Historial de cambios de precio»
- [C] Borrado de mesas: hoy solo se desactivan; se resuelve junto con el historial de llamados (surgido de «Mesas y QR»)
- [C] Borrado de categorías y platos: hoy solo se desactivan; borrar una categoría arrastra sus platos y sus fotos de Storage (hay que limpiar los archivos) — surgido de «Gestión de carta»
- [S] Dominio: decidir el nombre definitivo y comprarlo (pospuesto 2026-10-16: el usuario no está seguro de `ucomenu.com`). Bloquea publicar producción e imprimir QR definitivos; staging usa la dirección provisoria de Fly → docs/produccion.md, paso 5

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
- [M] Corrección del slug de sucursal por SuperAdmin con históricos reservados y redirección a la dirección vigente → [ficha](cambios/correccion-slug-sucursal.md)
> Una línea por ítem: qué es, fecha y ficha. Pruebas, decisiones y revisiones viven en la ficha; los motivos duraderos, en el ADR.
- [C] Identidad del local: logo y cuatro paletas; revisión recibida sin bloqueantes, límites registrados y ajustes menores atendidos (2026-10-16) → agile/cambios/identidad-del-local.md
- [S] Categorías y platos de la carta pública paginados; cerrado sin revisión independiente por su nivel (2026-10-16) → agile/cambios/paginacion-carta-publica.md
- [M] Variantes y adicionales: grupos de opciones por plato (variante 1/1, adicionales 0/N) en el panel y bajo cada plato de la carta pública; lectura anónima solo de lo activo; revisado por Codex en dos rondas (2026-10-17; falta aplicar la migración y confirmar las decisiones de la ficha) → agile/cambios/variantes-y-adicionales.md
- [C] SuperAdmin: cambiar plan a mano, suspender y reactivar, registro de pagos de solo-agregado y prueba de 14 días como concepto aparte, con auditoría; reglas A1–A8 aprobadas por el usuario y revisado por Codex en dos rondas (2026-10-16; falta aplicar la migración en staging/producción) → agile/cambios/superadmin-planes-pagos.md · ADR 0013
- [C] Gestión de sucursales en el panel: el Dueño lista, crea y renombra en `/panel/{slug}/sucursales` dentro del tope del plan; política `INSERT` aprobada por el usuario, revisada por Codex en dos rondas (2026-10-16; falta aplicar la migración en staging/producción) → agile/cambios/gestion-de-sucursales.md
- [M] Rendimiento de la carta pública: fotos reducidas en WebP por `/_next/image` y caché de categorías y platos con invalidación desde el panel; LCP en 4G de 11,3 s a 1,9 s; revisado por Codex, con un límite aceptado (una lectura en vuelo durante una edición puede dejar la carta anterior hasta 60 s) (2026-10-16) → agile/cambios/rendimiento-carta-publica.md
- [M] Alta guiada del dueño: guía de primeros pasos en el Resumen del panel (carta, mesas, QR), deducida de los datos y sin esquema; pendientes de producto en la ficha: descartar la guía y varias sucursales (2026-10-16) → agile/cambios/alta-guiada-del-dueno.md
- [M] Cerrar la sesión de la mesa al atender «Pedir la cuenta»: un ticket anterior a la atención responde `session_closed` pasados 10 minutos de gracia (2026-10-16; falta aplicarlo en staging/producción y, si se quiere, revisión independiente) → agile/cambios/cerrar-sesion-al-atender-la-cuenta.md · ADR 0010
- [S] Repaso de diseño del historial de precios: agrupado por día, cambio de precio destacado y etiqueta Sube/Baja; sin tocar datos ni permisos; revisado en capturas a 390 y 1280 px (2026-10-16)
- [S] `expectNoHorizontalOverflow` mide el borde derecho de cada elemento (ignora lo recortado por un scroll propio) y reemplaza a las copias locales de tres specs; E2E completo en verde (2026-10-16); de paso, la siembra de `ticket-de-visita` ya no depende de los milisegundos
- [S] Textos legales: `/terminos`, `/privacidad` y `/alergenos`, enlazados desde la portada, el login y la carta; borrador pendiente de revisión legal (2026-10-16) → agile/cambios/textos-legales.md
- [M] SuperAdmin: el alta de una organización crea también su primera sucursal y la carta pública se abre de inmediato (2026-10-16) → agile/cambios/alta-con-primera-sucursal.md
- [M] Revisión de Codex automatizada desde Claude: `pnpm revision:codex` (Codex CLI en solo lectura, veredicto como código de salida) y skill `ciclo-revision-codex`; probada con Codex real y con un Codex falso (2026-10-16) → tools/revision-codex.mjs
- [C] Purga de `waiter_calls` por antigüedad: `purge_waiter_calls`, 14 días por defecto, piso de 7, solo `service_role`; falta programar su ejecución en «Salida a producción» (2026-10-16) → agile/cambios/purga-de-waiter-calls.md · ADR 0014
- [S] SuperAdmin: quien inicia sesión sin `next` aterriza en `/admin` (y el resto en `/panel`); un `next` válido manda siempre (2026-10-15, `aea92a8`)
- [M] Simplificación de Agile-SDD: rigor por consecuencias, verificación por impacto, una función por documento, handoff breve, sincronizador acotado a las 4 skills (2026-10-15) → agile/cambios/simplificacion-agile-sdd.md
- [S] Orden local del repositorio: `output/` excluido de Git y ESLint y `docs/referencias/HUMM-MENU.png` de Git; archivos conservados (2026-10-15)
- [C] SuperAdmin, alta de organizaciones: `/admin` y `/admin/nueva` crean una organización con su Dueño, plan y auditoría de solo-agregado (integrado a `main` 2026-10-15) → agile/cambios/superadmin-alta-de-organizaciones.md · ADR 0013
- [M] Configuración del llamado: silenciar mesas y cooldown por sucursal en `/panel/{slug}/llamados` (2026-10-14) → agile/cambios/configuracion-del-llamado.md
- [M] Ticket de visita: la pestaña de `/t/{token}` vence a las 3 h y la sala muestra cuánto hacía que escaneó (2026-10-14) → agile/cambios/ticket-de-visita.md · ADR 0010
- [M] Pantalla del historial de precios: por local y por plato, Dueño y Staff (2026-10-14) → agile/cambios/pantalla-historial-de-precios.md
- [M] Diseño gastronómico de la carta pública, dirección editorial (2026-10-14); la variante A queda como alternativa histórica (`feat/diseno-carta`, etiqueta `alt/carta-variante-a-tarjetas`) → agile/cambios/diseno-carta.md
- [M] Panel de sala en tiempo real por sondeo corto (2026-10-14) → agile/cambios/panel-de-sala.md · ADR 0011
- [C] Historial de cambios de precio: `price_history` de solo-agregado por trigger (2026-10-14) → agile/cambios/historial-de-precios.md · ADR 0012
- [C] Llamado desde la mesa: `create_waiter_call` como única puerta de escritura pública (2026-10-14) → agile/cambios/llamado-desde-la-mesa.md · ADR 0010
- [M] Mesas y QR: alta de mesas, token opaco, hoja imprimible y entrada pública `/t/{token}` (2026-10-14) → agile/cambios/mesas-y-qr.md · ADR 0009
- [M] Gestión de carta: categorías y platos con foto, orden y activo/inactivo (2026-10-14) → agile/cambios/gestion-de-carta.md · ADR 0008
- [C] Acceso del personal: login, `/panel` y `/sala` por rol, gestión de personal y aviso de mora (2026-10-14) → agile/cambios/acceso-del-personal.md · ADR 0007
- [C] Planes y entitlements: catálogo, mora derivada, límites por plan y carta suspendida (2026-10-14) → agile/cambios/planes-y-entitlements.md · ADR 0006
- [C] Núcleo multi-tenant: membresías, roles y RLS con aislamiento entre organizaciones (2026-10-14) → agile/cambios/nucleo-multi-tenant.md · ADR 0005
- [M] Esqueleto caminante: bootstrap + carta pública de solo lectura con RLS (2026-10-13) → agile/cambios/esqueleto-menu-publico.md
- [M] Exploración inicial: producto, arquitectura, ADR 0001–0004 y backlog (2026-10-13)

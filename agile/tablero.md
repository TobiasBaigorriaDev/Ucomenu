# Tablero (backlog flexible)

> **No es un cronograma.** No hay obligación de ejecutar por orden. Se elige el próximo ítem **desbloqueado** de mayor valor, urgencia o reducción de riesgo. Sin microtareas numeradas salvo que tengan dependencias reales.

Estados: **Backlog · Seleccionado · En curso · Bloqueado · Para verificar · Hecho**

Formato por línea: `- [nivel S/M/C] Título — nota (bloqueado por: X) → ficha: agile/cambios/x.md`

Actualizado: 2026-10-22. «Hecho» indica alcance implementado e integrado; las comprobaciones manuales pendientes se listan aparte. Producción sigue bloqueada aunque un cambio esté desplegado en staging.

## En curso

- (vacío)

## Seleccionado

- (vacío)

## Para verificar

- [S] Comprobar con sesión staging: catálogo vacío de add-ons y baja/reactivación en SuperAdmin; apariencia y temas, editor de platos y selector de Sala de Fly v18 — pendiente devolución del usuario → [catálogo y despliegue](cambios/catalogo-video-feed.md#despliegue-en-staging--2026-10-21) · [add-ons y baja](cambios/addons-y-baja-de-organizaciones.md)
- [S] Probar en un Android real la subida de videos desde el panel y el feed (también en Firefox y en Safari de escritorio) — sin resultado; el feed se probó en Chrome y en el teléfono del usuario → [ficha](cambios/feed-de-videos.md)
- [S] Ticket de visita en teléfono real: volver a la carta tras más de 3 h con la pantalla apagada y comprobar nuevo escaneo y recuperación de pestañas descartadas — sin resultado registrado del ensayo iniciado el 2026-10-19 → [ficha](cambios/ticket-de-visita.md)

## Bloqueado

- [M] Salida a producción — preparación y staging hechos; faltan dominio, proyecto de producción, configuración propia, purgas y respaldos programados, revisión legal y aprobación del usuario → [ficha](cambios/salida-a-produccion.md)
- [S] Spike descartable de Apple Wallet y Google Wallet con ubicaciones — bloqueado por cuentas de Apple Developer y emisor de Google Wallet, aprobación y pago; valida ADR 0003 → [ADR 0003](../docs/decisiones/0003-fidelizacion-wallet-geofencing.md)

## Backlog

> Las fases agrupan por objetivo de entrega; dentro de cada una el orden es libre salvo las dependencias indicadas. Las fichas se crean al seleccionar el ítem.

### Mejoras y decisiones pendientes del MVP

- [S] Decidir el tratamiento de cuentas Auth sin ningún local tras un borrado — hoy se conservan → [ficha de origen](cambios/borrado-de-organizaciones.md)
- [S] Dominio: elegir nombre definitivo y autorizar la compra — pospuesto por el usuario; bloquea producción y QR definitivos → [procedimiento](../docs/produccion.md)
- [S] Resolver las decisiones todavía abiertas de variantes y adicionales — conservar el comportamiento vigente hasta decisión explícita → [decisiones pendientes](cambios/variantes-y-adicionales.md#a-confirmar-decisiones-conservadoras-tomadas-sin-poder-preguntar)
- [S] Evaluar si la guía de primeros pasos debe poder descartarse y cómo resume varias sucursales — propuestas pendientes, sin cambio aceptado → [ficha](cambios/alta-guiada-del-dueno.md#decisiones-pendientes-para-quien-integra)
- [C] Verificar en la base el ticket de visita y la conexión de las escrituras públicas (llamado, likes y comentarios): hoy los arma y comprueba la acción de servidor y las funciones los aceptan omitidos, así que quien las llame directo con la clave pública y un token de mesa esquiva la sesión cerrada y el límite por conexión (en comentarios lo acotan un tope por organización y el de pendientes). Decidir entre firma del ticket verificable en la base o funciones solo para `service_role` → [límite conocido](../docs/decisiones/0031-feed-de-videos-cortos.md) · [ficha](cambios/comentarios-del-feed.md)

### Fase 2 — Feed de videos cortos (plan Premium)

> Reemplaza al add-on WebAR, descartado el 2026-10-21 (ADR 0002 → [ADR 0031](../docs/decisiones/0031-feed-de-videos-cortos.md)). Reglas en `docs/producto.md`, «Feed de videos cortos».
> Catálogo, elección de Mux, carga y publicación de videos, el feed, los likes y los comentarios están en «Hecho»; queda el texto legal (que bloquea habilitar comentarios en producción).

- [S] Textos legales: contenido publicado por comensales (comentarios) en `/terminos` y `/privacidad`, antes de habilitar comentarios en producción

### Fase 3 — Fidelización, Wallet y cercanía (plan Premium)

- [C] Programa de sellos: alta del socio con consentimiento, tarjeta, registro inmutable de sellos y canjes, escaneo desde `/sala`
- [C] Apple Wallet: firma del `.pkpass`, web service de actualización y push por APNs — manejo de certificados
- [C] Google Wallet: clase y objeto de fidelidad, enlace firmado, actualización por API — manejo de credenciales
- [M] Recordatorio por cercanía: coordenadas por sucursal, texto del recordatorio, actualización de pases al cambiar ubicaciones
- [M] Promociones por actualización de pase y baja del programa

### Fase 4 — Posterior al MVP

- [C] Cobro automático de la suscripción (Mercado Pago Suscripciones) con activación y suspensión por webhook
- [M] Subdominio o dominio propio por organización

## Hecho

> Una línea por ítem: qué es, fecha y ficha. Pruebas, decisiones y revisiones viven en la ficha; los motivos duraderos, en el ADR.

- [C] Comentarios con aprobación previa: `submit_video_comment` (única puerta; nace pendiente), hoja de comentarios en el feed, cola de moderación para Dueño y Staff en `/panel/{slug}/comentarios`, rechazados 7 días y pendientes 30 (purga `purge_video_comments`, sin programar); implementado y verificado en local; aprobado por Codex con el límite de la función pública aceptado por el usuario como excepción (3 rondas, 2026-10-23); sin subir a staging → [ficha](cambios/comentarios-del-feed.md) · [ADR 0031](../docs/decisiones/0031-feed-de-videos-cortos.md)
- [C] Likes anónimos desde la mesa: `set_video_like` (única puerta), un like por dispositivo y video con código aleatorio en el navegador, conteo público y límite por conexión; `/privacidad` actualizada; aprobado por Codex (2 rondas, 2026-10-22); en `origin/main` y en staging (2026-10-22); sin probar en teléfono → [ficha](cambios/likes-del-feed.md) · [ADR 0031](../docs/decisiones/0031-feed-de-videos-cortos.md)
- [C] Feed vertical de videos en la carta, también desde la mesa (`/t/{token}/videos`, con la barra de llamado): lectura pública por política de base, `hls.js` con fallback; aprobado por Codex (5 rondas), en staging y probado por el usuario (2026-10-22); sin probar en Firefox, Safari de escritorio ni Android → [ficha](cambios/feed-de-videos.md) · [ADR 0031](../docs/decisiones/0031-feed-de-videos-cortos.md)
- [C] Carga y publicación de videos desde el panel con Mux: hecho (partes A y B aprobadas por Codex, en staging, Fly v21; probado con un iPhone 16 y un `.mov` HEVC; Android sin probar) → [parte A](cambios/videos-del-panel-base.md) · [parte B](cambios/videos-mux-parte-b.md) · [ADR 0031](../docs/decisiones/0031-feed-de-videos-cortos.md)
- [C] Catálogo del feed: WebAR y `models_3d` retirados, contratos resueltos y SuperAdmin adaptado; `video_feed` en Premium y cupo de 10 publicados — aprobado, en `origin/main`, migración y app en staging (2026-10-21) → [ficha](cambios/catalogo-video-feed.md) · ADR 0031
- [M] Edición de plato por tareas: datos y foto juntos en PC, pestañas y borradores conservados — hecho (desplegado en staging, Fly v18, 2026-10-21) → [ficha](cambios/editor-plato-ux.md)
- [M] Selector de Sala: cambio directo de sucursal y selección múltiple explícita — hecho (desplegado en staging, Fly v18, 2026-10-21) → [ficha](cambios/selector-sucursal-directo.md)
- [C] Carta central con precio, disponibilidad y visibilidad por sucursal (nivel 2a): precio propio ($ 0 válido), agotado y oculto por sucursal; revisado por Codex (3 rondas); aprobado, subido y desplegado en staging con su migración (2026-10-21; el rollback del historial se acepta con su limitación) → [ficha](cambios/carta-por-sucursal.md) · ADR 0035
- [C] Vista por sucursal de cada persona (sala, cartel, sonido, push y analítica): preferencia, no permiso; revisado por Codex (3 rondas); aprobado, subido y desplegado en staging (2026-10-21) → [ficha](cambios/vista-por-sucursal.md) · ADR 0034
- [M] Detalle, retorno y confirmaciones y formularios, cuenta y mensajes (tandas 3 y 4 de UX): aprobados, subidos y desplegados en staging (2026-10-21) → [tanda 4](cambios/detalle-retorno-y-confirmaciones.md) · [tanda 3](cambios/formularios-cuenta-y-mensajes.md)
- [C] Listas completas (más de 1000 filas), reordenamientos atómicos y reemplazo de imágenes sin huérfanos: aprobado por Codex, subido y desplegado en staging con su migración (2026-10-21) → [ficha](cambios/orden-e-imagenes-atomicos.md) · ADR 0033
- [C] Cuentas globales de Auth protegidas (SuperAdmin intocable desde un local, reserva contra la carrera, 503 de sala con Auth caído, logos en el respaldo): aprobado por Codex, subido y desplegado en staging con su migración (2026-10-21) → [ficha](cambios/proteger-cuentas-globales.md) · ADR 0032
- [C] Borrado de mesas junto con sus llamados: aprobado por Codex, subido y desplegado en staging con su migración (2026-10-21) → [ficha](cambios/borrado-de-mesas.md) · ADR 0030
- [S] Almacenamiento y reproducción de videos: Mux Video elegido y aprobado; alcance y condiciones registrados (2026-10-21) → [ADR 0031](../docs/decisiones/0031-feed-de-videos-cortos.md)
- [C] Borrado de categorías y platos con limpieza de fotos, confirmación en dos pasos e historial conservado; revisado por Codex, publicación autorizada por el usuario, subido a `origin` y desplegado en staging (2026-10-21), con la RLS vigente de Dueño y Staff → [ficha](cambios/borrado-de-categorias-y-platos.md) · ADR 0029
- [C] SuperAdmin: borrado definitivo de organizaciones tras baja auditada de 30 días, con identificador escrito, motivo y auditoría; revisado por Codex, aprobado por el usuario, integrado en `main`, subido a `origin` y desplegado con su migración en staging (2026-10-20) → [ficha](cambios/borrado-de-organizaciones.md) · ADR 0028
- [C] Retención y purga de `payments` y `payment_voids`: sobreviven al borrado de la organización y se conservan 10 años; revisión independiente aprobada, integración autorizada por el usuario, subida a `origin` y desplegada en staging (2026-10-20; plazo por confirmar con el contador antes de producción) → [ficha](cambios/retencion-de-pagos.md) · ADR 0027
- [C] Retención y purga de `price_history`: se purga con la organización, tras 30 días de baja auditada, por una función que nadie de la API ejecuta; aprobada por Codex, subida a `origin` y migración aplicada en staging (2026-10-20) → [ficha](cambios/purga-de-price-history.md) · ADR 0026
- [C] SuperAdmin: gestión de add-ons y baja/reactivación de organizaciones — aprobado, integrado y desplegado en staging; catálogo actual sin WebAR (2026-10-20; retiro 2026-10-21) → [ficha](cambios/addons-y-baja-de-organizaciones.md) · ADR 0025
- [C] SuperAdmin anula un pago mal cargado: asiento compensatorio con motivo, solo el último pago vigente, el vencimiento vuelve al de antes y el Dueño lo ve marcado; revisado por Codex en dos rondas y aprobado por el usuario (2026-10-19; migración aplicada y desplegado en staging) → [ficha](cambios/anular-pagos.md) · ADR 0024
- [S] Prueba en un teléfono real sobre staging: textos legales (`/terminos`, `/privacidad`, `/alergenos`), alta de una organización desde `/admin` y pantalla «Llamados» en el salón; todo bien según el usuario (2026-10-19)
- [M] Carta en varios idiomas: español, inglés y portugués; el local escribe las traducciones en `/panel/{slug}/carta/traducciones`, la carta cae al español donde falta y no usa servicios externos; probada y aprobada por el usuario, integrada a `main` (2026-10-18; migración aplicada y desplegada a staging) → [ficha](cambios/carta-en-varios-idiomas.md) · ADR 0023
- [C] Analítica básica para el Dueño con plan Pro: platos más vistos (contadores anónimos por día, sin guardar nada del comensal) y llamados por hora de los últimos 14 días, con detalle al pasar el cursor o tocar; revisado por Codex en tres rondas y aprobado por el usuario (2026-10-19) → [ficha](cambios/analitica-basica.md) · ADR 0022
- [C] El Dueño lee los pagos y el historial de cambios de su cuenta en Suscripción: dos funciones de base solo de lectura con proyección segura (lista blanca, sin actor, motivo ni ids de terceros); revisado por Codex en dos rondas y aprobado por el usuario (2026-10-18); → [ficha](cambios/dueno-lee-pagos-y-auditoria.md) · ADR 0021
- [M] Aviso de llamados en iPhone y iPad: la sala y el panel se instalan como app (manifiesto, íconos, instrucciones en pantalla) y el aviso siempre se muestra en Apple; probado y aprobado por el usuario en un iPhone real contra staging (2026-10-18; desplegado a staging) → [ficha](cambios/aviso-push-iphone.md)
- [M] Aviso de llamados también desde el panel: cartel fijo con los llamados pendientes, «Sala en vivo» en modo alerta con contador, sonido que sigue al salir de la sala y activación del aviso del sistema desde el Resumen; probado y aprobado por el usuario en su Chrome (2026-10-18; desplegado a staging) → [ficha](cambios/aviso-push-desde-el-panel.md)
- [C] Aviso de llamados con la pestaña cerrada por Web Push (Android y Windows): tabla de suscripciones cerrada a la API, envío desde el servidor, service worker de la sala; revisado por Codex en tres rondas, probado por el usuario en Windows y Android contra staging y aprobado (2026-10-18) → [ficha](cambios/aviso-push-de-llamados.md) · ADR 0020
- [S] Restauración ensayada en un proyecto Supabase nuevo; repetición manual con recordatorio mensual configurado (2026-10-17) → [ficha](cambios/salida-a-produccion.md#ensayo-de-restauración-en-un-proyecto-nuevo-2026-10-17)
- [S] Wake Lock nativo del panel de sala comprobado con HTTPS en Chrome de Windows (2026-10-17) → [ficha](cambios/panel-de-sala.md#ensayo-de-wake-lock-nativo-con-https-2026-10-17)
- [S] Carta de demostración en staging: organización `demo` con 26 platos y 24 fotos; herramienta `tools/sembrar-demo-staging.mjs` (2026-10-17) → [ficha](cambios/demo-en-staging.md)
- [M] Login y sala en vivo con el lenguaje del panel; integrado a `main` y desplegado en staging (2026-10-17) → [ficha](cambios/ui-login-y-sala.md)
- [C] SuperAdmin suma una cuenta existente como Dueño de otra organización; integrado a `main`, migración aplicada en staging y aprobado por el usuario (2026-10-17) → [ficha](cambios/dueno-existente.md)
- [C] Desactivar y reactivar sucursales; integrado a `main`, migración confirmada en staging y cierre aprobado por el usuario (2026-10-17) → [ficha](cambios/desactivar-sucursales.md)
- [M] Rediseño del panel del Dueño y de SuperAdmin con el lenguaje de la carta (riel lateral, celdas, paleta del local y paleta UcoNext); revisado de forma independiente y por Codex; integrado a `main` y subido a `origin` (2026-10-17) → [ficha](cambios/ui-panel-dueno-y-superadmin.md)
- [M] Rediseño de la carta pública: Bento + Editorial + Cards (Gloock + Schibsted, bento de categorías, bandas pegajosas, cards de plato, dock de llamado); revisado de forma independiente; `PRODUCT.md` y `DESIGN.md` del sistema (2026-10-17) → [ficha](cambios/ui-carta-publica.md)
- [M] Corrección del slug de sucursal por SuperAdmin con históricos reservados y redirección a la dirección vigente → [ficha](cambios/correccion-slug-sucursal.md)
- [M · C técnico] Buscador y filtros dietarios con aviso de alérgenos junto a los filtros; integrado a `main` por decisión del usuario (2026-10-17) → [ficha](cambios/buscador-y-filtros-dietarios.md)
- [M · C técnico] Disponibilidad por sucursal (agotado visible, lectura en vivo); integrado a `main` por decisión del usuario (2026-10-17) → [ficha](cambios/disponibilidad-por-sucursal.md)
- [M] Temas de fechas especiales de la carta (San Valentín, Navidad, Halloween…), con ventana de fechas; aprobado y commiteado 2026-10-21; migración y app en staging (Fly v18) → [ficha](cambios/temas-de-fechas.md)
- [M] Personalización de la carta: paletas oscuras y vivas, vista previa real y estilo de carta; aprobado y commiteado 2026-10-21; migraciones y app en staging (Fly v18) → [ficha](cambios/personalizacion-carta.md)
- [C] Identidad del local: logo y cuatro paletas; revisión recibida sin bloqueantes, límites registrados y ajustes menores atendidos (2026-10-16) → [ficha](cambios/identidad-del-local.md)
- [S] Categorías y platos de la carta pública paginados; cerrado sin revisión independiente por su nivel (2026-10-16) → [ficha](cambios/paginacion-carta-publica.md)
- [M] Variantes y adicionales: grupos por plato y publicación de opciones activas — integrado y migración aplicada en staging; decisiones de producto abiertas en Backlog (2026-10-17; estado de staging actualizado 2026-10-21) → [ficha](cambios/variantes-y-adicionales.md)
- [C] SuperAdmin: planes, suspensión/reactivación, pagos y prueba de 14 días con auditoría — reglas A1–A8 aprobadas, integrado y migración aplicada en staging (2026-10-16; estado de staging actualizado 2026-10-21) → [ficha](cambios/superadmin-planes-pagos.md) · ADR 0013
- [C] Gestión de sucursales: alta y renombrado dentro del tope del plan — política aprobada, integrado y migración aplicada en staging (2026-10-16; estado de staging actualizado 2026-10-21) → [ficha](cambios/gestion-de-sucursales.md)
- [M] Rendimiento de la carta pública: fotos reducidas en WebP por `/_next/image` y caché de categorías y platos con invalidación desde el panel; LCP en 4G de 11,3 s a 1,9 s; revisado por Codex, con un límite aceptado (una lectura en vuelo durante una edición puede dejar la carta anterior hasta 60 s) (2026-10-16) → [ficha](cambios/rendimiento-carta-publica.md)
- [M] Alta guiada del dueño: primeros pasos en el Resumen — implementado e integrado; mejoras no decididas en Backlog (2026-10-16) → [ficha](cambios/alta-guiada-del-dueno.md)
- [M] Cierre de sesión de mesa al atender «Pedir la cuenta», con 10 minutos de gracia — revisado por Codex, integrado y migración aplicada en staging (2026-10-16; estado de staging actualizado 2026-10-21) → [ficha](cambios/cerrar-sesion-al-atender-la-cuenta.md) · ADR 0010
- [S] Repaso de diseño del historial de precios: agrupado por día, cambio de precio destacado y etiqueta Sube/Baja; sin tocar datos ni permisos; revisado en capturas a 390 y 1280 px (2026-10-16)
- [S] `expectNoHorizontalOverflow` mide el borde derecho de cada elemento (ignora lo recortado por un scroll propio) y reemplaza a las copias locales de tres specs; E2E completo en verde (2026-10-16); de paso, la siembra de `ticket-de-visita` ya no depende de los milisegundos
- [S] Textos legales: `/terminos`, `/privacidad` y `/alergenos`, enlazados desde la portada, el login y la carta; borrador pendiente de revisión legal (2026-10-16) → [ficha](cambios/textos-legales.md)
- [M] SuperAdmin: el alta de una organización crea también su primera sucursal y la carta pública se abre de inmediato (2026-10-16) → [ficha](cambios/alta-con-primera-sucursal.md)
- [M] Revisión de Codex automatizada desde Claude: `pnpm revision:codex` (Codex CLI en solo lectura, veredicto como código de salida) y skill `ciclo-revision-codex`; probada con Codex real y con un Codex falso (2026-10-16) → tools/revision-codex.mjs
- [M] Revisión de Claude desde Codex; procedimiento en ambos sentidos y skill exclusiva de tareas críticas C (2026-10-17) → [ficha](cambios/revision-claude-desde-codex.md)
- [C] Purga de `waiter_calls` por antigüedad: `purge_waiter_calls`, 14 días por defecto, piso de 7, solo `service_role`; falta programar su ejecución en «Salida a producción» (2026-10-16) → [ficha](cambios/purga-de-waiter-calls.md) · ADR 0014
- [S] SuperAdmin: quien inicia sesión sin `next` aterriza en `/admin` (y el resto en `/panel`); un `next` válido manda siempre (2026-10-15, `aea92a8`)
- [M] Simplificación de Agile-SDD: rigor por consecuencias, verificación por impacto, una función por documento, handoff breve, sincronizador acotado a las 4 skills (2026-10-15) → [ficha](cambios/simplificacion-agile-sdd.md)
- [S] Orden local del repositorio: `output/` excluido de Git y ESLint y `docs/referencias/HUMM-MENU.png` de Git; archivos conservados (2026-10-15)
- [C] SuperAdmin, alta de organizaciones: `/admin` y `/admin/nueva` crean una organización con su Dueño, plan y auditoría de solo-agregado (integrado a `main` 2026-10-15) → [ficha](cambios/superadmin-alta-de-organizaciones.md) · ADR 0013
- [M] Configuración del llamado: silenciar mesas y cooldown por sucursal en `/panel/{slug}/llamados` (2026-10-14) → [ficha](cambios/configuracion-del-llamado.md)
- [M] Ticket de visita: la pestaña de `/t/{token}` vence a las 3 h y la sala muestra cuánto hacía que escaneó (2026-10-14) → [ficha](cambios/ticket-de-visita.md) · ADR 0010
- [M] Pantalla del historial de precios: por local y por plato, Dueño y Staff (2026-10-14) → [ficha](cambios/pantalla-historial-de-precios.md)
- [M] Diseño gastronómico de la carta pública, dirección editorial (2026-10-14); la variante A queda como alternativa histórica (`feat/diseno-carta`, etiqueta `alt/carta-variante-a-tarjetas`) → [ficha](cambios/diseno-carta.md)
- [M] Panel de sala en tiempo real por sondeo corto (2026-10-14) → [ficha](cambios/panel-de-sala.md) · ADR 0011
- [C] Historial de cambios de precio: `price_history` de solo-agregado por trigger (2026-10-14) → [ficha](cambios/historial-de-precios.md) · ADR 0012
- [C] Llamado desde la mesa: `create_waiter_call` como única puerta de escritura pública (2026-10-14) → [ficha](cambios/llamado-desde-la-mesa.md) · ADR 0010
- [M] Mesas y QR: alta de mesas, token opaco, hoja imprimible y entrada pública `/t/{token}` (2026-10-14) → [ficha](cambios/mesas-y-qr.md) · ADR 0009
- [M] Gestión de carta: categorías y platos con foto, orden y activo/inactivo (2026-10-14) → [ficha](cambios/gestion-de-carta.md) · ADR 0008
- [C] Acceso del personal: login, `/panel` y `/sala` por rol, gestión de personal y aviso de mora (2026-10-14) → [ficha](cambios/acceso-del-personal.md) · ADR 0007
- [C] Planes y entitlements: catálogo, mora derivada, límites por plan y carta suspendida (2026-10-14) → [ficha](cambios/planes-y-entitlements.md) · ADR 0006
- [C] Núcleo multi-tenant: membresías, roles y RLS con aislamiento entre organizaciones (2026-10-14) → [ficha](cambios/nucleo-multi-tenant.md) · ADR 0005
- [M] Esqueleto caminante: bootstrap + carta pública de solo lectura con RLS (2026-10-13) → [ficha](cambios/esqueleto-menu-publico.md)
- [M] Exploración inicial: producto, arquitectura, ADR 0001–0004 y backlog (2026-10-13)

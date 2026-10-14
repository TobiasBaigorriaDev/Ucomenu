# Arquitectura — UcoMenu

> Diseño **acordado pero todavía no implementado**: el repo no tiene código de aplicación. Cuando exista, contrastar este documento con la implementación y registrar las desviaciones. Los motivos de cada decisión están en `docs/decisiones/`.

## Stack acordado
- **Lenguaje / framework:** TypeScript + Next.js (App Router, Server Components) + Tailwind CSS. → ADR 0001. Implementado (2026-10-13): Next 16.4.0, React 19.3.0, Tailwind 4.3.3, TypeScript 5.9.3; versiones exactas en `pnpm-lock.yaml`.
  - **Desviación consciente:** `cacheComponents` está **desactivado** (el scaffold lo trae activo). Con él, un 404 real exige prerender por slug y cachear por un slug arbitrario de una ruta pública es riesgoso; sin él, la carta se renderiza por pedido. El caché se diseñará en el ítem «Rendimiento de la carta pública» (ver `agile/cambios/esqueleto-menu-publico.md`).
- **Base de datos:** PostgreSQL gestionado por Supabase, con Row Level Security (RLS) como mecanismo de aislamiento. → ADR 0004
- **Tiempo real:** Supabase Realtime (solo para el panel de sala).
- **Autenticación:** Supabase Auth para dueño, staff y SuperAdmin. El comensal es anónimo. **Implementado** (ADR 0007): email y contraseña, sin registro público, sesión por cookies `httpOnly` con `@supabase/ssr` 0.12.7 y sin cliente de Supabase en el navegador.
- **Archivos:** Supabase Storage (fotos de platos, logos, modelos 3D).
- **Hosting / despliegue:** Vercel (aplicación) + Supabase Cloud (datos). Desplegar requiere aprobación explícita.
- **Pruebas (implementado):** unitarias y de RLS con Vitest (RLS contra Supabase local), E2E con Playwright a 390 px contra el build. Comandos en `AGENTS.md`.
- **Entorno verificado (2026-10-13):** Node 24, pnpm 11, Docker 29, Git, Python 3.12. La CLI de Supabase no estaba instalada; su instalación quedó aprobada por el usuario (ver `agile/herramientas-aprobadas.md`).

Convención (confirmada): identificadores de código y base en inglés; interfaz y documentación en español (es-AR).

## Módulos
| Módulo | Responsabilidad | Depende de |
| --- | --- | --- |
| **Tenancy y acceso** | Organizaciones, sucursales, membresías, roles, políticas RLS | Supabase Auth |
| **Planes y entitlements** | Catálogo de planes y límites parametrizable, add-ons, estado de suscripción derivado de fechas; funciones únicas `has_feature(org, feature)` y de límites | Tenancy |
| **Carta** | Categorías, platos, variantes/adicionales, etiquetas dietarias, disponibilidad por sucursal, imágenes | Tenancy, Storage |
| **Menú público** | Render de la carta para el comensal, buscador, filtros, resolución de QR de mesa | Carta, Planes |
| **Mesas y QR** | Alta de mesas, token opaco, generación e impresión de QR, regeneración | Tenancy |
| **Llamado al mozo** | Creación validada del llamado, cooldown, estados, difusión en tiempo real | Mesas, Planes, Realtime |
| **Panel de sala** | Vista en vivo para el personal, alertas, marcar atendido | Llamado al mozo, Auth |
| **Panel del dueño** | Administración de carta, mesas, sucursales, personal, apariencia | Todos los anteriores |
| **SuperAdmin** | Alta de organizaciones, gestión manual de planes, auditoría, carga de modelos 3D | Planes, Tenancy |
| **WebAR** *(fase 2)* | Catálogo de modelos 3D por plato, visor y lanzamiento de AR | Carta, Planes, Storage |
| **Fidelización** *(fase 3)* | Programa de sellos, socios, tarjetas, registro inmutable de movimientos | Tenancy, Planes |
| **Wallet** *(fase 3)* | Emisión y actualización de pases Apple/Google, ubicaciones para cercanía | Fidelización |

### Superficies (rutas, *supuesto de nombres*)
- `/m/{org}/{sucursal}` — carta pública por link directo.
- `/t/{token}` — entrada por QR de mesa: resuelve la mesa y muestra la misma carta con las acciones de llamado.
- `/panel` — gestión del local (dueño y staff; Suscripción y Personal solo dueño). `/sala` — personal de sala. `/admin` — SuperAdmin (pendiente).
- **Implementado** (ADR 0009): `tables` con clave compuesta a la sucursal, token opaco generado por la base, regeneración por *trigger*, tope `tables_per_branch` por *trigger* con la guarda de pertenencia antes de contar, escrituras con `org_can_write` y función pública `resolve_table_qr`. Rutas: `/panel/{slug}/mesas`, `/panel/{slug}/mesas/imprimir` y `/t/{token}`. El QR se dibuja en el servidor (`qrcode-generator`).
- **Implementado** (ADR 0007): `/login`, `/cuenta`, `/panel` y `/sala` (resuelven el local: directo con uno, selector con varios), `/panel/{slug}`, `/panel/{slug}/suscripcion`, `/panel/{slug}/personal` y `/sala/{slug}`. La organización activa vive **en la URL**, no en una cookie. `/m/{org}/{sucursal}` es la carta pública.
- Identificación del tenant **por ruta**; subdominio o dominio propio quedan como evolución.

## Datos principales
Esquema inicial resumido. Toda tabla de negocio lleva `organization_id`.

**Tenancy y acceso**
- `organizations` (nombre, slug, apariencia, estado)
- `branches` (organización, nombre, slug, dirección, `lat`/`lng`, zona horaria, configuración del llamado, `is_featured` para las sucursales «Principales» del pase)
- `memberships` (usuario ↔ organización, rol `owner` | `staff`)
- `platform_admins` (usuarios SuperAdmin)

**Planes** (precios y límites parametrizables: ningún valor comercial vive en el código)
- `plans` (código `basic` | `pro` | `premium`, precio mensual y anual en USD en centavos, límites: sucursales, mesas por sucursal, platos activos — nulo = sin límite —, y lista de features incluidas)
- `subscriptions` (organización, plan, ciclo `monthly` | `yearly`, `trial_ends_at`, `current_period_end`, notas)
- `subscription_addons` (organización, add-on `webar`, packs extra de platos 3D, vigencia)
- `payments` (organización, monto, moneda, período cubierto, registrado por, fecha) — registro manual del SuperAdmin
- `audit_log` (actor, acción, entidad, antes/después, motivo) — obligatorio para cambios de plan, add-ons y pagos
- **El estado de mora no se guarda: se deriva** con una función de `now()` y `current_period_end` (o `trial_ends_at`): `active` → `grace` (días 1–7) → `read_only` (8–15) → `suspended` (16+). Así no hace falta un proceso programado ni puede quedar desactualizado.

**Carta**
- `categories` (organización, nombre, orden, activa)
- `products` (organización, categoría, nombre, descripción, precio base en centavos, `image_path`, orden, activo). `image_path` guarda la ruta `{organization_id}/{product_id}/{uuid}.{ext}` del bucket público `product-images` (ADR 0008); un `check` la acota a la carpeta del propio plato
- `price_history` (plato u opción, precio anterior y nuevo, quién, cuándo) — se llena por trigger ante cualquier cambio de precio
- `option_groups` (plato, nombre, mínimo y máximo a elegir) y `options` (grupo, nombre, diferencia de precio). Una variante es un grupo con mínimo 1 y máximo 1; los adicionales, un grupo con mínimo 0 y máximo N.
- `dietary_tags` (catálogo global) y `product_dietary_tags`
- `branch_product_availability` (sucursal, plato, disponible)

**Salón**
- `tables` (organización, sucursal, etiqueta, `qr_token` opaco, activa; «silenciada hasta» llega con el llamado). El `qr_token` (32 hex) lo genera siempre la base y regenerarlo es tocar la columna (*trigger*); `anon` no lee la tabla: la entrada pública usa `resolve_table_qr(token)` (ADR 0009)
- `waiter_calls` (sucursal, mesa, tipo `waiter` | `bill`, estado `pending` | `attended` | `expired`, creado, atendido, atendido por)

**Fase 2 — WebAR**
- `product_models` (plato, ruta `.glb`, ruta `.usdz`, póster, peso, estado `draft` | `published`). El cupo (15 + 10 por pack extra) cuenta los modelos `published` de la organización.

**Fase 3 — Fidelización y Wallet**
- `loyalty_programs` (organización, sellos requeridos, premio, activo)
- `loyalty_members` (organización, nombre, teléfono normalizado E.164 — **único por organización**, email opcional, consentimiento y fecha, sucursal de alta)
- `loyalty_cards` (socio, programa, sellos actuales, número de serie) — una por socio y programa, válida en toda la organización
- `stamp_events` (tarjeta, sucursal, personal, tipo `stamp` | `redeem`, fecha) — solo inserción, es el registro de verdad; `loyalty_cards.stamps` es un derivado. Un índice impide más de un `stamp` por tarjeta y día (zona horaria de la sucursal).
- `wallet_passes` (tarjeta, plataforma `apple` | `google`, identificador del pase) y `apple_device_registrations` (dispositivo, token de push, pase)

Precios: enteros en centavos + moneda (`ARS`); nunca punto flotante.

## Multi-tenancy y permisos
- **Base y esquema compartidos**, aislamiento por `organization_id` con **RLS activado en todas las tablas** de negocio. La política estándar permite acceso solo si el usuario tiene una membresía en esa organización; las funciones auxiliares de pertenencia (`private.is_org_member`, `private.is_org_owner`) viven en el esquema `private`, no expuesto. **Implementado** (ADR 0005): la autorización sale de `memberships`, nunca del JWT ni de `user_metadata`; solo el servidor escribe membresías, organizaciones y sucursales; los permisos de escritura son por columna (`organization_id` no se puede cambiar por la API).
- **Comensal (rol anónimo):** solo lectura de filas publicables (organización activa, categoría y plato activos). No puede escribir en ninguna tabla directamente.
- **Staff:** lee y actualiza `waiter_calls`; lee y escribe categorías, platos, opciones, disponibilidad y mesas de su organización (y suma sellos en fase 3). No administra sucursales, personal ni apariencia, y no ve el plan.
- **Dueño:** todo lo del Staff, más sucursales, personal y apariencia; lee `subscriptions`, `subscription_addons`, `payments` y `audit_log` de su organización, sin poder escribirlos.
- **SuperAdmin:** opera desde el servidor con la clave de servicio; esa clave **nunca** llega al navegador.
- **Implementado** (ADR 0006): `plans`, `addons`, `subscriptions` y `subscription_addons` en la base; estado de mora derivado (`private.billing_state`, bordes inclusivos: gracia hasta +168 h, solo lectura hasta +360 h); escrituras de catálogo bloqueadas en `read_only` y `suspended` (`private.org_can_write` en las políticas); carta pública oculta en `suspended` (`private.org_is_published`) y mensaje «Carta temporalmente no disponible» en la ruta; límites por trigger con *advisory lock* (error `53400`); alta con prueba de 14 días por trigger. API: `org_entitlements(org)` y `public_menu_status(org, sucursal)`. Pendiente: `payments`, `audit_log` y `platform_admins` (SuperAdmin).
- **Implementado** (ADR 0007): la gestión del personal (alta, baja, rol, contraseña) la hace el servidor con `service_role`, **después** de comprobar con el cliente de la persona (RLS) que es `owner` de esa organización; nunca toma cuentas de otra organización. El *trigger* `private.guard_last_owner` impide dejar a una organización sin `owner` por cualquier camino. Cada página y cada acción de `/panel` y `/sala` vuelve a exigir sesión (`getUser()`) y membresía; `proxy.ts` solo renueva la sesión.
- **Feature flags:** una única función `has_feature(organization_id, feature)` deriva las capacidades del plan, los add-ons vigentes **y el estado de mora**: en `read_only` y `suspended` las features interactivas (`waiter_call`, `webar`, `loyalty`) devuelven falso, y en `suspended` también la carta pública. La usan las políticas RLS, las funciones de base y el servidor. Claves: `menu`, `waiter_call`, `analytics`, `loyalty` (por plan) y `webar` (por add-on vigente en Pro o Premium). La interfaz oculta lo no contratado, pero **la verificación que cuenta es la del servidor**.
- **Límites de plan** (sucursales, mesas, platos activos, platos 3D): se hacen cumplir en la base, al crear o activar, contra los valores de `plans`; superar el tope no borra nada, solo impide crear más.
- Las pruebas de aislamiento entre dos organizaciones son requisito para dar por hecho cualquier cambio de esquema (nivel C).

## Contratos e integraciones
### Tiempo real: llamado al mozo
```
Comensal (sin sesión, sin websocket)
  └─ POST al servidor con el token de la mesa y el tipo de llamado
       └─ función de base `create_waiter_call(token, tipo)`  ← única puerta de escritura
            ├─ valida token y mesa activa / no silenciada
            ├─ valida has_feature(org, 'waiter_call')
            ├─ valida cooldown de la mesa
            └─ inserta en waiter_calls (índice único parcial: 1 pendiente por mesa y tipo)
                 └─ trigger → difusión en el canal privado de la sucursal
                      └─ Panel de sala (personal autenticado, suscrito al canal de SU sucursal)
                           └─ alerta sonora + visual → «atendido» → UPDATE vía RLS
```
- **La tabla es la fuente de verdad; el evento es solo un aviso.** Al conectar o reconectar, el panel recarga los pendientes, y mantiene un sondeo lento de respaldo. Así un evento perdido nunca deja una mesa sin atender.
- **Cooldown y unicidad se resuelven en la base**, de forma atómica, para que dos toques simultáneos no generen dos llamados. Se suma un límite de frecuencia por IP en el servidor.
- **Canal privado por sucursal** con autorización por RLS: el personal solo puede suscribirse a canales de sucursales de **su** organización (la membresía es por organización, no por sucursal), nunca a las de otra.
- **Solo el personal mantiene conexiones en tiempo real.** El consumo de conexiones crece con los dispositivos del personal, no con los comensales.
- El comensal recibe confirmación en la respuesta del POST; conocer el estado posterior («ya te atendieron») se resuelve con una consulta liviana.
- Restricciones del navegador a tener en cuenta: el sonido requiere un gesto previo del usuario («activar alertas») y las pestañas en segundo plano se ralentizan; el panel debe pedir mantener la pantalla activa y se recomienda un dispositivo dedicado.

### Archivos 3D para WebAR (fase 2)
```
Producción (UcoMenu) → .glb optimizado a escala real + .usdz
  → carga desde /admin → validación (formato, peso, texturas) → Storage con nombre inmutable
  → product_models = published
  → Menú: si has_feature(org,'webar') y el plato tiene modelo publicado → botón «Ver en mi mesa»
       → <model-viewer> cargado bajo demanda
            ├─ Android: Scene Viewer / WebXR con el .glb
            ├─ iOS: AR Quick Look con el .usdz
            └─ sin soporte AR: visor 3D en pantalla
```
- Formatos: **`.glb`** (glTF binario) como fuente y para Android; **`.usdz`** para iOS. `<model-viewer>` puede generar el USDZ al vuelo, pero se guarda uno explícito porque la conversión automática tiene limitaciones (p. ej. animaciones); la generación automática queda como respaldo.
- El visor y los modelos **no se descargan con la carta**: se cargan recién al abrir el detalle de un plato que tiene modelo, para no penalizar el rendimiento del menú.
- *Supuesto de presupuesto:* modelo de hasta ~5 MB con texturas comprimidas; se ajusta con el spike en dispositivos reales.
- Las URL de Storage son públicas; el *feature flag* controla que el botón se ofrezca, no protege el archivo. Se acepta porque el modelo no es información sensible.

### Wallet y recordatorio por cercanía (fase 3)
```
Alta del socio → loyalty_member + loyalty_card
  ├─ Apple: el servidor arma y firma el .pkpass (tipo storeCard) con el certificado de UcoMenu
  │    · locations (hasta 10: sucursal de alta + «Principales» si hay más de 10) + relevantText  → cercanía en pantalla de bloqueo
  │    · webServiceURL + authenticationToken           → el pase se puede actualizar
  └─ Google: LoyaltyClass por programa + LoyaltyObject por tarjeta; enlace «Agregar a Google Wallet» con JWT firmado
       · merchantLocations (hasta 10)                    → notificación por cercanía que gestiona Google

Sello (el personal escanea el QR del pase en /sala)
  → INSERT stamp_events → recalcula loyalty_cards.stamps
       ├─ Apple: push vacío por APNs → el teléfono pide el pase actualizado al web service
       └─ Google: PATCH del LoyaltyObject por la API REST
```
- **UcoMenu es el único emisor** (un identificador de tipo de pase en Apple y una cuenta de emisor en Google) para todos los tenants; la marca del local va en el contenido del pase.
- **Web service de Apple Wallet** a implementar: registrar y dar de baja dispositivos, listar pases modificados, entregar la última versión del pase y recibir logs.
- **La cercanía la resuelve el sistema operativo** con las coordenadas incluidas en el pase: UcoMenu **no rastrea** la ubicación de nadie ni necesita un servicio de geolocalización propio. Cambiar las coordenadas de una sucursal obliga a actualizar los pases emitidos.
- La firma de pases usa criptografía de Node: esas rutas corren en runtime Node, no Edge.
- **Secretos** (certificado y clave de Apple, clave APNs, cuenta de servicio de Google): solo en el gestor de secretos del hosting. Nunca en Git ni en la base.
- Requisitos externos previos: Apple Developer Program (pago anual) y alta como emisor en Google Wallet con aprobación para producción.

## Límites y riesgos conocidos
- **Fuga entre tenants por una política RLS mal escrita.** Es el riesgo más grave. Mitigación: RLS por defecto en toda tabla, pruebas de aislamiento automáticas, revisión nivel C.
- **Abuso del llamado** con la foto de un QR desde fuera del local. Mitigación: cooldown, un pendiente por tipo, límite por IP, silenciar mesa y regenerar QR. No se valida ubicación del comensal.
- **Entrega en tiempo real no garantizada.** Mitigación: recarga al reconectar y sondeo de respaldo.
- **Panel de sala en un celular en segundo plano** puede no sonar. Limitación del navegador; se documenta para el local.
- **Peso de los modelos 3D** sobre datos móviles. Mitigación: carga bajo demanda, presupuesto de peso, póster previo.
- **Cercanía de Wallet no garantizada ni medible**, máximo 10 ubicaciones por pase. Limitación de plataforma: hay que comunicarla al vender Premium.
- **Vencimiento anual del certificado de Apple:** si vence, los pases dejan de actualizarse. Requiere recordatorio operativo.
- **Staff puede cambiar precios** (decisión de producto). Mitigación: `price_history` por trigger; el Dueño puede auditar los cambios.
- **Teléfono del socio sin verificar** (fase 3): identifica pero no autentica; alguien podría registrar un número ajeno. Impacto acotado porque los sellos los suma solo el personal. Reevaluar con verificación por código si aparece abuso.
- **Dependencia de Supabase y Vercel.** Se acepta por velocidad; los datos están en Postgres estándar y son portables.
- **Límites de los planes gratuitos** (pausa por inactividad, conexiones, almacenamiento): producción necesita plan pago antes del primer cliente real.

## Entornos
- **Desarrollo:** Supabase local (Docker) + Next.js local, con datos semilla ficticios.
- **Prueba:** despliegues de vista previa contra un proyecto Supabase de staging separado.
- **Producción:** proyecto Supabase propio y dominio definitivo.
- Los entornos de desarrollo y prueba **nunca** usan datos reales. Las migraciones se versionan en el repo y se aplican en orden; las destructivas requieren aprobación.

> Decisiones duraderas con motivo y alternativas → `docs/decisiones/`.

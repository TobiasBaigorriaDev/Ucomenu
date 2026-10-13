# Producto — UcoMenu

> Fuente de verdad de **qué debería hacer el producto**. Todo lo que figura acá está **aceptado por el usuario** (entrevista del 2026-10-13 y cierre de preguntas abiertas del mismo día), salvo lo marcado como *Supuesto (nuevo)*: valores de trabajo derivados por el agente al cerrar las definiciones, reversibles y a confirmar al iterar.

## Problema
Los restaurantes, bares y cafeterías dependen de cartas impresas o PDF que no se actualizan, no muestran bien el producto y no generan ningún vínculo con el cliente. En el salón, el comensal pierde tiempo esperando que el mozo lo vea para pedir algo o la cuenta. Y una vez que se va, el local no tiene forma barata de hacerlo volver.

UcoMenu es una plataforma web **mobile-first**, multi-tenant, vendida por suscripción (SaaS), que le da a cada local una carta digital de alto impacto, un canal directo mesa → mozo y, en niveles superiores, platos en realidad aumentada y una tarjeta de fidelidad en la billetera del teléfono.

- **Nombre comercial:** UcoMenu. **Dominio:** `ucomenu.com` (definido; el registro y la configuración de DNS se hacen al preparar la salida a producción).
- **Mercado inicial:** Argentina (es-AR). Precios de catálogo en USD; el cobro manual se hace en el equivalente en ARS.

## Usuarios
| Tipo de usuario | Qué necesita | Notas |
| --- | --- | --- |
| **Comensal** | Ver la carta al instante desde el celular, encontrar lo que puede comer, llamar al mozo o pedir la cuenta sin levantar la mano | Anónimo, sin registro ni app. Solo se identifica si se suma al programa de fidelidad |
| **Staff / Mozo** | Atender llamados desde el panel de sala; sumar sellos escaneando pases; mantener platos, precios, stock y mesas | Usuario con login, limitado a su organización. Acceso operativo completo (ver *Roles y permisos*) |
| **Dueño del restaurante** | Todo lo del Staff más sucursales, personal, apariencia, y ver su plan y su facturación | Administrador de su organización (tenant). No ve datos de otras organizaciones |
| **SuperAdmin SaaS** | Dar de alta organizaciones, asignar y suspender planes y add-ons, cargar los modelos 3D, dar soporte | Equipo de UcoMenu. Toda acción sobre planes queda auditada |

## Propuesta de valor
- **Para el local:** carta siempre actualizada y que vende mejor, salón más ágil, y herramientas de recompra que hoy solo tienen las cadenas grandes; todo sin instalar nada ni comprar hardware.
- **Para el comensal:** escanea y ve la carta en segundos, filtra por su dieta, llama al mozo con un toque.
- **Para UcoMenu:** ingreso recurrente escalonado; cada pilar es un motivo de upgrade.

## Módulos
### 1. Menú digital interactivo (core) — MVP
- Acceso por **QR único por mesa** o por **link directo** de la sucursal.
- Catálogo por categorías, buscador rápido, filtros dietarios (sin TACC, vegano, vegetariano, etc.).
- Detalle de plato con foto, descripción, **variantes** (elección única, p. ej. tamaño) y **adicionales** (elección múltiple con precio).
- Disponibilidad por sucursal (marcar un plato como agotado sin borrarlo).
- Identidad visual del local (logo y colores) sobre un diseño gastronómico de alto impacto.
- Es **solo consulta**: no hay pedidos ni pago online desde el menú.

### 2. Llamado al camarero en tiempo real — MVP
- Botón accesible desde el menú con dos acciones: **Llamar al mozo** y **Pedir la cuenta**.
- Solo disponible si se entró por el QR de una mesa (el link directo no identifica mesa).
- **Panel de sala** para el personal: lista en vivo con número de mesa, tipo de llamado y tiempo transcurrido, con alerta sonora y visual; el Staff marca «atendido».
- Anti-spam: cooldown por mesa y un único llamado pendiente por tipo.

### 3. Platos en realidad aumentada (WebAR) — add-on, fase 2
- Botón «Ver en mi mesa» en los platos que tienen modelo 3D; abre la experiencia AR nativa del teléfono (iOS y Android) **sin instalar apps**.
- Habilitado por *feature flag* según la suscripción de la organización.
- Los modelos los **produce UcoMenu como servicio** y los sube el SuperAdmin; el add-on incluye un cupo de platos con modelo 3D activo.

### 4. Fidelización con Wallet y recordatorio por cercanía — fase 3
- Alta en mesa y tarjeta de fidelidad guardada en **Apple Wallet** o **Google Wallet**.
- Mecánica de **sellos por visita**: el personal escanea el QR del pase y suma un sello; al llegar a N sellos se habilita un premio definido por el local.
- La tarjeta es **por organización**: los sellos valen en todas sus sucursales.
- **Recordatorio por cercanía:** el pase lleva las coordenadas de las sucursales y es el sistema operativo quien lo destaca cuando el cliente está cerca (ver límites en *Reglas de negocio*).

### 5. Administración del local (panel) — MVP
Carta, mesas y QR (generar, imprimir, regenerar), sucursales, personal, apariencia y configuración del llamado, según el rol.

### 6. Plataforma SaaS (SuperAdmin) — MVP
Alta de organizaciones, asignación manual de plan y add-ons, registro de pagos, suspensión/reactivación, auditoría.

## Modelo de suscripción
Tres niveles más WebAR como add-on, con **cobro manual** en el MVP: el SuperAdmin activa, cambia y suspende planes y registra los pagos; el pago se acuerda por fuera (transferencia o link de pago). El cobro automático es posterior. **Precios y límites son parametrizables en la base de datos**, no están escritos en el código.

| | Básico | Pro | Premium |
| --- | :---: | :---: | :---: |
| **Precio mensual** | USD 20 | USD 40 | USD 70 |
| **Precio anual** | USD 190 | USD 380 | USD 670 |
| Sucursales | 1 | hasta 2 | sin límite |
| Mesas | hasta 20 | hasta 50 por sucursal | sin límite |
| Platos activos | hasta 80 | hasta 200 | sin límite |
| Menú digital + QR por mesa + identidad visual | ✔ | ✔ | ✔ |
| Llamado al mozo / pedir la cuenta + panel de sala | — | ✔ | ✔ |
| Analítica básica (posterior al MVP) | — | ✔ | ✔ |
| Fidelización por sellos en Apple/Google Wallet + recordatorio por cercanía | — | — | ✔ |
| **Add-on WebAR** | no disponible | contratable | contratable |

- **Add-on WebAR:** +USD 25/mes sobre Pro o Premium. Incluye un cupo de hasta **15 platos con modelo 3D activo**. Se pueden habilitar **packs extra de +10 platos 3D** (**+USD 10/mes por cada pack**; parametrizable en la base).
- **Período de prueba:** **14 días gratis del plan Básico**, sin tarjeta de crédito.
- **Límites:** son techos para *crear* (no se puede superar el tope). Los platos se cuentan solo si están activos.
- **Cambio de plan:** bajar de plan desactiva funciones pero **no borra datos**; si lo existente supera el nuevo límite, se conserva y solo se bloquea crear más.
- En el MVP se venden **Básico y Pro**. Premium y el add-on WebAR se habilitan cuando se entreguen las fases 3 y 2.
- **Analítica básica** (platos más vistos, llamados por franja): incluida **desde el plan Pro** (Pro y Premium). Se construye después del MVP (Fase 4).

### Mora y suspensión (degradación progresiva)
Se cuenta desde el vencimiento del período pagado (o del fin de la prueba, *Supuesto (nuevo)*):

| Días de mora | Modo | Qué pasa |
| --- | --- | --- |
| 1 a 7 | **Gracia** | Todo funciona al 100%. Aviso al dueño en el panel |
| 8 a 15 | **Solo lectura** | La carta pública sigue visible (no se rompen los QR de las mesas). Se apagan los módulos interactivos: se oculta el botón de llamar al mozo, se desactiva «Ver en 3D/AR» y se pausa la suma de sellos |
| 16 en adelante | **Suspendida** | La carta pública muestra «Carta temporalmente no disponible». Todos los datos se conservan intactos hasta la reactivación |

- El estado se **deriva de las fechas** (vencimiento y fecha actual); registrar un pago extiende el período y restablece todo.
- *Supuesto (nuevo):* en modo solo lectura y suspendida, el panel del dueño sigue accesible con el aviso de mora.

## MVP
- **Incluye:** menú digital completo (módulo 1), llamado al mozo con panel de sala (módulo 2), panel (módulo 5), SuperAdmin con gestión manual de planes, límites y mora (módulo 6), multi-sucursal, planes Básico y Pro con *feature flags*, prueba gratuita de 14 días.
- **No incluye (fuera de alcance):** WebAR (fase 2), fidelización y Wallet (fase 3), cobro automático de la suscripción, pedidos y pago desde la mesa, reservas, delivery, integración con sistemas de punto de venta, app nativa, carta en varios idiomas.

## Reglas de negocio clave
### Organización, sucursales y permisos
- Un **tenant es una organización** con una o más **sucursales**. Cada sucursal tiene sus mesas, QR, personal y coordenadas GPS.
- La **carta es de la organización** y se comparte entre sucursales; la disponibilidad se ajusta por sucursal.
- Ningún usuario de una organización puede leer ni modificar datos de otra. Es el invariante central del producto.

### Roles y permisos
Solo hay dos roles dentro de una organización; **no existe rol intermedio de encargado**.

| Capacidad | Staff / Mozo | Dueño |
| --- | :---: | :---: |
| Atender llamados en el panel de sala | ✔ | ✔ |
| Escanear pases Wallet y sumar sellos | ✔ | ✔ |
| Gestionar platos, precios, stock (disponibilidad) y mesas | ✔ | ✔ |
| Administrar sucursales, personal y apariencia | — | ✔ |
| Ver plan, facturación y avisos de mora | — | ✔ |

- *Supuesto (nuevo):* lo que el Staff **no** puede hacer es lo que no figura en su definición (personal, sucursales, apariencia, plan).
- Cambiar plan, add-ons o estado de la suscripción es **exclusivo del SuperAdmin**; el Dueño solo los ve.
- Como el Staff puede cambiar precios, los **cambios de precio quedan registrados** (quién, cuándo, valor anterior y nuevo), sea Staff o Dueño quien los haga. Confirmado por el usuario el 2026-10-13.

### Menú
- El comensal solo ve categorías y platos **activos**; un plato agotado en la sucursal se muestra como no disponible, no desaparece.
- Las etiquetas dietarias las declara el local. La carta muestra un aviso de que la información sobre alérgenos es responsabilidad del establecimiento.
- El precio que se muestra es el precio base del plato; variantes y adicionales muestran su diferencia de precio.

### Mesas y QR
- Cada mesa tiene un QR con un **identificador opaco** (no el número de mesa), de modo que no se pueda adivinar el de otra mesa.
- Se puede **regenerar** el QR de una mesa; el anterior deja de funcionar para llamados.
- Entrar por link directo muestra la carta completa pero sin las acciones de llamado.

### Llamado al mozo
- Requiere plan Pro o superior y suscripción en gracia o activa; si no, el botón no se muestra.
- Por mesa puede haber **como máximo un llamado pendiente de cada tipo**. Reintentar mientras hay uno pendiente no crea otro: se le informa al comensal que ya fue avisado.
- **Cooldown de 60 segundos** entre llamados de la misma mesa, configurable por sucursal.
- Estados: `pendiente` → `atendido` (lo marca el personal) | `vencido` (automático a los **30 minutos**).
- El personal puede **silenciar una mesa** temporalmente ante abuso.
- El llamado no se pierde si el panel estaba desconectado: al reconectar aparecen todos los pendientes.

### Suscripción
- Qué puede usar una organización lo determinan su plan, sus add-ons y su estado de mora, y se verifica **siempre en el servidor**, nunca solo ocultando botones.
- Cada cambio de plan, add-on, pago o estado queda registrado con quién, cuándo y motivo.

### WebAR (fase 2)
- El botón aparece solo si la organización tiene el add-on activo, la suscripción no está en solo lectura **y** el plato tiene un modelo publicado.
- No se pueden tener más platos con modelo 3D activo que el cupo del add-on (15, más 10 por cada pack extra).
- Si el teléfono no soporta AR, se ofrece el visor 3D en pantalla en lugar de un error.
- El modelo debe respetar la escala real del plato.

### Fidelización y cercanía (fase 3)
- **Alta rápida en mesa:** nombre + **teléfono móvil (WhatsApp)** como identificador principal + email (opcional) + casilla de **consentimiento** explícito para el tratamiento de datos y para recibir recordatorios (Ley 25.326), con baja simple.
- El teléfono identifica al socio **dentro de la organización**: volver a registrarse con el mismo número no crea una segunda tarjeta. *Supuesto (nuevo):* el teléfono no se verifica por código en la primera versión; identifica, no autentica.
- Sumar sellos y canjear premios lo hace **solo el personal autenticado**, escaneando el pase. El cliente no puede sumarse sellos.
- **Máximo 1 sello por cliente por día** (la tarjeta es de la organización, así que el tope es entre todas sus sucursales).
- Cada sello y cada canje queda en un registro inmutable (quién, cuándo, en qué sucursal).
- La suma de sellos se pausa cuando la suscripción está en solo lectura o suspendida.
- **Ubicaciones del pase.** Cada pase admite 10 como máximo. Si la organización tiene hasta 10 sucursales, van todas. Si tiene más: primero la sucursal donde el cliente se dio de alta y luego se completa con las sucursales marcadas como **«Principales»** por el dueño. *Supuesto (nuevo):* la opción de elegir «las más cercanas» exigiría la ubicación del cliente en el alta; no se incluye y se reevalúa en la fase 3.
- **Límites reales del recordatorio por cercanía** (verificados en la documentación de las plataformas, ver ADR 0003):
  - No es un push propio: lo muestra Apple Wallet o Google Wallet según sus criterios; **no se garantiza** que aparezca ni se puede medir cuántas veces apareció.
  - Máximo **10 ubicaciones por pase** en ambas plataformas.
  - En Apple es un acceso destacado al pase en la pantalla de bloqueo con un texto definido por el local; en Google es una notificación cuyo **texto, radio y tiempo de permanencia decide Google**, y exige que el usuario haya dado a Google Wallet permiso de ubicación precisa permanente.
  - Las promociones puntuales («hoy 2×1») se envían como **actualización del pase**, que sí genera notificación, y no dependen de la ubicación.
  - **Web Push no sirve para cercanía:** una web no puede leer la ubicación en segundo plano. Queda descartado para este fin.

## Convenciones
- Identificadores de código, tablas y columnas en **inglés**; textos de interfaz y documentación en **español (es-AR)**.

## Requisitos no funcionales relevantes
- **Mobile-first:** el menú se diseña para 360–430 px y debe ser usable con una mano.
- **Rendimiento:** la carta debe verse rápido con datos móviles en el salón. Objetivo: LCP < 2,5 s en 4G.
- **Tiempo real:** el llamado debe aparecer en el panel de sala en pocos segundos. Objetivo: < 2 s en el percentil 95.
- **Aislamiento multi-tenant** verificado con pruebas automáticas, no solo por convención.
- **Accesibilidad:** contraste y tamaños legibles en ambientes con poca luz; objetivo WCAG 2.1 AA.
- **Privacidad:** el comensal anónimo no deja datos personales; los datos de fidelización se tratan con consentimiento.
- **Costos:** arquitectura que arranque en planes gratuitos o de bajo costo y escale con la cantidad de locales.

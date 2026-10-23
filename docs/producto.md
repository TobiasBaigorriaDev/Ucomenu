# Producto — UcoMenu

> Fuente de verdad de **qué debería hacer el producto**. Todo lo que figura acá está **aceptado por el usuario** (entrevista del 2026-10-13 y cierre de preguntas abiertas del mismo día), salvo lo marcado como *Supuesto (nuevo)*: valores de trabajo derivados por el agente al cerrar las definiciones, reversibles y a confirmar al iterar.

## Problema
Los restaurantes, bares y cafeterías dependen de cartas impresas o PDF que no se actualizan, no muestran bien el producto y no generan ningún vínculo con el cliente. En el salón, el comensal pierde tiempo esperando que el mozo lo vea para pedir algo o la cuenta. Y una vez que se va, el local no tiene forma barata de hacerlo volver.

UcoMenu es una plataforma web **mobile-first**, multi-tenant, vendida por suscripción (SaaS), que le da a cada local una carta digital de alto impacto, un canal directo mesa → mozo y, en el nivel superior, un feed de videos cortos del local y una tarjeta de fidelidad en la billetera del teléfono.

- **Nombre comercial:** UcoMenu. **Dominio:** `ucomenu.com` (elegido pero **todavía no comprado**: falta comprobar disponibilidad y precio; se define antes de imprimir los QR definitivos).
- **Mercado inicial:** Argentina (es-AR). Precios de catálogo en USD; el cobro manual se hace en el equivalente en ARS.

## Usuarios
| Tipo de usuario | Qué necesita | Notas |
| --- | --- | --- |
| **Comensal** | Ver la carta al instante desde el celular, encontrar lo que puede comer, llamar al mozo o pedir la cuenta sin levantar la mano | Anónimo, sin registro ni app. Solo se identifica si se suma al programa de fidelidad |
| **Staff / Mozo** | Atender llamados desde el panel de sala; sumar sellos escaneando pases; mantener platos, precios, stock y mesas | Usuario con login, limitado a su organización. Acceso operativo completo (ver *Roles y permisos*) |
| **Dueño del restaurante** | Todo lo del Staff más sucursales, personal, apariencia, y ver su plan y su facturación | Administrador de su organización (tenant). No ve datos de otras organizaciones |
| **SuperAdmin SaaS** | Dar de alta organizaciones, asignar y suspender planes y add-ons, dar soporte | Equipo de UcoMenu. Toda acción sobre planes queda auditada |

## Propuesta de valor
- **Para el local:** carta siempre actualizada y que vende mejor, salón más ágil, y herramientas de recompra que hoy solo tienen las cadenas grandes; todo sin instalar nada ni comprar hardware.
- **Para el comensal:** escanea y ve la carta en segundos, filtra por su dieta, llama al mozo con un toque.
- **Para UcoMenu:** ingreso recurrente escalonado; cada pilar es un motivo de upgrade.

## Módulos
### 1. Menú digital interactivo (core) — MVP
- Acceso por **QR único por mesa** o por **link directo** de la sucursal.
- Catálogo por categorías, buscador rápido, filtros dietarios (sin TACC, vegano, vegetariano, etc.).
- Detalle de plato con foto, descripción, **variantes** (elección única, p. ej. tamaño) y **adicionales** (elección múltiple con precio).
  - *Hoy:* la carta pública muestra, bajo cada plato, sus grupos de opciones activos ("Elegí 1", "Opcional · hasta 3") con la diferencia de precio de cada opción ("+ $ 600"); el Dueño y el Staff los gestionan en la pantalla del plato. Es solo informativo: el precio del plato es siempre el base. Al tocar el nombre se abre una ficha de detalle con foto, descripción, etiquetas y opciones; al volver se conserva el contexto de la carta.
  - **Buscador y dieta:** búsqueda por nombre y descripción sin distinguir acentos o mayúsculas, combinada con Sin TACC, Vegano y Vegetariano. Solo usa las etiquetas que declara el local en el plato; varias seleccionadas exigen todas, sin deducir unas de otras. Aceptación y evidencia en [la ficha](../agile/cambios/buscador-y-filtros-dietarios.md).
- Disponibilidad por sucursal (marcar un plato como agotado sin borrarlo).
  - Dueño y Staff la gestionan en la pantalla del plato. Agotado permanece visible con su aviso; el resto de las sucursales conserva su estado y no cambia la activación del plato. Aceptación y evidencia en [la ficha](../agile/cambios/disponibilidad-por-sucursal.md).
- Identidad visual del local (logo y colores) sobre un diseño gastronómico de alto impacto.
  - **Idiomas:** la carta pública se ofrece en español, inglés y portugués ([ADR 0023](decisiones/0023-carta-en-varios-idiomas.md)). El Dueño y el Staff escriben las traducciones de categorías, platos, variantes y opciones en `/panel/{slug}/carta/traducciones`; lo que falta se ve en español. El selector aparece en la carta al cargar el primer texto en un idioma, y el comensal entra en el idioma de su navegador si el local lo ofrece. Los textos legales siguen en español. No hay traducción automática.
  - **Presentación:** la carta pública se rediseñó como Bento + Editorial + Cards (índice de categorías en bento, banda de sección pegajosa con el color de su celda, platos como cards con o sin foto, dock de llamado en la carta de mesa). Contexto en [`PRODUCT.md`](../PRODUCT.md) y sistema de diseño en [`DESIGN.md`](../DESIGN.md).
  - **Implementado en local:** el Dueño elige una paleta de contraste comprobado (ocho claras y cuatro oscuras: Oliva, Azul, Vino, Cacao, Cítrico, Mar, Trattoria, Monocromo, Carbón, Medianoche, Bosque y Borgoña), con vista previa de la carta antes de guardar, elige entre tres estilos de carta y puede encender un tema de fecha especial (San Valentín, Navidad, Halloween y otros seis) con una ventana de fechas opcional, y sube o quita el logo desde `/panel/{slug}/apariencia`. Se aplica a la carta de todas las sucursales y a los QR; la configuración predeterminada conserva el diseño actual. Incluida en todos los planes; con la cuenta en solo lectura o suspendida se consulta pero no se edita.
- Es **solo consulta**: no hay pedidos ni pago online desde el menú.

### 2. Llamado al camarero en tiempo real — MVP
- Botón accesible desde el menú con dos acciones: **Llamar al mozo** y **Pedir la cuenta**.
- Solo disponible si se entró por el QR de una mesa (el link directo no identifica mesa).
- **Panel de sala** para el personal: lista en vivo con número de mesa, tipo de llamado y tiempo transcurrido, con alerta sonora y visual; el Staff marca «atendido».
- Anti-spam: cooldown por mesa y un único llamado pendiente por tipo.

### 3. Feed de videos cortos — plan Premium, fase 2
Reemplaza a la realidad aumentada (WebAR), descartada el 2026-10-21 ([ADR 0031](decisiones/0031-feed-de-videos-cortos.md)).
- Un **feed de videos cortos con scroll vertical** (estilo Reels) dentro de la carta pública: el local publica videos del restaurante, del ambiente y de la preparación o presentación de sus platos.
- El comensal los mira deslizando; desde el **QR de una mesa** puede darles **like** y **comentarlos**. Los comentarios se publican solo cuando el local los aprueba.
- Incluido en el plan **Premium** y habilitado por *feature flag* según la suscripción de la organización.
- *Implementado:* el catálogo (`video_feed` y `videos_published` en `plans`, [ficha](../agile/cambios/catalogo-video-feed.md)) y la base y el panel de videos —tabla `menu_videos`, estados, cupo al publicar, borrado en dos pasos y la pantalla `/panel/{slug}/videos` para Dueño y Staff, [ficha](../agile/cambios/videos-del-panel-base.md)—. La subida y el procesamiento con Mux están implementados en local ([ficha](../agile/cambios/videos-mux-parte-b.md)): el navegador sube el archivo directo a Mux y el estado llega por webhook. El **feed vertical en la carta** está implementado y probado en staging ([ficha](../agile/cambios/feed-de-videos.md)): enlace «Ver videos» solo si hay publicados (en la carta de una mesa lleva al feed de esa mesa, que **conserva la barra de llamado al mozo**), un video a la vez, mudo y en bucle, sonido con un botón, y «Ver plato» (nombre, precio y descripción) solo si el plato sigue visible en esa sucursal. Se puede ver también desde el link directo, sin interactuar. Los **likes** están implementados ([ficha](../agile/cambios/likes-del-feed.md)): un corazón con el conteo en cada video; desde la mesa es un botón (da o quita el like, uno por dispositivo y video), y sin mesa solo se ve el conteo (nada si es 0). Falta el comentario desde la mesa.

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
Tres niveles, con **cobro manual** en el MVP: el SuperAdmin activa, cambia y suspende planes y registra los pagos; el pago se acuerda por fuera (transferencia o link de pago). El cobro automático es posterior. **Precios y límites son parametrizables en la base de datos**, no están escritos en el código.

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
| Feed de videos cortos con likes y comentarios | — | — | ✔ (hasta 10 videos publicados) |

- **Feed de videos cortos:** incluido en Premium, con un cupo de **10 videos publicados** (parametrizable en la base). Reemplaza al add-on WebAR (+USD 25/mes, cupo de 15 platos 3D y packs de +10), que se descartó el 2026-10-21 ([ADR 0031](decisiones/0031-feed-de-videos-cortos.md)); hoy no hay ningún add-on a la venta.
- **Período de prueba:** **14 días gratis del plan Básico**, sin tarjeta de crédito. Toda organización nueva arranca con esta prueba a partir de su fecha de alta, sin intervención de nadie. *(Confirmado 2026-10-14.)*
- **Límites:** son techos para *crear* y para *activar* (no se puede superar el tope). Los platos se cuentan solo si están activos (`is_active`): con el tope alcanzado se bloquea tanto crear un plato activo como pasar uno inactivo a activo; pasar un plato de activo a inactivo siempre se permite, para que el local pueda acomodarse a su cupo. Misma regla para sucursales y mesas. *(Confirmado 2026-10-14.)*
- **Cambio de plan:** bajar de plan desactiva funciones pero **no borra datos**; si lo existente supera el nuevo límite, se conserva y solo se bloquea crear más.
- En el MVP se venden **Básico y Pro**. Premium se habilita cuando se entregue lo que incluye (feed de videos en la fase 2, fidelización en la fase 3); venderlo antes solo con el feed sería una decisión comercial aparte.
- **Analítica básica** (platos más vistos, llamados por franja): incluida **desde el plan Pro** (Pro y Premium). **Implementada** (ficha `analitica-basica`, ADR 0022): `/panel/{slug}/analitica`, solo Dueño, con los platos más vistos (aperturas del detalle, contadores por día) y los llamados por hora de los últimos 14 días.

### Mora y suspensión (degradación progresiva)
Se cuenta desde el vencimiento del período pagado (o del fin de la prueba, *Supuesto (nuevo)*):

| Días de mora | Modo | Qué pasa |
| --- | --- | --- |
| 1 a 7 | **Gracia** | Todo funciona al 100%. Aviso al dueño en el panel |
| 8 a 15 | **Solo lectura** | La carta pública sigue visible (no se rompen los QR de las mesas). Se apagan los módulos interactivos: se oculta el botón de llamar al mozo, se apagan los likes, los comentarios y la carga de videos del feed (los videos publicados se siguen viendo) y se pausa la suma de sellos |
| 16 en adelante | **Suspendida** | La carta pública muestra «Carta temporalmente no disponible». Todos los datos se conservan intactos hasta la reactivación |

- El estado se **deriva de las fechas** (vencimiento y fecha actual); registrar un pago extiende el período y restablece todo.
- *Supuesto (nuevo):* en modo solo lectura y suspendida, el panel del dueño sigue accesible con el aviso de mora.
- **Aviso de mora por rol** *(confirmado 2026-10-14)*: el **Dueño** ve el aviso completo (días de atraso, fecha límite de cada etapa y cómo regularizar). El **Staff** ve un aviso **operativo reducido**: solo el estado de la cuenta (pago vencido, solo lectura o suspendida) y «avisale al dueño», **sin plan, montos ni fechas**, para que entienda por qué no puede editar. Lo que el Staff recibe lo decide la base (`org_entitlements` no le devuelve plan ni fechas). Ver ADR 0006 y 0007.
- **Escrituras de catálogo:** en **solo lectura (días 8 a 15) y suspendida (16 en adelante) quedan bloqueadas todas las escrituras de catálogo** (crear, modificar y borrar categorías, platos, precios, sucursales y mesas), tanto para el Dueño como para el Staff. En gracia (días 1 a 7) se edita con normalidad. El local ve su estado y sus datos, pero no puede actualizar precios ni cargar platos hasta regularizar el pago. *(Confirmado 2026-10-14.)*
- **Cuenta de días:** día 1 es el primer día completo después del vencimiento; el día 7 todavía es gracia, el 8 ya es solo lectura, el 15 es el último de solo lectura y el 16 suspende.
- Los datos de suscripción (plan, fechas, add-ons) los escribe **exclusivamente el servidor**, desde las acciones del SuperAdmin.
- **Gestión manual del SuperAdmin** *(hecha, 2026-10-17; ficha `superadmin-planes-pagos.md`; los puntos marcados como supuesto esperan confirmación del usuario)*, en `/admin/organizaciones/{slug}`, siempre con auditoría:
  - **Cambiar plan y ciclo**, con motivo obligatorio. Rige en el acto, sin prorrateo y sin tocar fechas; bajar de plan no borra nada. *(Supuesto: durante la prueba, un plan superior rige sin pago hasta el fin de la prueba.)*
  - **Suspender y reactivar a mano**, con motivo obligatorio. Suspendida a mano equivale a suspendida por mora (carta oculta, panel en solo lectura, datos intactos) aunque las fechas estén al día; el Dueño ve «suspendida por UcoMenu». *(Supuesto: reactivar no agrega tiempo: la cuenta vuelve al estado que digan sus fechas, y registrar un pago no levanta una suspensión manual.)*
  - **Registrar un pago**: importe, moneda (ARS o USD), medio (transferencia, link de pago, efectivo u otro), referencia opcional, fecha del pago y «cubre hasta». Mueve el vencimiento a esa fecha (fin de ese día en Argentina) y, si había mora, restablece la cuenta. El pago queda fijo: no se edita ni se borra. *(Supuesto: «cubre hasta» debe ser posterior al vencimiento actual y a hoy, y a lo sumo a 2 años; un pago adelantado extiende desde el vencimiento actual, nunca lo acorta, y un pago mal cargado se **anula** desde la ficha, con motivo: solo el último pago vigente, el pago queda en el historial como anulado y el vencimiento vuelve al de antes del pago; para corregirlo se registra el correcto — ADR 0024.)*
  - **Prueba de 14 días como concepto aparte**: estado propio (en prueba, vencida, o ya con período propio), con su fecha, distinto de la mora. *(Supuesto: la prueba vencida sigue la misma degradación de mora, contada desde su fin.)*

## MVP
- **Incluye:** menú digital completo (módulo 1), llamado al mozo con panel de sala (módulo 2), panel (módulo 5), SuperAdmin con gestión manual de planes, límites y mora (módulo 6), multi-sucursal, planes Básico y Pro con *feature flags*, prueba gratuita de 14 días.
- **No incluye (fuera de alcance):** feed de videos cortos (fase 2), fidelización y Wallet (fase 3), cobro automático de la suscripción, pedidos y pago desde la mesa, reservas, delivery, integración con sistemas de punto de venta, app nativa, traducción automática de la carta (la carta en varios idiomas existe, pero las traducciones las escribe el local).

## Reglas de negocio clave
### Organización, sucursales y permisos
- Un **tenant es una organización** con una o más **sucursales**. Cada sucursal tiene sus mesas, QR y coordenadas GPS. El personal pertenece al local (la membresía es por organización), pero **cada persona elige qué sucursales mira** —en la sala, el cartel de avisos, el sonido y el aviso del celular—; es una preferencia, no un permiso (ADR 0034).
- La **carta es de la organización** y se comparte entre sucursales (categorías, orden, nombres, fotos, etiquetas y variantes son únicos). Cada sucursal puede ajustar **solo tres cosas por plato**, todas opcionales: **precio propio** (sin precio propio hereda el general; `$ 0` es un precio válido), **agotado** y **oculto** ([ADR 0035](decisiones/0035-carta-central-con-ajustes-por-sucursal.md); [ficha](../agile/cambios/carta-por-sucursal.md)). Un plato oculto no aparece en esa sucursal (listado, búsqueda ni detalle) y una categoría sin platos visibles tampoco; un plato o categoría inactivo no se publica en ninguna. Los ajustes no cambian los topes del plan (un plato activo cuenta una vez, aunque esté oculto en todas) ni los permisos: los escriben el Dueño y el Staff con la cuenta editable.
- Ningún usuario de una organización puede leer ni modificar datos de otra. Es el invariante central del producto.

### Roles y permisos
Solo hay dos roles dentro de una organización; **no existe rol intermedio de encargado**.

| Capacidad | Staff / Mozo | Dueño |
| --- | :---: | :---: |
| Atender llamados en el panel de sala | ✔ | ✔ |
| Escanear pases Wallet y sumar sellos | ✔ | ✔ |
| Gestionar platos, precios, stock (disponibilidad) y mesas | ✔ | ✔ |
| Administrar sucursales, personal y apariencia | — | ✔ |
| Ver plan, facturación y el aviso de mora completo (días de atraso, fechas, cómo regularizar) | — | ✔ |
| Ver el aviso operativo de mora (estado de la cuenta y «avisale al dueño», sin plan, fechas ni montos) | ✔ | ✔ |

- *Supuesto (nuevo):* lo que el Staff **no** puede hacer es lo que no figura en su definición (personal, sucursales, apariencia, plan).
- Cambiar plan, add-ons o estado de la suscripción es **exclusivo del SuperAdmin**; el Dueño solo los ve.
- Como el Staff puede cambiar precios, los **cambios de precio quedan registrados** (quién, cuándo, valor anterior y nuevo), sea Staff o Dueño quien los haga. Confirmado por el usuario el 2026-10-13.
- **Historial de precios** *(ADR 0012)*: lo registra la base ante cada cambio efectivo del precio de un plato (no al crearlo ni al editar otros campos); **Dueño y Staff leen el historial de su organización** *(confirmado por el usuario el 2026-10-14)*, nadie lo modifica ni lo borra desde la aplicación. Un cambio hecho sin usuario (operación técnica) se registra sin autor. **Pantalla** *(hecha, 2026-10-14)*: `/panel/{slug}/historial-de-precios` (todo el local, desde un botón en la carta) y `/panel/{slug}/carta/platos/{id}/historial` (un plato); del más nuevo al más viejo, 50 por página; se abre también con la cuenta en solo lectura o suspendida. Muestra plato, «precio anterior → nuevo» con «Sube/Baja», fecha y hora de Argentina y quién: el **Dueño ve el email** de quien sigue en el local; el **Staff** solo «Vos» u «Otra persona del equipo»; quien ya no está en el local, «Persona que ya no está en el local» (nunca su email); un cambio técnico, «Operación técnica (sin usuario)»; un plato eliminado, «Plato eliminado» (decisión del usuario, ficha `pantalla-historial-de-precios.md`).

### Menú
- El comensal solo ve categorías y platos **activos**; un plato agotado en la sucursal se muestra como no disponible, no desaparece.
- Las etiquetas dietarias las declara el local. La carta muestra un aviso de que la información sobre alérgenos es responsabilidad del establecimiento.
- El precio que se muestra es el precio base del plato; variantes y adicionales muestran su diferencia de precio. La diferencia de una opción es siempre mayor o igual a cero (sin descuentos por opción) y, por ahora, no deja historial como el precio del plato.
- **Gestión de la carta** *(Dueño y Staff; ADR 0008)*: categorías y platos se crean, editan, reordenan (subir/bajar) y se activan o desactivan; también se **borran para siempre** *(ADR 0029; pendiente de aprobación)*: el plato desde su pantalla y la categoría desde su cabecera, en dos pasos, y una categoría con platos pide escribir su nombre; borrar un plato quita su foto, variantes, adicionales y disponibilidad, y el historial de precios se conserva («Plato eliminado»); con la cuenta en solo lectura o suspendida no se borra. Desactivar sigue siendo la baja reversible. Un plato nuevo y una categoría nueva van al final. Cada plato admite **una foto** (JPG, PNG o WebP, hasta 2 MB; la app la reduce antes de subir). El precio se carga en pesos y se guarda en centavos enteros (hasta $ 10.000.000). Si el plan llegó a su tope de platos activos, activar o crear uno activo se rechaza con el número del tope; se puede crear oculto. Con la cuenta en solo lectura o suspendida la carta se ve pero no se edita, y la pantalla lo explica.

### Mesas y QR
- Cada mesa tiene un QR con un **identificador opaco** (no el número de mesa), de modo que no se pueda adivinar el de otra mesa.
- Se puede **regenerar** el QR de una mesa; el anterior deja de funcionar (da «no encontramos esta carta») y hay que imprimir el nuevo.
- Entrar por link directo muestra la carta completa pero sin las acciones de llamado.
- **Gestión de sucursales** *(solo el Dueño; ficha `gestion-de-sucursales.md`)*: `/panel/{slug}/sucursales` lista, crea y renombra. El identificador de la dirección de la carta (`/m/{local}/{sucursal}`) se elige al crear y el Dueño no lo cambia. El **SuperAdmin puede corregirlo** desde la ficha de la organización, conservando las direcciones anteriores y los QR: [aceptación y evidencia](../agile/cambios/correccion-slug-sucursal.md). Con el tope del plan alcanzado (Básico 1, Pro 2) no se puede crear otra y la pantalla lo explica; en solo lectura o suspendida se ve pero no se modifica. **Todavía no se pueden desactivar ni borrar** sucursales (decisión pendiente en la ficha).
- **Gestión de mesas** *(Dueño y Staff; ADR 0009)*: se agregan de a una por sucursal, con un nombre de hasta 40 caracteres único en la sucursal; se renombran, se activan o desactivan y también se **borran para siempre** *(ADR 0030; pendiente de aprobación)*: en dos pasos, con sus llamados al mozo, y su QR impreso deja de funcionar (404); con la cuenta en solo lectura o suspendida no se borra. Desactivar sigue siendo la pausa reversible. El tope del plan (Básico 20, Pro 50 por sucursal) cuenta las mesas **activas**: con el tope alcanzado no se puede crear una activa ni activar otra (sí desactivar). La hoja imprimible trae una tarjeta por mesa activa (seis por A4) con el QR de `{dirección pública}/t/{token}`; se puede imprimir aunque la cuenta esté en solo lectura o suspendida, pero no se modifican mesas.
- **Qué ve el comensal al escanear:** la carta de la sucursal con el número de mesa. Si la mesa está **desactivada** ve la carta sin número (como el link directo); con la cuenta en **solo lectura** funciona igual; **suspendida**, «Carta temporalmente no disponible»; un QR desconocido o regenerado, «no encontramos esta carta».

### Llamado al mozo
- Requiere plan Pro o superior y suscripción en gracia o activa; si no, el botón no se muestra.
- Por mesa puede haber **como máximo un llamado pendiente de cada tipo**. Reintentar mientras hay uno pendiente no crea otro: se le informa al comensal que ya fue avisado.
- **Cooldown de 60 segundos** entre llamados del mismo tipo desde la misma mesa, configurable por sucursal (pedir la cuenta justo después de llamar al mozo no se bloquea).
- **Desde el QR de la mesa** *(ADR 0010)*: en `/t/{token}` el comensal ve «Llamar al mozo» y «Pedir la cuenta» solo si la mesa está activa y no silenciada, el plan es Pro o superior y la cuenta está al día; si no, no hay botones. La respuesta confirma el envío («Avisamos al personal»), avisa si ya había uno pendiente o cuánto esperar, y no dice por qué un llamado no está disponible (plan, mora o silencio). Por conexión hay un tope de **30 avisos cada 10 minutos** (generoso: el Wi-Fi del local es compartido). El comensal no ve el estado posterior; el personal los atiende desde el panel de sala (ítem siguiente).
- **Ticket de visita** *(ADR 0010, enmienda; ficha `ticket-de-visita.md`)*: al abrir la carta de la mesa el comensal recibe un ticket que vale **3 horas**; pasado ese tiempo (o con la pestaña vieja) los botones dejan de mostrarse y piden «escaneá de nuevo el QR de tu mesa», sin avisar al personal. Recargar la página lo renueva (límite conocido: un QR estático no distingue una recarga de un escaneo). La tarjeta del panel de sala muestra «Escaneó el QR *N* antes del aviso» y, desde 2 horas, «Hace mucho: confirmá que siga en la mesa»; no hay botón de descartar.
- Estados: `pendiente` → `atendido` (lo marca el personal) | `vencido` (automático a los **30 minutos**; se calcula por la antigüedad, sin proceso programado).
- El personal puede **silenciar una mesa** temporalmente ante abuso. **Configuración del llamado** *(hecha, 2026-10-14; ficha `configuracion-del-llamado.md`)*: `/panel/{slug}/llamados` (entrada «Llamados»). **Dueño y Staff** silencian una mesa por 15 minutos, 1, 4 o 24 horas y quitan el silencio; la mesa silenciada no muestra los botones al comensal (y, si alguien fuerza la acción, recibe el mismo «no disponible»); un silencio dura como máximo **24 horas** (lo impone la base). El **Dueño** cambia el **cooldown** de cada sucursal (10 a 3600 segundos, por defecto 60); el Staff lo ve sin poder cambiarlo *(interpretación nuestra: el Staff no administra sucursales)*. Con la cuenta en solo lectura o suspendida se ve pero no se edita; con plan Básico la pantalla avisa que el llamado no está activo.
- El llamado no se pierde si el panel estaba desconectado: al reconectar aparecen todos los pendientes.
- **Panel de sala** *(Staff y Dueño; ADR 0011)*: en `/sala/{slug}` la lista se actualiza sola cada ~3 segundos (no es instantánea; con la pestaña oculta los navegadores la ralentizan). Cada llamado muestra la mesa, el tipo y «hace N»; el que más espera va primero y desde los 5 minutos se marca como urgente. Un llamado nuevo resalta, suma al título de la pestaña y, si el personal activó las alertas con un toque (el navegador no deja sonar sin él), suena y mantiene la pantalla encendida; lo que ya estaba al abrir la pantalla no suena. «Atendido» lo saca de la lista y registra la hora y quién lo atendió; si dos personas lo tocan a la vez, una lo atiende y la otra ve que ya estaba atendido. Sin conexión la pantalla lo avisa, conserva la última lista y se recupera sola al volver. Los pendientes de más de 30 minutos no se muestran. Con plan Básico, o con la cuenta en solo lectura o suspendida, el panel muestra un aviso en lugar de la lista (el Staff sin datos del plan).

### Suscripción
- Qué puede usar una organización lo determinan su plan, sus add-ons y su estado de mora, y se verifica **siempre en el servidor**, nunca solo ocultando botones.
- Cada cambio de plan, add-on, pago o estado queda registrado con quién, cuándo y motivo.

### Feed de videos cortos (fase 2)
Decidido por el usuario el 2026-10-21 ([ADR 0031](decisiones/0031-feed-de-videos-cortos.md)); reemplaza a las reglas de WebAR.
- El feed aparece solo si el plan de la organización es **Premium** y la carta está publicada (cuenta no suspendida). Likes, comentarios y carga exigen además la cuenta en gracia o al día. Todo se verifica en el servidor, no solo ocultando botones.
- **Videos:** hasta **30 segundos** y **50 MB** por archivo subido, en vertical 9:16. No puede haber más de **10 videos publicados** por organización (parametrizable en `plans`); con el tope alcanzado se puede guardar un borrador, pero no publicarlo.
- **Like y comentario solo desde el QR de una mesa**, con el ticket de visita vigente (3 horas, como el llamado); desde el link directo el feed se ve, pero no se interactúa. Un like por dispositivo y video, sin guardar datos del comensal: el navegador guarda, solo al primer «me gusta», un código aleatorio y los videos marcados (la política de privacidad lo dice); el servidor guarda únicamente un resultado de un solo sentido de ese código, sin la mesa ni la IP (un valor derivado de la IP se borra a la hora y solo sirve para limitar abusos: 60 «me gusta» nuevos cada 10 minutos por conexión).
- **Comentarios con aprobación previa:** alias opcional, sin datos personales; quedan pendientes y no se ven en la carta hasta que el local los aprueba.
- *Supuesto (nuevo):* suben, publican y borran videos el **Dueño y el Staff** (como la carta), y los dos moderan los comentarios.
- *Supuesto (nuevo):* un video puede enlazarse a un plato de forma opcional («Ver plato»).
- *Supuesto (nuevo):* en **solo lectura** los videos publicados se siguen viendo, pero se apagan los likes, los comentarios y la carga; en **suspendida** no se ve nada. Bajar de Premium no borra videos ni comentarios: el feed deja de mostrarse.
- *Supuesto (nuevo):* comentarios de hasta 280 caracteres y alias de hasta 30, con un límite de envíos por conexión como el del llamado. La retención de los comentarios rechazados se decide al implementarlos.
- **Almacenamiento y reproducción en Mux Video** ([ADR 0031](decisiones/0031-feed-de-videos-cortos.md)): subida directa desde el panel, conversión automática de formatos de iPhone (`.mov` HEVC) y Android, entrega adaptativa HLS (hasta 1080p) y póster automático, sin consumir almacenamiento ni transferencia de Supabase.

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

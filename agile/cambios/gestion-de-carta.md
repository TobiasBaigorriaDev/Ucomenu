# Cambio: Gestión de carta — categorías y platos con foto, orden y activo/inactivo en el panel
Estado: **hecho** — revisado por Codex (solo lectura, *aprobar* sobre `c191728`, sin defectos bloqueantes; una observación P3 corregida) e integrado a `main` el 2026-10-14
Nivel: M (toca precios y permisos de escritura, pero las reglas de fondo —RLS, mora y topes— ya están en la base y probadas; este ítem agrega una migración aditiva y una superficie de archivos, por eso incluye pruebas de base y mutaciones)

## Objetivo
Que el Dueño y el Staff mantengan la carta desde el panel sin tocar la base: crear y editar categorías y platos (nombre, descripción, precio, categoría, **foto**), **ordenarlos** y **activarlos/desactivarlos**, viendo con claridad cuándo el plan alcanzó su tope de platos activos y cuándo la cuenta no permite escribir (solo lectura o suspendida). Desbloquea «Variantes y adicionales», «Historial de precios» y «Mesas y QR» (que reutiliza el patrón).

## Decisiones (derivadas de `docs/producto.md`, `docs/arquitectura.md` y ADR 0005/0006; revisables)
1. **Quién:** Dueño **y** Staff gestionan platos y precios (`producto.md`, *Roles y permisos*). Nada de esto es exclusivo del Dueño.
2. **Rutas:** `/panel/{slug}/carta` (categorías y platos, alta/edición de categorías en la misma pantalla) y `/panel/{slug}/carta/platos/nuevo` · `/panel/{slug}/carta/platos/{id}` (formulario de plato con foto). Entrada «Carta» en la navegación del panel para ambos roles. Cada página y cada acción exigen `requireMembership` (el layout no se re-ejecuta).
3. **Escribir con el cliente de la persona (RLS), nunca con `service_role`.** La autorización de fondo sigue en la base: membresía, `org_can_write` y tope de platos activos (`53400`). La app no la reemplaza: **la muestra**.
4. **Un `UPDATE`/`DELETE` bloqueado afecta 0 filas sin error** (riesgo ya registrado): todas las acciones piden de vuelta las filas afectadas (`.select()`); 0 filas = «no se pudo guardar» con el motivo según `org_entitlements` (solo lectura/suspendida), nunca un éxito falso. Además la UI deshabilita los formularios con el motivo cuando `can_write = false`.
5. **Tope de platos activos (`53400`, `limit_exceeded:active_products`):** al crear un plato activo o activar uno inactivo, el error se traduce a «Llegaste al tope de N platos activos de tu plan. Desactivá un plato para activar este.» (N sale de `org_entitlements.limits`, no del texto del error). En la cabecera de la carta se ve «Platos activos: X de N» (o «sin tope»). El Staff ve «X de N» del tope operativo pero **no** el nombre del plan (la base ya se lo oculta).
6. **Orden:** `sort_order` entero, con botones **Subir / Bajar** (accesibles, sin arrastrar; sirven en celular). La acción relee la lista tal como la ve el público (orden, luego nombre), reubica el elemento y **renumera** los afectados (0, 1, 2…) para que dos elementos con el mismo número no dejen el orden indeterminado. Lo nuevo se agrega **al final**. Categorías: orden dentro de la organización; platos: dentro de su categoría.
7. **Activo/inactivo** es el mecanismo de baja: **no hay borrado** de categorías ni platos en este ítem (el borrado en cascada de una categoría se llevaría sus platos y deja fotos huérfanas; se registra como ítem aparte). Desactivar siempre se permite; activar respeta el tope. Una categoría inactiva oculta sus platos al público (regla ya existente en RLS); la pantalla lo avisa.
8. **Precio:** se escribe en pesos (`2800`, `2.800`, `2800,50`) y se guarda en **centavos enteros**; se rechaza vacío, negativo, más de 2 decimales, texto y valores sobre `$ 10.000.000` (`price_cents` es un `integer` de 32 bits: el tope es mucho menor que su límite). Nunca punto flotante en el medio (se parsea el texto, no se multiplica un `float`). El historial de precios es un ítem aparte (S, ya aprobado en `producto.md`).
9. **Validación de textos:** nombre 1–80 caracteres (sin espacios sobrantes), descripción 0–300; se muestran con los valores conservados tras un error.
10. **Foto — Supabase Storage** (como dice `arquitectura.md`): bucket **público** `product-images` (la carta pública es pública; la URL es opaca), tipos JPEG/PNG/WebP, **2 MB** como tope del archivo. Ruta `{organization_id}/{product_id}/{uuid}.{ext}`. La columna nueva `products.image_path` guarda **solo la ruta**; la URL pública se arma en el servidor.
    - **Reducción en el navegador antes de subir:** una foto de celular pesa 3–8 MB. Un componente de cliente la redimensiona (lado mayor 1600 px, JPEG ~0,85, respetando la orientación EXIF) sin dependencias nuevas (Canvas). Si no se puede reducir y supera 2 MB, el error lo explica.
    - **El servidor no confía en el navegador:** valida tamaño y **tipo por los bytes** (firma JPEG/PNG/WebP), no por el `Content-Type` ni la extensión; la extensión sale de la firma.
    - **Límite de cuerpo de las server actions:** sube de 1 MB (por defecto) a **3 MB** (`experimental.serverActions.bodySizeLimit`) para esta superficie; el tope real de la foto lo aplican el bucket y el servidor.
    - **Reemplazar o quitar la foto:** se sube el archivo nuevo con nombre nuevo, se actualiza `image_path` y recién entonces se borra el anterior (si falla la actualización se borra el nuevo: no quedan huérfanos por el camino normal; si falla el borrado, se registra en el log del servidor con la ruta).
    - **Autorización en Storage:** políticas sobre `storage.objects` del bucket: escribir/borrar solo si la **primera carpeta es una organización de la que la persona es miembro** y `org_can_write` (en solo lectura y suspendida no se suben ni se borran fotos, igual que el resto del catálogo). La lectura es pública por ser bucket público.
    - **`image_path` solo puede apuntar a la carpeta de la propia organización** (`check` en la base), para que nadie haga mostrar en su carta un archivo ajeno.
    - **Vista:** `next/image` con `unoptimized` por ahora (el optimizador de Next bloquea orígenes locales y la optimización/caché es el ítem «Rendimiento de la carta pública»); tamaños fijos para no mover el diseño.
11. **Carta pública:** muestra la foto del plato si la tiene (miniatura con alto fijo, `loading="lazy"`, `alt` con el nombre del plato). Diseño gastronómico definitivo queda para su ítem.
12. **Entorno local:** `pnpm db:start` hoy excluye `storage-api`; se lo quita de la lista (la imagen ya está descargada y `storage.enabled = true` ya está en `config.toml`). El bucket y sus políticas van **en una migración** para que existan igual en cualquier entorno. No se instala nada nuevo.

## Comportamiento y aceptación
**Categorías**
- [x] Dado el Dueño o el Staff en `/panel/{slug}/carta`, cuando crea una categoría con nombre válido, entonces aparece al final de la lista y en la carta pública si tiene al menos un plato activo.
- [x] Renombrar, activar/desactivar y subir/bajar categorías persisten y se ven en el panel y en la carta pública en ese orden; con nombre vacío o de más de 80 caracteres se muestra el error y se conserva lo escrito.
- [x] Una categoría inactiva muestra «No se ve en la carta» y sus platos no aparecen en la carta pública.

**Platos**
- [x] Crear un plato (nombre, descripción, precio, categoría) lo deja activo al final de su categoría; el precio `2.800,50` se guarda como 280050 centavos y se ve igual en la carta.
- [x] Editar nombre, descripción, precio y categoría persiste; mover a otra categoría de la misma organización funciona y a una categoría de otra organización (campo manipulado) es rechazado.
- [x] Subir/Bajar cambia el orden de los platos dentro de la categoría y el orden público; en el primero «Subir» y en el último «Bajar» están deshabilitados.
- [x] Precio inválido (vacío, negativo, `abc`, 3 decimales, enorme) → error claro, nada se guarda.

**Foto**
- [x] Subir una foto JPEG/PNG/WebP la muestra en el panel y en la carta pública; reemplazarla borra el archivo anterior; quitarla deja el plato sin foto y borra el archivo.
- [x] Una foto de celular grande (varios MB) se reduce en el navegador y se sube; un archivo que no es imagen (aunque se llame `.jpg`) o un archivo de más de 2 MB que no se puede reducir se rechaza con un mensaje claro y el plato no cambia.
- [x] Nadie puede subir ni borrar archivos en la carpeta de otra organización ni apuntar `image_path` a ella (por la API, no solo por la UI).

**Tope del plan y cuenta bloqueada**
- [x] Con el tope de platos activos alcanzado, crear un plato activo y activar uno inactivo muestran el mensaje del tope con el número correcto; desactivar sigue permitido; editar un plato ya activo no consume cupo.
- [x] En **solo lectura** y **suspendida**: la carta se puede ver pero los formularios y botones de edición están deshabilitados con el motivo («Tu cuenta está en solo lectura: no se puede editar la carta hasta regularizar el pago» / suspendida), y una acción forzada (formulario manipulado) responde con ese mismo motivo y **no** muestra un éxito falso. Staff y Dueño ven lo mismo (el Staff, sin plan ni fechas).
- [x] En **gracia** se edita con normalidad.

**Permisos y aislamiento**
- [x] El Staff puede hacer todo lo anterior; un usuario de otro local recibe 404 en `/panel/{slug}/carta…`; sin sesión redirige al login con la ruta completa.
- [x] Un id de plato o categoría de **otra organización** en la URL o en un campo oculto responde 404/«no encontrado» y no modifica nada.

## Alcance / fuera de alcance
- Incluye: migración (`products.image_path` con su `check`, bucket `product-images` y políticas de `storage.objects`, permisos por columna); `db:start` con Storage; `next.config.ts` (límite del cuerpo); módulo `src/lib/carta` (validación, precio, orden, traducción de errores, firmas de imagen, subida) con pruebas unitarias; páginas y acciones de `/panel/{slug}/carta`; componente de reducción de fotos; foto en la carta pública; pruebas de base, E2E y mutaciones; actualización de `docs/producto.md`/`arquitectura.md` si cambian, ADR si la decisión de Storage lo amerita; tablero y handoff.
- No incluye: **borrado** de categorías y platos (hecho después: [borrado de categorías y platos](borrado-de-categorias-y-platos.md)); variantes y adicionales; etiquetas dietarias; disponibilidad por sucursal ni «agotado»; historial de precios; arrastrar y soltar; edición en lote o importación; optimización/caché de imágenes y medición de rendimiento; recorte o editor de fotos; modelos 3D; diseño gastronómico definitivo; múltiples fotos por plato.

## Dependencias y riesgos
- **Dinero:** el precio es dato sensible de negocio y el Staff lo cambia sin historial hasta que exista `price_history` (decisión ya registrada en `producto.md`: ítem S siguiente). Riesgo aceptado y declarado.
- **Escritura silenciosamente bloqueada:** si una acción olvida chequear las filas afectadas, el local cree que guardó. Cubierto por la decisión 4, por pruebas E2E con la cuenta en solo lectura y por mutaciones.
- **Storage como superficie nueva:** políticas mal escritas permiten subir a otra organización o llenar el almacenamiento. Cubierto por pruebas de base (miembro, staff, ajeno, anónimo, mora) y por mutaciones de cada defensa. Sin cuota por organización en este ítem: el tope es de 2 MB por archivo y la baja frecuencia de cambios; una cuota de almacenamiento por plan queda como riesgo registrado.
- **Archivos huérfanos:** quedan acotados al caso de fallas a mitad de camino; no hay limpieza automática (ítem posterior si hiciera falta).
- **El bucket es público:** cualquiera con la URL ve la foto. Aceptable (es la foto de la carta pública); URL con UUID no adivinable. Las fotos de una organización suspendida siguen accesibles por URL directa (no hay forma barata de ocultarlas); el plato desaparece de la carta, la foto no se enlaza. Se registra.
- **Concurrencia en el orden:** dos personas reordenando a la vez pueden pisarse; gana la última escritura y la renumeración deja la lista consistente. Aceptado.
- **Límite de cuerpo de 3 MB** en todas las server actions: solo agranda el tope de petición; las acciones siguen exigiendo sesión y rol.
- **Windows/OneDrive:** ruta larga del repo; nada nuevo. Las pruebas de Storage necesitan que `storage-api` esté arriba (`pnpm db:stop` + `pnpm db:start` tras el cambio del script).

## Evidencias de verificación
Ejecutadas el 2026-10-14 sobre una base recién reseteada (`pnpm db:reset`, migración `20261014025124_product_images.sql`) y con el build hecho sobre el código final:
- `pnpm typecheck` OK · `pnpm lint` OK · `pnpm build` OK.
- `pnpm test` **89/89** (46 nuevas en `src/lib/carta/carta.test.ts`: precio, textos, ids, orden e imágenes por firma).
- `pnpm test:rls` **257/257** en 9 archivos (226 → 257; la última prueba cubre la observación de Codex): `images` (14: subir, listar, borrar y `image_path` con Dueño, Staff, otra organización, anónimo, rutas mal formadas, tipos y tamaño del bucket, upsert, gracia/solo lectura/suspendida) y `carta` (17: el módulo de datos con usuarios reales: categorías y platos, precio en centavos, orden con números repetidos, tope `53400`, cuenta bloqueada **sin falsos éxitos** —incluida una comprobación de estado desactualizada simulada—, una persona con dos locales, fotos y compensación y borrado de Storage con cero objetos). `acl` ajustada (función nueva en la matriz).
- `pnpm test:e2e` **64/64** (46 previas + 18 de la carta a 390 px), tres corridas completas seguidas OK: alta de categorías y platos, orden y activo/inactivo reflejados en la carta pública, edición y cambio de categoría, validaciones con lo escrito conservado, Staff, foto (subir, ver en panel y en la carta pública, reemplazar y quitar sin huérfanos), foto de celular grande reducida en el navegador, foto de 1 a 1,5 MB, foto pesada que no se puede reducir, archivo falso `.jpg`, tope de 80 platos, solo lectura y suspendida con Dueño y Staff (controles deshabilitados + acción forzada sin éxito falso + nada cambia en la base ni en Storage), gracia, 404 para otro local y plato ajeno y formularios manipulados.
- **Mutaciones: 34 defensas rotas de a una, 32 detectadas y 2 equivalentes** (la 34.ª es la de la observación de Codex: quitar el chequeo de «cero objetos borrados»). Módulo (16 de 17): 0 filas sin chequear (x2), `53400` sin traducir, consultas sin acotar a la organización (x3), tipo de imagen sin verificar, JPEG no reconocido, foto anterior sin borrar, sin compensación, `guard` abierto, decimales, orden (x3), ruta propia. Base (9 de 10): subir y borrar sin `org_can_write`, subir sin membresía (x2), leer sin membresía, sin `check` de `image_path`, bucket sin tope de tamaño, sin tipos permitidos y privado. Aplicación (6 de 6): página que siempre permite escribir, foto sin reducir, sin límite de cuerpo ampliado, acción que informa éxito aunque falle, botones y formulario que ignoran `canWrite`.
  - *Equivalentes:* (1) quitar `categoryBelongs` en `updateProduct`: la clave foránea compuesta de la base rechaza la categoría ajena con el mismo resultado (defensa en profundidad); (2) quitar la membresía de la política de **borrado** de Storage: PostgreSQL aplica también la política de lectura (que sí la exige) a un `DELETE … WHERE`, así que el resultado no cambia.
- Revisión visual a 390 px (capturas de la carta, edición con foto, alta, solo lectura y carta pública con foto): identidad mantenida, objetivos táctiles de 44 px, sin desborde horizontal; los controles bloqueados se ven apagados y el aviso lo explica.
- Sin residuos tras las corridas: 0 organizaciones `tt-*`/`e2e-*`, 0 usuarios `e2e-*`/`rls-*` y 0 archivos en Storage (se limpiaron a mano los de corridas interrumpidas y tres usuarios `rls-fuga-otra-org-*`, ver aprendizajes).

Pendientes (no ejecutado):
- ~~Revisión de un segundo agente~~ **Hecha (Codex, 2026-10-14): aprobar `c191728`.** Sin defectos bloqueantes de permisos, aislamiento, precios o límites. Observación **P3** (no bloqueante): `removeObject` comprobaba `error` pero no los objetos borrados, así que un `remove` descartado por RLS (0 objetos, sin error) dejaba una foto huérfana sin registrar. **Corregida:** ahora también se registra ese caso; prueba nueva en `carta.rls.test.ts`.
- `pnpm dev` de punta a punta con un navegador real; Safari/iOS y cámara del celular (la reducción con Canvas y `createImageBitmap` se probó en Chromium); fotos HEIC de iPhone; lector de pantalla; contraste medido con herramienta; rendimiento de la carta con fotos (ítem «Rendimiento de la carta pública»).
- Verificar en Supabase Cloud que el bucket `product-images` quedó público y con sus límites tras aplicar la migración (checklist de «Salida a producción»).

## Aprendizajes / cambios de decisión
- **`storage-api` estaba excluido de `pnpm db:start`.** Se lo quitó de la lista (la imagen ya estaba descargada y `storage.enabled = true` ya estaba en `config.toml`); hay que `pnpm db:stop` y `pnpm db:start` una vez. El bucket y las políticas van en la migración (`insert into storage.buckets … on conflict` funciona con `db reset`).
- **`storage.remove()` bloqueado por RLS devuelve 0 objetos sin error**, la misma trampa que un `UPDATE`/`DELETE` de tablas: las pruebas comprueban la cantidad devuelta y que el archivo siga existiendo.
- **El precio máximo no es el del tipo de la columna:** la ficha decía «$ 99.999.999,99», pero `price_cents` es `integer` (máx. 2.147.483.647 centavos ≈ $ 21,4 M). Se fijó $ 10.000.000.
- **Un plato nuevo no puede traer foto en el mismo paso:** el nombre del archivo lleva el id del plato, que genera la base. Se crea el plato y la acción redirige a su pantalla para sumar la foto.
- **El límite de cuerpo de las *server actions* es de 1 MB por defecto** y una foto de 1 a 1,5 MB (que la app sube sin reducir) lo superaba: se subió a 3 MB y hay una prueba con ese caso (la mutación que lo quita se detecta).
- **El aviso «Foto lista» seguía visible después de guardar** en la primera versión (el formulario se limpia pero el estado local no): quedó atado al resultado de la acción.
- **La matriz de funciones de `acl.rls.test.ts`** exige declarar toda función nueva de `private`: se agregó `product_image_org`.
- **Playwright:** el tiempo máximo por prueba subió de 30 s a 60 s; la prueba larga de personal (preexistente) lo superaba con las pruebas de fotos corriendo en paralelo. Un *worker* de Playwright murió una vez con `0xC0000409` (la misma inestabilidad de Windows ya registrada para Vitest) y pasó al repetir.
- **Fuga preexistente en `limits.rls.test.ts`:** `afterAll` borra al único Dueño de una organización antes que la organización y la guarda del último Dueño lo frena, así que queda un usuario `rls-fuga-otra-org-*` por corrida. Está fuera de este ítem y no se corrigió; se limpió a mano.
- La carta pública se renderiza en cada pedido (ruta dinámica), por eso un cambio del panel se ve sin invalidar nada.
- **Revisión de Codex (P3):** el chequeo de `error` no alcanza para Storage: un borrado descartado por RLS vuelve sin error y con cero objetos. Ya lo sabíamos para los `UPDATE`/`DELETE` de tablas y para las pruebas, pero faltaba en el código de limpieza.

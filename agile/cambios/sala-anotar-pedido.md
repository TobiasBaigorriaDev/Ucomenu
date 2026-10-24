# Cambio: Pantalla «Anotar» en la Sala (anotar un plato con sus opciones)
> **Nota posterior:** la ficha [operar el pedido](sala-operar-pedido.md) movió la carta a una hoja que se abre desde «Anotar plato» (barra fija abajo). Las reglas de esta ficha siguen igual; la disposición de la decisión 1 es la anterior.

Estado: **implementado, aprobado por el usuario (2026-10-24, tras probarlo en local) y desplegado en staging (Fly versión 47)**; falta probarlo con sesión real en staging. No hay migración. Quinta pieza de S3 «Pedidos del mozo» ([ADR 0041](../../docs/decisiones/0041-pedidos-del-mozo.md), decisiones 1 y 2), primera mitad del ítem «Anotar y operar pedidos desde la Sala»; la segunda (estados, cancelar, cerrar y anular) es la ficha siguiente.
Nivel: **M** — solo agrega una pantalla sobre `add_order_item`, ya revisada (C) y en staging: el precio, las opciones, los mínimos y máximos y la autorización los decide la base. La pantalla no calcula nada que se cobre, no cambia esquema, permisos ni dinero. Sin revisión independiente por defecto.

## Objetivo
Que el mozo, desde «Mesas», abra una mesa y **anote lo que el cliente le dicta**: elige el plato, la cantidad, sus variantes y adicionales y una observación, y lo anotado aparece en el pedido de la mesa.

## Decisiones (particulares)
1. **Una página por mesa:** `/sala/{slug}/mesas/{mesa}/anotar`, con un botón «Anotar pedido» («Ver pedido y anotar» si ya hay uno) en cada tarjeta de «Mesas». Arriba, el pedido abierto de la mesa (líneas con opciones, observación y estado, total); abajo, la carta de **la sucursal de esa mesa** con buscador.
2. **Carta de la sucursal, con el cliente de la persona (RLS):** solo categorías y platos activos; sin lo **oculto** en esa sucursal; lo **agotado** se ve pero no se puede tocar; el precio es el de la sucursal (o el base) y, si hay promoción en curso, se muestra el de lista tachado. Es una **vista previa**: lo que se cobra lo calcula `add_order_item`. `effective_prices` con el plato nulo devuelve **solo los platos con promoción**; el resto sale del precio de la sucursal (error de suposición que detectó la prueba RLS).
3. **Panel del plato (`<dialog>` modal, hoja inferior a 390 px):** cantidad 1 a 99, un grupo por `fieldset` (opción única con botones de radio, múltiple con casillas y tope al llegar al máximo; un grupo opcional de una sola opción lleva «Ninguna»), observación de una línea (≤ 200) y el botón «Anotar · $ X» con el total previsto. **No se puede anotar** con un mínimo sin cumplir (el botón queda deshabilitado y dice qué falta). Las mismas reglas de la base se repiten solo para guiar; la base valida de nuevo.
4. **Plato imposible de anotar:** un grupo activo cuyo mínimo supera sus opciones activas (o sin opciones con mínimo ≥ 1) hace que la base rechace siempre (`options_required`); la pantalla lo marca «No se puede anotar…» en lugar de ofrecer un botón que nunca funciona.
5. **Acción del servidor `addOrderItemAction(slug, entrada)`:** vuelve a exigir sesión y membresía; **valida la forma** de la entrada (uuid, cantidad entera 1 a 99, ≤ 50 opciones sin repetir, nota válida); la **sucursal sale de la mesa**, no del navegador; llama a `add_order_item` con el cliente de la persona; traduce las excepciones conocidas a mensajes en español y nunca toma un error desconocido por éxito.
6. **Reintento seguro:** cada panel genera su `clientKey` (uuid); si se pierde la respuesta, volver a tocar «Anotar» sin cambiar nada devuelve la línea ya anotada («Ya estaba anotado») en vez de duplicarla. Si cambió algo con la misma clave, la base responde `client_key_reused` y se le dice que revise el pedido.
7. **Carta que cambió:** si la base rechaza por plato no disponible u opciones que cambiaron, la pantalla lo dice y recarga la carta. Al volver a la pestaña se recarga el pedido y la carta (no hay copia local del pedido: el servidor es la fuente; no hay sondeo en esta pantalla).
8. **Sin la función `orders`** (Básico sin vista previa, solo lectura o suspendida): aviso con el mismo tono de «Mesas», sin carta. Mesa de otro local, inactiva, de sucursal dada de baja o id que no es uuid: 404.

## Aceptación
- [x] Desde «Mesas» se abre la mesa; la pantalla muestra el pedido abierto (o que no hay nada) y la carta de su sucursal.
- [x] Lo oculto en la sucursal no aparece; lo agotado se ve y no se puede tocar; el precio propio de la sucursal y la promoción en curso se reflejan.
- [x] Un plato con variante obligatoria no se anota sin elegir (dice qué falta); con adicionales hasta el tope; la cantidad y la observación se guardan; la línea aparece en el pedido con sus opciones, nota, estado y el total, y en «Mesas».
- [x] Cerrar el panel no anota nada; un plato sin opciones se anota de una vez; otro plato suma al mismo pedido.
- [x] Perder la respuesta y reintentar no duplica (una sola fila); si la carta cambió, lo dice y no anota.
- [x] Básico: aviso sin carta; mesa de otro local o id inválido: 404; sin sesión: login.
- [x] A 390 px, sin desborde horizontal, con los estados legibles en texto (no solo color).

## Fuera de alcance
- **Cambiar estados, modificar cantidad u observación, cancelar líneas, cerrar y anular pedidos** (ficha siguiente); precuenta y retención (ficha de cierre); analítica; Realtime o sondeo en esta pantalla; elegir una mesa nueva sin pasar por «Mesas».

## Evidencia
Sin migración; base local con las migraciones existentes, 2026-10-24, sobre `be1f2b5` + el diff de este cambio:
- `src/lib/sala/anotar.test.ts` (nuevo): **16/16**; con `mesas.test` y `sala.test`: **48/48**. Reglas de elección, vista previa, nota, forma de la entrada, mapa de errores y búsqueda sin tildes.
- `tests/rls/sala-anotar.rls.test.ts` (nuevo) **9/9** con las **sesiones** de Dueño y Staff: carta de la sucursal (activos, oculto, agotado, precio propio, promoción), grupos y opciones (inactivos fuera, mínimo imposible bloquea), mesa ajena/inactiva/sucursal de baja, Básico, y las líneas del pedido (opciones copiadas, nota, cancelada visible, cerrado y anulado no se listan, otra organización).
- `e2e/sala-anotar.spec.ts` (nueva) **6/6** a 390 px (sin desborde): el flujo completo con variante, adicionales con tope, cantidad y observación (comprueba en la base `unit_price_cents`, `options_cents` y `note`), cerrar sin anotar, reintento tras perder la respuesta (la respuesta se descarta con `route.fetch` + `abort`, una sola fila), carta que cambió, Básico, 404 y login. Con `sala-mesas` y `sala-push`: **36/36**.
- **Defectos propios que encontró la prueba:** (a) `effective_prices` sin plato devuelve solo los promocionados: la carta salía vacía; (b) las opciones copiadas se ordenaban con `Date.parse` (milisegundos) y empataban: ahora se compara el texto de la fecha (microsegundos).
- Capturas a 390 px revisadas (carta, panel con opciones, pedido anotado).
- `pnpm typecheck` y `pnpm lint`: limpios. `pnpm test`: 1029 de 1030; la única falla es `textos.test.ts` («Menufeed»), ajena. `pnpm build` correcto con la ruta nueva. `sala.spec`: 26 de 27; falla `sala.spec:323` (intermitente conocida, «Route is already handled»); corrida junto con otros tres archivos fallaron 11 de `sala.spec` por carga, y sola pasan salvo esa.
- **No corrido:** mutaciones (el cambio no toca dinero ni permisos: lo decide la base, ya mutada en la ficha de opciones), suite RLS y E2E completas, lector de pantalla, teléfono real, staging.

- **Despliegue (2026-10-24, aprobado por el usuario):** commit `1b217a4` en `origin/main`; `flyctl deploy -c fly.staging.toml --local-only --depot=false` con los cuatro argumentos públicos; **Fly v47** (`started`, control `1 passing`, máquina `78177dda131e38`). HTTP sin sesión: `/login` y `/m/la-bestia/centro` **200**; `/sala/…/mesas/{mesa}/anotar` **307** al login. Sin migración ni secretos tocados. No se probó con sesión real (los demos no tienen Dueño).

## Notas de diseño
- La pantalla pone el pedido arriba y la carta debajo: con muchas líneas hay que desplazarse hasta la carta. Se puede mejorar en la ficha siguiente (acceso rápido «Anotar un plato», o carta fija) cuando se sepa cómo opera el mozo.

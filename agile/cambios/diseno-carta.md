# Cambio: Diseño gastronómico de la carta pública — dirección editorial (primera entrega visual)
Estado: **integrada a `main`** (squash merge, 2026-10-14; aprobada por Codex en solo lectura sobre `223a461`; sin subir a GitHub todavía). Dirección editorial elegida por el usuario, verificada con `main` fusionado (llamado, historial de precios y panel de sala): 151 unitarias, 370 de RLS y 121 E2E dos veces seguidas
Nivel: M (solo presentación: sin dinero, datos, permisos ni esquema; varias piezas visuales que comparten un contrato con las pruebas E2E existentes)

## Base, ramas y aislamiento
- Worktree `../UcoMenu-carta`. Sale de `main` en `da20ffd` (gestión de carta y mesas/QR). El 2026-10-14 se fusionó `main` en `26bbd64` (merge `eac7779`: «Llamado desde la mesa», historial de precios y panel de sala) para probar la carta junto con la barra del llamado. Solo hubo conflicto de documentación (`agile/ahora.md`); ninguno de código.
- **Dirección elegida: editorial** → rama `feat/diseno-carta-editorial` (`2462357` + el cierre documental). Es la rama que se integra.
- **Variante A (alternativa histórica, NO se integra):** «tarjetas cálidas con azulejos», rama `feat/diseno-carta` en `fd238d8` (también marcada con la etiqueta local `alt/carta-variante-a-tarjetas`). Se descartó antes de aprobarla porque se sentía vacía. La rama editorial se creó a partir de ella, así que su historial incluye `80bbe70`, `738df48` y `fd238d8` como pasos intermedios: **al integrar conviene un *squash merge*** para no llevar a `main` esos commits provisionales. Se decide con el usuario al integrar.
- Se toca `src/components/menu/` (y un CSS nuevo acotado a la carta) y, por el solapamiento con el llamado, **solo estilos y montaje** en `src/app/t/[token]/`: `page.tsx` pasa la barra del llamado a la vista como `callBar` y `call-bar.tsx` cambia de colores y forma de los botones (su lógica, textos, roles y `data-testid` no cambian). Ni `globals.css`, ni el panel, la sala, la base, `supabase/`, `tests/rls/` ni `src/lib/`.

## Objetivo
Que el comensal que abre la carta desde el celular (por `/m/{org}/{sucursal}` o por el QR de la mesa, `/t/{token}`) vea una carta apetecible, con personalidad y fácil de recorrer: cabecera con el local, un mosaico de categorías para saltar a cada sección, platos en una lista elegante y precios legibles, con las fotos de los platos cuando existen y un buen aspecto cuando no, también en pantallas grandes.

## Dirección visual: editorial gastronómica
Inspirada en una referencia aportada por el usuario (`docs/referencias/HUMM-MENU.png`, **sin versionar y de un tercero: no se commitea**) — mosaico de categorías, lista de platos sin tarjetas, serif pesada y colores cálidos —, sin copiarla:
- **Paleta propia** acotada a `.carta` (variables CSS en `carta.css`): crema `#f4efe4`, tinta cálida `#2a2622`, verde profundo `#3d5f48`, terracota `#b4492a`, rosa pálido `#f3d2c6` y arena `#e8dcc2`. Contrastes calculados: tinta/crema 13,1 · texto secundario/crema 5,7 · verde/crema 6,3 · terracota/crema 4,7 (precios) · blanco/verde 7,2 · blanco/terracota 5,4 · tinta/rosa 10,6.
- **Tipografía:** Young Serif (ya cargada) para el nombre del local, categorías y platos; Hanken Grotesk para el resto; chips en versalitas con espaciado.
- **Mosaico de categorías:** la foto del primer plato de la categoría que tenga foto, o un bloque de color (rosa, verde, arena, terracota, alternados). La forma de cada mosaico sale de `mosaicLayout()` (`mosaic.ts`, con prueba): bloques A (dos chicos), B (uno ancho) y C (uno alto + dos chicos) que siempre completan sus filas, sin huecos.
- **Lista de platos sin tarjetas:** nombre en serif, precio en terracota a la derecha, descripción debajo, filete fino entre platos, columnas balanceadas en pantallas anchas. Miniatura de 80/96 px **solo si la categoría tiene alguna foto** (entonces todos los platos reservan su miniatura, con un marcador neutro si falta); sin fotos en la categoría, lista de solo texto.
- **Nada inventado:** sin fotos de stock, reseñas, calificaciones, etiquetas, «destacados», frases de bienvenida ni datos comerciales que no estén en la base. «N platos» por categoría es un dato real.
- **Decoración mínima:** cuadraditos girados sobre el título y sobre el pie (confeti) y la barrita de rombos bajo cada título de categoría.

## Navegación (decisión de diseño que conserva el contrato)
Hay **dos** navegaciones con etiquetas distintas:
- **Mosaico**, `nav` «Categorías de la carta»: la navegación principal, primera en el DOM, así el primer *Tab* cae en su primer enlace (lo que ya comprueban las E2E).
- **Barra fija de chips**, `nav` «Cambiar de categoría»: aparece cuando el mosaico ya quedó arriba de la pantalla, marca la categoría que se lee (`aria-current`) y es `inert` mientras está oculta. No ocupa lugar en el flujo.
La etiqueta de la barra **no contiene** «Categorías de la carta» (los selectores de Playwright comparan por subcadena).

## Contrato que no cambia (lo cubren `e2e/menu.spec.ts`, `e2e/mesas.spec.ts` y `e2e/carta.spec.ts`)
`h1` = nombre del local · texto «Sucursal {nombre}» · `h2` = solo categorías, `h3` = solo platos, en el orden de la base · precio formateado es-AR en un elemento propio · `nav` «Categorías de la carta» con un enlace por categoría y el primer *Tab* cae en el primero · `data-testid="mesa"` con exactamente la etiqueta, y solo si hay mesa activa · imagen con `alt="Foto de {plato}"` (en las miniaturas) · sin desborde horizontal · lo inactivo y lo de otras organizaciones no aparece · «Carta temporalmente no disponible» y el aviso de alérgenos conservan su texto. `PublicMenuView` conserva sus props (`menu`, `tableLabel`).

## Comportamiento y aceptación
**Cabecera**
- [x] Muestra el nombre del local (grande y centrado, sin cortarse con nombres largos o sin espacios), «Sucursal X» y, solo con mesa activa, «Mesa N» como etiqueta destacada (también con etiquetas largas).
**Mosaico y navegación**
- [x] Un enlace por categoría, en 2 columnas y sin huecos para cualquier cantidad (prueba unitaria de 1 a 30); mezcla fotos y bloques de color; un nombre largo agranda su fila en lugar de recortarse.
- [x] Tocar un mosaico lleva a la sección con el título a la vista bajo la barra; al pasar el mosaico aparece la barra fija con la categoría visible marcada (relleno verde, no solo color) y centrada; cada chip mide al menos 44 px de alto; el primer *Tab* cae en el primer mosaico.
**Platos**
- [x] Lista con nombre, precio y descripción; miniaturas parejas dentro de la categoría; si una foto no carga, la miniatura pasa al marcador neutro.
- [x] El precio nunca se parte (`$ 10.000.000` junto a un nombre largo a 360 px: si no entran los dos, el precio baja a su línea); nombre largo o sin espacios (100+ caracteres) y descripción larga sin desbordar ni recortarse.
- [x] El orden de los platos es el de la base (columnas balanceadas: se leen de arriba abajo; el DOM conserva el orden).
**Pantallas y accesibilidad**
- [x] 360, 390, 768 y 1280 px: sin scroll horizontal (con datos reales y con el arnés; 768 px revisado tras la integración).
- [x] Foco visible (verde en la barra; terracota con contorno en el mosaico), `prefers-reduced-motion` respetado (el zoom de la foto del mosaico y las transiciones solo con movimiento permitido), selección de texto acorde a la paleta.
**Estados**
- [x] Carta sin platos y «no disponible» conservan su texto y usan el mismo lenguaje visual.
**Aislamiento**
- [x] `git diff $(git merge-base main HEAD) --stat` (contra el punto de partida de la rama, no contra `main`, que avanza): antes de fusionar `main` solo mostraba `src/components/menu/*`, esta ficha, `agile/ahora.md` y `agile/tablero.md`; tras fusionarlo, además `src/app/t/[token]/page.tsx` y `call-bar.tsx` (solo montaje y estilos, ver arriba). `globals.css` intacto.
**Con el llamado (`/t/{token}` con mesa de plan Pro)**
- [x] La barra fija «Llamar al mozo» / «Pedir la cuenta» se monta **dentro** de `.carta` (prop `callBar` de `PublicMenuView`): hereda la paleta (botón principal verde `#3d5f48` con texto blanco, contraste 7,2; el secundario con contorno verde sobre crema), sus botones miden 48 px (≥ 44) y el fondo crema llega hasta el borde inferior, sin la franja gris que dejaba `pb-32` fuera de `.carta`.
- [x] Espacio reservado `pb-40` (160 px) solo cuando hay barra: con el mensaje de error (la barra más alta, ~122 px a 390 px) el pie de alérgenos queda libre. Sin barra (`/m/…`, mesa Básica o inactiva) la carta no cambia.
- [x] Barra de categorías (arriba, `z-10`) y del llamado (abajo, `z-20`) conviven a 390 y 768 px sin taparse; la del llamado queda centrada en `max-w-xl` también en escritorio (decisión: se deja centrada).

## Alcance / fuera de alcance
- Incluye: cabecera, mosaico, barra fija, sección y lista de platos, estados vacío y no disponible, pie con el aviso de alérgenos; `carta.css` (todo bajo `.carta`); `mosaic.ts` y su prueba.
- **No incluye (pendiente):** que el Dueño elija **variantes de la temática** (paleta u otro estilo), logo y colores del local — requieren columnas en `organizations`, permisos y posiblemente tope por plan; la paleta ya vive en variables CSS bajo `.carta`, lo que lo deja preparado. Se recomendó hacerlo en un incremento aparte, con variantes cerradas (no color libre) y contraste verificado por prueba. Tampoco: detalle de plato, variantes y adicionales, buscador y filtros, disponibilidad por sucursal, modo oscuro, optimización de imágenes (ítem «Rendimiento de la carta pública»; las fotos siguen `unoptimized`), cambios en llamados, sala, panel, auth, RLS, migraciones o esquema.

## Dependencias y riesgos
- **Solapamiento con «Llamado desde la mesa»: resuelto en la integración.** Antes de fusionar se preveía tocar `src/app/t/[token]/page.tsx` (envoltorio `pb-32`) y que la barra azul cobalto no combinara con la paleta. Resuelto montando la barra dentro de `.carta` (ver «Con el llamado»). Riesgo restante: cualquier cambio futuro de la barra del llamado hereda la paleta de la carta; si la carta pasa a tener paleta por local, la barra la seguirá.
- **Contraste del título sobre fotos reales:** el título de un mosaico con foto va en blanco sobre un degradado oscuro (65 % arriba); con fotos muy claras podría quedar justo. Con la demo (ilustraciones claras) se leyó bien; no se pudo verificar con fotos reales.
- Sin fotos en la base local (los platos de ejemplo no tienen). Los estados con foto se revisaron con un arnés temporal **no versionado** (datos ficticios, sin tocar la base). Fotos reales, Safari/iOS y lector de pantalla no se pueden verificar en este entorno.
- Las fotos que sube el local son de proporción libre (hasta 1600 px de lado): se recortan (`object-cover`).

## Evidencias de verificación
- Pruebas ejecutadas sobre la dirección editorial (worktree `UcoMenu-carta`, 2026-10-14):
  - `pnpm lint` OK · `pnpm typecheck` OK · `pnpm test` **111/111** (107 previas + 4 de `mosaicLayout`; con `NEXT_PUBLIC_SITE_URL` sin definir, ver nota) · `pnpm build` OK.
  - Detector de Impeccable (`impeccable detect --json src/components/menu`): sin hallazgos.
  - **Datos reales** (`next dev` en el puerto 3001 contra la base local, **solo lecturas**): `/t/c0ffee01…` «Mesa 1», `/t/c0ffee03…` mesa inactiva sin etiqueta, `/t/dead0001…` cuenta suspendida, `/m/cafe-ejemplo/centro`, `/m/parrilla-demo/sur`, `/m/resto-moroso/unica` (suspendida) y tokens o carta inexistentes → 404. En `/t/c0ffee01…`: h1, «Sucursal Centro», `data-testid="mesa"` = «Mesa 1», h2 = [Cafetería, Pastelería], h3 = [Espresso, Flat white, Medialuna de manteca], precios `$ 2.800`, `$ 4.200`, `$ 1.500`, ambas `nav` con su etiqueta, primer *Tab* en el primer mosaico, barra fija `inert` al inicio, `noindex` y `no-referrer`, aviso de alérgenos, sin desborde (390 px).
  - **Arnés ficticio** (`next start` en el puerto 3002, 360/390/1280 px): 6 categorías con fotos, mixto (fotos y bloques de color) y sin fotos; nombre de local de 80 caracteres, etiqueta de mesa larga, categoría de 58 caracteres, plato de 100+ caracteres, palabra de 100+ caracteres sin espacios, `$ 10.000.000` y `$ 2.350,50` sin cortarse, descripción de 400 caracteres, foto inexistente que degrada al marcador, hash en la URL al abrir (con la animación de scroll termina con el título a 80 px).
- **Integración con `main` (2026-10-14, merge `eac7779`, base compartida reseteada con `pnpm db:reset` desde este worktree; `NEXT_PUBLIC_SITE_URL` sin definir):**
  - `pnpm typecheck` OK · `pnpm lint` OK · `pnpm test` **151/151** (12 archivos; 147 de `main` + 4 de `mosaic.test.ts`) · `pnpm build` OK.
  - `pnpm test:rls` **370/370** (15 archivos) en la segunda corrida; en la primera un *worker* de Vitest murió con `0xC0000409` en `limits.rls.test.ts` (358 de 370 corridas; inestabilidad conocida de Windows, no un fallo de prueba).
  - `pnpm test:e2e` (`menu`, `carta`, `mesas`, `llamados`, `sala`, acceso, etc.): **121/121 en dos corridas completas seguidas**, tras `pnpm build`. Antes se hicieron otras dos corridas que no cuentan: una cortada por una caída de *worker* de Playwright (89 pasadas) y otra con 120/121 y la caída de *worker* (`0xC0000409`, en `acceso.spec.ts`, ajena a la carta). **Ninguna prueba se modificó**: el diseño nuevo no rompió ningún selector ni texto de las E2E, y la barra del llamado no tapa ni deja de funcionar.
  - Revisión visual con el arnés (barra del llamado real montada en la vista) a 390 y 768 px, con fotos y sin fotos, con y sin mensaje de error en la barra: sin desborde horizontal, fondo crema hasta abajo, pie libre sobre la barra, botones de 48 px y colores de la paleta.
  - Limpieza: sin organizaciones `e2e-*`/`tt-*` residuales; se borró el usuario `rls-fuga-otra-org-*` que deja `limits.rls.test.ts` (preexistente).
- Pendientes / no ejecutados:
  - La carta y la barra del llamado en un **teléfono real** (iOS/Android, Safari), el escaneo real de un QR impreso, fotos reales (el contraste del título sobre fotos muy claras), lector de pantalla, impresión y rendimiento medido.
  - Segunda revisión (Codex, solo lectura) no pedida.
  - El arnés temporal `src/app/zz-preview/` y `public/` (no versionados) siguen en el worktree hasta que el usuario termine la revisión visual.
- Nota de entorno: el *shell* del usuario tiene `NEXT_PUBLIC_SITE_URL=http://192.168.100.94:3000` (de la prueba del QR con el celular); con esa variable, 2 pruebas de `mesas.test.ts` (URL base del QR) fallan en cualquier rama. No es un defecto del código: correr `pnpm test` con la variable sin definir.

## Aprendizajes / cambios de decisión
- `impeccable context` informó que no hay `PRODUCT.md` ni `DESIGN.md`: se trató como refinamiento sobre el código vigente y se deja pendiente `/impeccable init` / `document` para el usuario.
- **Historia del diseño:** (1) primer diseño con banda cobalto y azulejos (`80bbe70`); (2) el usuario lo sintió raro (columnas con nombres «al costado» y «debajo» de la foto) y pidió más minimalismo y una foto por producto; (3) variante A, tarjetas cálidas (`fd238d8`): «le falta alma»; (4) el usuario aportó una referencia editorial y **eligió la editorial** (`2462357`).
- Una grilla de tarjetas mezcladas con filas sin foto dejaba huecos y desalineaba nombres; la dirección editorial lo evita con listas pareja por categoría (miniatura para todos o para ninguno).
- La barra fija es `fixed` y `inert` mientras está oculta (no `sticky` oculta con `display:none`): así no mueve el contenido al aparecer y no roba el primer *Tab*.
- `.tile-band` y `.leader` de `globals.css` los usan el login y el panel: la carta tiene sus propios estilos en `carta.css`. `categoryAnchor` vive en `anchors.ts` porque la barra pasó a ser un componente de cliente.
- El foco global (`:focus-visible`) usa `--cobalt`: dentro de `.carta` esa variable vale el verde de la paleta.
- Al capturar páginas con scroll animado (`scroll-behavior: smooth` global) la captura puede salir a mitad de camino: para revisar, esperar a que asiente o desactivarlo en la sesión de revisión.

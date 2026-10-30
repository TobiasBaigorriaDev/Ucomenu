# Cambio: Estilo de carta «Hoja»

Estado: **commit `d73231e` en `origin/main` y en staging (Fly v76; la migración se aplicó con v75).** Falta la aprobación visual del usuario en un teléfono real y elegir Hoja con una sesión real en staging.
Nivel: **M** (amplía el conjunto cerrado de `menu_layout`; sin cambios de permisos, datos de clientes ni dinero). Antecedente: [estilo Afiche](estilo-afiche.md).

## Objetivo y decisiones

Quinto estilo (`menu_layout = 'hoja'`): la carta como **la página de un PDF** que se abre en el celular. Referencias del usuario: Patio Parque y Paloma Bakery House. Dos intentos descartados antes de este: una lista de columnas responsiva (demasiado «carta normal») y una versión con bandas de color y letra de 15 px.

- **Página de ancho fijo (560 px) que no se reacomoda:** `SheetFit` (cliente) la escala con `zoom` para que entre entera en el ancho de la pantalla (≈0,65 en un celular de 390 px; tope 1,6 en escritorio) y la persona **amplía con los dedos y se desplaza**, como en un visor de PDF. El viewport no bloquea el zoom. Sin JavaScript queda a tamaño real con desplazamiento lateral; hasta medir el ancho la página está oculta (`opacity: 0`) para que no salte (un `noscript` la muestra).
- **Aspecto de visor:** fondo gris (mezcla de la tinta con el fondo, vale en paletas claras y oscuras), hoja del color de fondo con sombra, barra superior oscura con el nombre del local (único `h1`), sucursal, mesa y «Pellizcá para ampliar» (solo bajo `md`; textos en es/en/pt). El título grande del local y el logo viven dentro de la hoja, decorativos (`aria-hidden`).
- **Contenido:** 2 columnas fijas (CSS `columns`; el usuario prefirió dos aunque la hoja quede larga), filete discontinuo entre ellas, filas y títulos sin partirse. Título `/// CATEGORÍA` en el acento con filete fino. Cada plato: nombre en negrita 12 px y precio a la derecha, descripción y variantes a 11 px.
- **Sin fotos de plato** aunque tengan `image_path` (el detalle sí las muestra).
- **Datos vivos:** promoción (lista tachada + precio promocional + línea de la promoción), agotado (nombre tachado y atenuado + etiqueta en línea), siglas `GF`/`V`/`VG` con leyenda al pie (y nombre completo para lectores de pantalla), variantes en una línea por grupo (hasta 5 opciones y «+N más»).
- **Variantes:** el modelo solo guarda la diferencia sobre el precio base, así que se muestra «+ $», no precios absolutos como «Simple $6000 / Doble $9500».
- **Dock de la mesa con el zoom de pellizco** (`/t/{token}`: llamar al mozo, videos, pedir la cuenta): un elemento `fixed` se ancla al viewport de diseño y no sigue el zoom. En «Hoja», `followVisualViewport` (`zoom-dock.ts`) lee `window.visualViewport` y, mientras hay zoom, lleva el dock a la esquina inferior del viewport visible y lo contra-escala (`scale(1/z)`), así conserva su tamaño y su lugar. Sin zoom no toca nada, y los otros estilos no lo usan. La altura reservada (`--call-bar-height`) ahora se mide con `offsetHeight` para que no la altere esa escala. Elegido por el usuario entre dos opciones (la otra: acciones en la barra del visor).
- **Las filas no se tocan:** no hay detalle de plato (decisión del usuario), así que este estilo tampoco registra vistas en `/api/vista-plato`. **Sin buscador, filtros ni barra de categorías** (decisión del usuario: «como un lector de PDF»): solo la barra del visor y la página. Las siglas dietarias, la leyenda y el aviso de alérgenos del pie siguen; el comensal recorre la hoja con zoom y desplazamiento.

## Aceptación

- [x] El Dueño elige «Hoja» en Apariencia, con vista previa, y se guarda; otros locales no cambian.
- [x] La carta pública no renderiza ninguna imagen de plato en la hoja.
- [x] Conserva variantes, promociones, agotados y siglas dietarias; no lleva búsqueda, filtros, barra de categorías ni detalle de plato.
- [x] Sin desborde horizontal a 390 y 1280 px; la hoja entra entera en el ancho y se puede ampliar.
- [ ] Revisión visual del usuario en teléfono real (letra de 11–12 px sobre una hoja a ≈0,65: es a propósito, el comensal hace zoom).

## Evidencia (árbol sin confirmar sobre `5c4afde`)

- `tsc --noEmit` y `eslint` (carta, apariencia, identidad, e2e): sin errores. `pnpm test src/components/menu`: 28 de 28 (nuevo `sheet.test.ts`, incluye `sheetScale`).
- Migración `20261211100000_estilo_hoja.sql` aplicada en local con `supabase migration up`; `pnpm test:rls identidad`: 10 de 10 (recorre `LAYOUT_KEYS`). `pnpm db:types` no cambia (columna `text`).
- `pnpm build` y `pnpm exec playwright test e2e/identidad.spec.ts`: 6 de 6 (suma el recorrido de Hoja: guardar, columnas, cero imágenes, detalle, sin desborde).
- Revisión visual con «Aurelia» local a 390 y 1280 px (vuelta a `minimal` al terminar).
- No corrido: promoción vigente a la vista en la hoja (el seed local no tiene una; sale del mismo `DishPrice`), staging, revisión de Codex (no exigida en M).
- Contrapartida aceptada: sin buscador ni filtro por dieta, en una carta muy larga hay que recorrer la hoja a mano. `zoom` CSS: Chrome, Safari y Firefox ≥126. No probado con pellizco en un teléfono real (solo escala inicial y clic en la fila).
- **Staging (2026-10-30):** `supabase db push --dry-run` sobre `ucomenu-staging` mostró solo `20261211100000`; `db push` la aplicó y un nuevo `--dry-run` confirma que está al día. App desplegada desde una copia limpia de `65b7b85` (`git archive`) con `flyctl deploy -c fly.staging.toml --local-only --depot=false --image-label hoja-65b7b85-git` y los cuatro argumentos públicos: **Fly v75 `complete`**, máquina `78177dda131e38` sana, imagen `registry.fly.io/ucomenu-staging:hoja-65b7b85-git`. `/`, `/m/aurelia/centro` y `/login` 200, local inexistente 404; el CSS servido incluye `sheet-paper`.
- Marcha atrás de la app: `flyctl deploy -c fly.staging.toml --image registry.fly.io/ucomenu-staging:deployment-01M679ZYMKJSMAQXCDNVTQ2KTV` (v74). La migración es aditiva; revertirla exige antes pasar a otro estilo a los locales que tengan `hoja`.
- Suite completa antes de integrar: `tsc` y `eslint` sin errores, `pnpm test` 1230 de 1230, `identidad.spec` 6 de 6 (un worker caído `0xC0000409` en `carta.spec` se repitió y pasó). No corrido: prueba con sesión real en staging eligiendo Hoja.
- **Dock con zoom (2026-10-30):** `zoom-dock.test.ts` (3 de 3, la matemática de la posición). Prueba en el navegador con zoom de pellizco simulado por CDP (`Emulation.setPageScaleFactor` 2,5) sobre `/t/{token}` de Aurelia en Hoja: el dock queda en el mismo rectángulo de pantalla que sin zoom (abajo, ancho completo, 92 px de alto), sigue igual al desplazarse y al volver a zoom 1 se limpian los estilos. `pnpm build`, `llamados.spec` e `identidad.spec`: 26 de 26. No probado en un iPhone o Android reales (el comportamiento de `visualViewport` varía entre navegadores).
- **Staging, segunda entrega (2026-10-30):** app desplegada desde una copia limpia de `d73231e` (`git archive`), mismo comando y argumentos públicos que la v75: **Fly v76 `complete`**, máquina `78177dda131e38` sana, imagen `registry.fly.io/ucomenu-staging:hoja-d73231e-git`; `/`, `/m/aurelia/centro` y `/login` responden 200. Antes de desplegar: `tsc` sin errores y `pnpm test` 1233 de 1233. Marcha atrás: `--image registry.fly.io/ucomenu-staging:hoja-65b7b85-git` (v75).

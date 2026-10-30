# Cambio: Estilo de carta «Hoja»

Estado: **implementado en local, sin commit ni despliegue.** Falta la aprobación visual del usuario en un teléfono real.
Nivel: **M** (amplía el conjunto cerrado de `menu_layout`; sin cambios de permisos, datos de clientes ni dinero). Antecedente: [estilo Afiche](estilo-afiche.md).

## Objetivo y decisiones

Quinto estilo (`menu_layout = 'hoja'`): la carta como **la página de un PDF** que se abre en el celular. Referencias del usuario: Patio Parque y Paloma Bakery House. Dos intentos descartados antes de este: una lista de columnas responsiva (demasiado «carta normal») y una versión con bandas de color y letra de 15 px.

- **Página de ancho fijo (560 px) que no se reacomoda:** `SheetFit` (cliente) la escala con `zoom` para que entre entera en el ancho de la pantalla (≈0,65 en un celular de 390 px; tope 1,6 en escritorio) y la persona **amplía con los dedos y se desplaza**, como en un visor de PDF. El viewport no bloquea el zoom. Sin JavaScript queda a tamaño real con desplazamiento lateral; hasta medir el ancho la página está oculta (`opacity: 0`) para que no salte (un `noscript` la muestra).
- **Aspecto de visor:** fondo gris (mezcla de la tinta con el fondo, vale en paletas claras y oscuras), hoja del color de fondo con sombra, barra superior oscura con el nombre del local (único `h1`), sucursal, mesa y «Pellizcá para ampliar» (solo bajo `md`; textos en es/en/pt). El título grande del local y el logo viven dentro de la hoja, decorativos (`aria-hidden`).
- **Contenido:** 2 columnas fijas (CSS `columns`; el usuario prefirió dos aunque la hoja quede larga), filete discontinuo entre ellas, filas y títulos sin partirse. Título `/// CATEGORÍA` en el acento con filete fino. Cada plato: nombre en negrita 12 px y precio a la derecha, descripción y variantes a 11 px.
- **Sin fotos de plato** aunque tengan `image_path` (el detalle sí las muestra).
- **Datos vivos:** promoción (lista tachada + precio promocional + línea de la promoción), agotado (nombre tachado y atenuado + etiqueta en línea), siglas `GF`/`V`/`VG` con leyenda al pie (y nombre completo para lectores de pantalla), variantes en una línea por grupo (hasta 5 opciones y «+N más»).
- **Variantes:** el modelo solo guarda la diferencia sobre el precio base, así que se muestra «+ $», no precios absolutos como «Simple $6000 / Doble $9500».
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

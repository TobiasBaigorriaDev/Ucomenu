# Cambio: Estilo de carta «Afiche»

Estado: **Implementado y verificado en local, sin commit.** Falta la aprobación del usuario, el commit y aplicar la migración en staging (requiere aprobación).
Nivel: **M** (amplía el conjunto cerrado de `menu_layout` y la presentación; sin cambios de permisos, datos de clientes ni dinero). Antecedente: [personalización de la carta](personalizacion-carta.md).

## Objetivo y decisiones

Cuarto estilo de carta para bares, hamburgueserías, cervecerías y pizzerías: afiche gastronómico, títulos condensados enormes, platos numerados, filetes gruesos y bloques de color.

- **Tipografía (aprobada por el usuario, 2026-10-23):** Big Shoulders (Google, `next/font`, variable) para títulos, nombres y números; Schibsted Grotesk para ingredientes, etiquetas y precios. Se declara con `preload: false`: los locales con otro estilo no descargan el archivo. Descartadas: Anton, Archivo extra condensada y Schibsted 900.
- **Mientras carga la fuente:** `next/font` no trae métricas para Big Shoulders. `carta.css` define `AficheFallback` (sans negrita del sistema al 70 %, 0,482 em por mayúscula contra 0,497), con `swap`: el título se lee desde el primer instante, con las mismas líneas y sin desborde. Se probó `display: block` y se descartó porque dejaba los títulos en blanco hasta ~3 s.
- **Color (aprobado):** encabezado en bloque lleno del acento; cada categoría abre con una banda llena que rota los cuatro tonos (`toneFor`, el mismo ciclo del bento); platos sobre el fondo con filetes de tinta de 3 px. Solo roles de la paleta, así que valen las 12 paletas (contraste AA ya probado por par).
- **Títulos que llenan el ancho:** `posterFontSize` calcula el tamaño en `cqi` con el ancho medido de cada letra de Big Shoulders 800 y reparte las palabras en líneas parejas (hasta 3) antes de bajar del mínimo; la palabra más larga siempre entra. Topes: categorías de 2,5 a 13 rem, nombre del local de 3 a 10 rem (llenan ~93 % a 390 y a 1440 px).
- **Numeración decorativa:** `01`, `02`… por categoría, calculada sobre la carta sin filtrar (`dishNumbers`): al buscar o filtrar, cada plato conserva su número. No se guarda ni cambia el orden.
- **Fila del plato:** número | nombre | precio en la primera línea (el precio siempre arriba a la derecha); debajo, promoción, «Agotado», ingredientes, etiquetas y opciones completas a todo el ancho (sus «+ $» caen en la columna del precio). Filete de 3 px entre filas y de 6 px al cerrar la categoría. Con foto: recorte apaisado (3:2, 2:1 desde `sm`) que encabeza la fila, sin esquinas ni quitar el fondo. Toda la fila es un botón que abre el detalle.
- **Piezas compartidas en esquinas rectas** (chips, buscador, barra fija, dock de llamado, detalle) mediante clases gancho (`carta-chip`, `carta-dock`, `carta-dock-cell`, `carta-dialog-photo`) y reglas `[data-layout="afiche"]` en `carta.css` que solo tocan forma y letra, nunca color.
- Sin mosaico: la barra fija de categorías hace de índice (como clásica y minimal).
- De paso: la vista previa de `/apariencia` decía «Sucursal Sucursal Centro».

## Aceptación

- [x] El Dueño elige «Afiche» en Apariencia, con vista previa, y se guarda (`menu_layout = 'afiche'`); otros locales no cambian.
- [x] La carta pública en `/m` y `/t` muestra encabezado en bloque, bandas por categoría con el título del ancho disponible, platos numerados y precio en posición fija.
- [x] Conserva búsqueda, filtros, barra de categorías, detalle, variantes, adicionales, promociones, agotados y dock de la mesa.
- [x] Funciona con y sin fotos, con paletas claras y oscuras, y sin desborde a 390 y 1440 px.

## Evidencia (árbol sin confirmar sobre `8b7cca7`)

- `pnpm test`: 1001 de 1002; la única falla es `textos.test.ts` («Menufeed»), previa y ajena. Nuevas: `poster.test.ts` (tamaño de títulos y numeración estable al filtrar). `tsc --noEmit` y `pnpm lint`: sin errores. `pnpm build`: correcto.
- `pnpm test:rls identidad`: 10 de 10 (recorre `LAYOUT_KEYS`, incluido `afiche`; el `check` rechaza valores fuera de la lista).
- E2E (`--workers=3`): identidad, menu, carta, buscador, detalle-plato, opciones, promociones, llamados, rendimiento-carta e idiomas: 100 de 100. `identidad.spec` suma el recorrido del afiche (guardar, fuente, numeración, detalle, sin desborde a 390 px).
- Migración `20261125100000_estilo_afiche.sql` aplicada en local con `supabase migration up` (sin `db:reset`). `pnpm db:types` no cambia (la columna es `text`).
- Revisión visual con un local sintético de prueba («La Birrería del Puerto», solo en la base local, fotos generadas): Trattoria a 390 y 1440 px, Carbón a 390 px con el detalle abierto; títulos al 93 % del ancho, número y nombre alineados en todas las filas.
- Revisión de diseño (revisor de Impeccable, dos rondas sobre capturas del build de producción): corregidos el relleno de títulos en escritorio, el foco recto, la alineación de los adicionales, DESIGN.md y la carga de la fuente. Re-corridas tras las correcciones: unitarias de `menu` 20/20, `tsc` y lint limpios, E2E identidad, menu, llamados, buscador, detalle-plato y rendimiento-carta en verde.
- **Abierto (decide el usuario):** a 390 px las etiquetas del dock de la mesa («Llamar al mozo», «Pedir la cuenta») parten en dos líneas. Viene de antes y es igual en los cuatro estilos (`call-bar.tsx`, compartido): no se tocó.
- Datos de prueba: «La Birrería del Puerto» (`birra-demo`, mesa `afc0ffee000000000000000000000004`) queda en la base local; sus fotos sintéticas dicen «SINTÃ‰TICA» (texto mal codificado al generarlas). Se borra con `pnpm db:reset`.
- No corrido: staging, revisión independiente de Codex (no exigida en M).

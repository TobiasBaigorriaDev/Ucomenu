---
name: UcoMenu, carta pública
description: Una revista de bolsillo en bento, impresa en el papel y los colores de cada local.
colors:
  porcelain: "#f4efe4"
  ink: "#2a2622"
  muted: "#655d52"
  carta-green: "#3d5f48"
  carta-green-deep: "#2f4a39"
  carta-terra: "#a43f22"
  carta-blush: "#f3d2c6"
  carta-sand: "#e8dcc2"
typography:
  display-title:
    fontFamily: "Gloock, Georgia, serif"
    fontSize: "clamp(3.25rem, 0.75rem + 14vw, 6rem)"
    fontWeight: 400
    lineHeight: 0.95
    letterSpacing: "-0.015em"
  display-title-logo:
    fontFamily: "Gloock, Georgia, serif"
    fontSize: "clamp(2.5rem, 0.5rem + 11vw, 5rem)"
    fontWeight: 400
    lineHeight: 0.95
    letterSpacing: "-0.015em"
  section:
    fontFamily: "Gloock, Georgia, serif"
    fontSize: "2rem"
    fontWeight: 400
    lineHeight: 1
  tile-name:
    fontFamily: "Gloock, Georgia, serif"
    fontSize: "1.5rem"
    fontWeight: 400
    lineHeight: 1.05
  dish-name:
    fontFamily: "Gloock, Georgia, serif"
    fontSize: "1.3125rem"
    fontWeight: 400
    lineHeight: 1.05
  body:
    fontFamily: "Schibsted Grotesk, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.625
  price:
    fontFamily: "Schibsted Grotesk, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
  label:
    fontFamily: "Schibsted Grotesk, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    letterSpacing: "0.08em"
rounded:
  input: "8px"
  dialog: "12px"
  band: "16px"
  cell: "24px"
  dock: "28px"
  pill: "9999px"
spacing:
  gap: "12px"
  gap-wide: "16px"
  gutter: "16px"
  gutter-wide: "24px"
  section: "56px"
  section-wide: "80px"
components:
  category-tile:
    backgroundColor: "{colors.carta-blush}"
    textColor: "{colors.ink}"
    rounded: "{rounded.cell}"
    padding: "16px"
  section-band:
    backgroundColor: "{colors.carta-green}"
    textColor: "#ffffff"
    rounded: "{rounded.band}"
    padding: "10px 16px"
  dish-card:
    backgroundColor: "{colors.porcelain}"
    textColor: "{colors.ink}"
    rounded: "{rounded.cell}"
    padding: "16px"
  dish-card-sin-foto:
    backgroundColor: "{colors.carta-sand}"
    textColor: "{colors.ink}"
    rounded: "{rounded.cell}"
    padding: "16px"
  chip-category:
    backgroundColor: "{colors.carta-blush}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "44px"
  chip-category-activo:
    backgroundColor: "{colors.carta-green}"
    textColor: "#ffffff"
  chip-dieta:
    textColor: "{colors.carta-green}"
    rounded: "{rounded.pill}"
    height: "44px"
  chip-dieta-activo:
    backgroundColor: "{colors.carta-green}"
    textColor: "#ffffff"
  mesa-pastilla:
    backgroundColor: "{colors.carta-green}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "6px 16px"
  dock-llamar:
    backgroundColor: "{colors.carta-green}"
    textColor: "#ffffff"
    rounded: "{rounded.cell}"
    height: "56px"
  dock-cuenta:
    backgroundColor: "{colors.carta-blush}"
    textColor: "{colors.ink}"
    rounded: "{rounded.cell}"
    height: "56px"
  buscador:
    textColor: "{colors.ink}"
    rounded: "{rounded.input}"
    height: "48px"
  ficha-detalle:
    backgroundColor: "{colors.porcelain}"
    textColor: "{colors.ink}"
    rounded: "{rounded.dialog}"
    padding: "20px"
---

# Design System: UcoMenu, carta pública

Alcance: este documento describe solo la carta pública (`/m/{org}/{sucursal}` y `/t/{token}`), todo lo que cuelga de `.carta` (`src/components/menu/carta.css`). Los tokens de `src/app/globals.css` (Young Serif, Hanken Grotesk, azul cobalto) pertenecen al panel, la sala y el login; la carta los sobrescribe únicamente dentro de `.carta` y no los hereda como identidad. Los valores de la paleta de arriba son los de Oliva, la paleta por defecto; cada local elige una de cuatro y los mismos roles cambian de valor.

## Overview

**Creative North Star: "La revista de bolsillo del local"**

La carta se lee como un número de revista armado en celdas: una cabecera editorial con el nombre del local en display grande, un índice de categorías en bento y, debajo, secciones con banda de color y cards de plato de escala variable. El local es el protagonista; la plataforma firma discretamente al pie («Hecho con UcoMenu»). Papel cálido, tinta oscura, un verde profundo como voz principal y terracota solo para precios y detalles.

La densidad es de escaneo rápido a una mano (390 px, mesa con poca luz): objetivos táctiles de 44 px o más, texto base de 14 a 16 px, nombres de plato en display. La profundidad se logra con color de celda y filetes finos, no con sombras. Voseo es-AR en todo el texto.

**Key Characteristics:**
- Colores solo desde los ocho roles de la paleta del local; nunca un hex fijo en un componente (salvo blanco sobre verde y terracota, y el negro de los degradados sobre foto).
- Gloock en un único peso para todo lo que es título; Schibsted Grotesk para todo lo demás.
- Celdas de radio generoso (24 px) con filete `ink/15` en vez de sombra.
- Número de índice de categoría («01», «02») repetido en la celda del bento y en la banda de su sección.
- Funciona con y sin fotos y con y sin logo.

## Colors

Papel cálido y tinta, con un acento verde profundo, un rosa y una arena como celdas, y una terracota reservada. Los ocho roles son variables CSS que `paletteStyle()` (`src/lib/identidad/palettes.ts`) escribe en el elemento `.carta`; el contraste AA de cada par se prueba en `palettes.test.ts`.

### Primary
- **Verde del local** (`--carta-green`, #3d5f48 en Oliva): título del local, celdas y bandas verdes, chip activo, pastilla de mesa, botón «Llamar al mozo», enlaces, foco. Con texto blanco encima.
- **Verde profundo** (`--carta-green-deep`, #2f4a39): fondo de las celdas de categoría con foto mientras carga, bajo el degradado.

### Secondary
- **Terracota** (`--carta-terra`, #a43f22 en Oliva; era #b4492a hasta la revisión final de contraste): precios, diferencias de opciones, ícono de sucursal, celdas terracota, anillo de foco de celdas y cards. Con blanco encima en celdas.

### Tertiary
- **Rosa pálido** (`--carta-blush`, #f3d2c6): celdas y bandas rosa, chips de categoría en reposo, botón «Pedir la cuenta». Tinta encima.
- **Arena** (`--carta-sand`, #e8dcc2): celdas y bandas arena (con filete), fondo de cards sin foto y de marcadores de foto. Tinta encima.

### Neutral
- **Porcelana** (`--porcelain`, #f4efe4): fondo de toda la carta, de la ficha y de la franja detrás de la banda pegajosa.
- **Tinta** (`--ink`, #2a2622): texto principal, filetes (a 15 % de opacidad como borde de celda, a 100 % en el filete de la cabecera), insignia «Agotado».
- **Gris cálido** (`--muted`, #655d52): descripciones, ayudas, pie.

Las otras tres paletas (Azul, Vino, Cacao) redefinen exactamente los mismos ocho roles y `--cobalt` (foco) con el verde de la paleta.

### Named Rules
**The Roles Only Rule.** Todo color sale de un rol de la paleta del local. Un componente nuevo elige un rol, no un hex; así las cuatro paletas (y las futuras) funcionan sin tocarlo.

**The Tone Pairing Rule.** Tinta sobre rosa y arena, blanco sobre verde y terracota. Es el único emparejamiento de texto y celda probado AA (`tones.ts`).

**The Same Tone Rule.** La celda de una categoría en el bento y la banda de su sección usan el mismo tono (`toneFor(índice)`, ciclo rosa, verde, arena, terracota). Es lo que dice dónde estás.

## Typography

**Display Font:** Gloock (con Georgia, serif), un solo peso (400).
**Body Font:** Schibsted Grotesk (con system-ui, sans-serif).

**Character:** un serif de contraste alto con presencia de cartel, junto a un grotesco de texto limpio y legible con poca luz. Ambas se cargan solo para la carta (`carta-fonts.ts`).

### Hierarchy
- **Display title** (400, `clamp(3.25rem, 0.75rem + 14vw, 6rem)`, 0.95, tracking -0.015em): nombre del local; con logo al lado baja a `clamp(2.5rem, 0.5rem + 11vw, 5rem)`.
- **Section** (400, 2rem a 3rem desde `sm`, 1): nombre de categoría en la banda pegajosa.
- **Tile name** (400, 1.5rem a 3rem según forma y largo del nombre; 1.125rem a 1.5rem si pasa de 28 caracteres, 1.05): nombre en la celda del bento.
- **Dish name** (400, 1.3125rem; destacada 1.875rem a 2.25rem, 1.05): nombre del plato; ficha de detalle 1.875rem.
- **Body** (400, 0.875rem a 1rem, 1.625): descripciones (3 líneas en cards normales), avisos.
- **Price** (600, 1rem, tabular-nums, terracota): precio del plato; en la ficha 1.25rem.
- **Label** (600, 0.75rem, +0.08em, mayúsculas): chips de la barra de categorías. Números de índice y cantidades: 0.875rem, 600, tabular-nums.

### Named Rules
**The One Weight Rule.** `.carta .font-display` fuerza peso 400 y Gloock no tiene otro: nunca negrita ni `font-semibold` sobre un título. El énfasis es tamaño y color.

**The Tabular Money Rule.** Precios, diferencias de opciones, índices y cantidades en `tabular-nums`, sin salto de línea en el precio.

## Layout

Contenedor centrado con gutters de 16 px (24 px desde `sm`). Cabecera, buscador y bento miden hasta 48 rem (`max-w-3xl`); la lista de secciones llega a 64 rem (`max-w-5xl`). El bento de categorías es una grilla de 2 columnas, huecos de 12 px (16 px en `sm`), filas de mínimo 8,5 rem (11 rem en `sm`) que crecen si un nombre largo lo pide. `mosaicLayout` repite bloques que completan fila (ancha; alta más dos chicas; dos chicas), así que la primera celda siempre es ancha y nunca quedan huecos. Las cards de plato usan 2 columnas (3 desde `md`); si el primer plato tiene foto y hay al menos tres, es destacada (2 columnas, 2 filas en escritorio); una cola impar ocupa el ancho completo en celular. El orden de la carta es el del local y nunca se altera. Las secciones se separan 56 px (80 px desde `sm`).

La barra de categorías (fija, z-10) aparece al pasar el bento; la banda de sección queda pegada debajo (`top-16`, z-5) con una franja de porcelana opaca detrás. El dock de llamado es fijo abajo (z-20) y la carta reserva 10 rem de pie cuando existe.

### Named Rules
**The No Gap Rule.** Toda grilla de celdas completa sus filas; si hay un plato o categoría sobrante, la última celda se ensancha.

## Elevation & Depth

Plana por defecto. La profundidad es tonal: celdas de color de la paleta, cards con filete interior `ring-1 ring-ink/15`, fotos con degradado negro (60 % a 85 %) solo para sostener la lectura del texto blanco. Única sombra de todo el sistema: la del dock de llamado.

### Shadow Vocabulary
- **Dock** (`box-shadow: 0 10px 28px -10px rgb(0 0 0 / 0.4)`): solo el dock fijo de `/t/{token}`, porque flota sobre contenido que se desplaza.
- **Fondo de la ficha** (`::backdrop`, `rgb(42 38 34 / 55%)`): velo, no sombra.

### Named Rules
**The Hairline Not Shadow Rule.** Una celda se separa del papel con color o con filete `ink/15`, jamás con sombra. La excepción es el dock, que flota.

## Shapes

Radio generoso y consistente por escala: celdas, cards, tiles y botones del dock 24 px (`rounded-3xl`); banda de sección 16 px; dock contenedor 28 px; chips, pastillas e insignias totalmente redondos; buscador 8 px; ficha de detalle 12 px. El foco sigue la forma del elemento: celdas a 24 px, chips redondos. Los logos se muestran con `object-contain`, sin recorte ni marco. Los íconos son SVG de trazo de 1,75 px (redondeado).

## Components

### Cabecera editorial
Logo (64 px, 96 px desde `sm`) a la izquierda del nombre del local en display verde, alineado a la izquierda. Debajo, un filete de tinta de 1,5 px y una línea con sucursal (ícono de pin terracota y «Sucursal …») y, en `/t`, la pastilla verde con la mesa. Sin hero ni bloque promocional.

### Buscador y filtros dietarios
Campo de 48 px, borde `ink/60`, radio 8 px, fondo transparente. Chips de dieta de 44 px, redondos, borde y texto verdes; activos en verde sólido con blanco. El aviso de que las etiquetas son declaradas por el local aparece solo al filtrar. Estado de resultados con `aria-live`.

### Bento de categorías
Un enlace por categoría: número de índice arriba a la izquierda, flecha arriba a la derecha, nombre en display y cantidad abajo. Sin foto: tono de la paleta (`toneFor`). Con foto del primer plato que la tenga: fondo verde profundo, degradado y texto blanco con sombra de texto; el número conserva el tono de su banda en una píldora. Zoom de la foto al pasar el mouse (solo sin reduced-motion).

### Barra de categorías
Fija arriba, porcelana al 95 % con desenfoque y filete inferior; chips de 44 px, mayúsculas de 0,75rem, rosa en reposo, arena al pasar, verde para la categoría que se lee. Es `inert` mientras está oculta.

### Banda de sección
Pegajosa: número, nombre en display y cantidad, con el tono de la celda del bento, radio 16 px.

### Cards de plato
Tres formas: destacada (2 columnas, foto 16:10), cola (ancho completo en celular) y normal (foto 4:3). Con foto: fondo porcelana, foto arriba, insignia «Agotado» (tinta, texto porcelana) sobre la foto. Sin foto: fondo arena y una inicial del nombre en display gigante, verde al 10 %, decorativa y detrás del texto. Nombre en display, precio terracota, descripción, etiquetas dietarias y opciones; las cards normales topan las opciones en 6 filas con aviso «N opciones más en el detalle». Toda la card es el botón que abre el detalle; el foco dibuja un contorno terracota de 3 px. Si una foto falla se muestra un marcador arena con un cubierto de trazo.

### Dock de llamado
Solo en `/t/{token}`. Contenedor flotante porcelana al 95 %, filete `ink/15`, radio 28 px y la única sombra del sistema; dos celdas de 56 px: «Llamar al mozo» (verde, blanco) y «Pedir la cuenta» (rosa, tinta), con ícono SVG. Sesión vencida reemplaza los botones por un mensaje.

### Ficha de detalle
`<dialog>` modal nativo (`showModal`), hasta 36 rem, porcelana, radio 12 px, velo de tinta al 55 %; botón «Volver a la carta» con subrayado, foto 4:3, nombre en display, precio terracota, opciones completas y aviso de alérgenos.

### Pie
Tres rombos (terracota, verde, rosa), aviso de alérgenos, enlaces legales y «Hecho con UcoMenu» en gris cálido.

### Movimiento y foco
Transiciones de 180 ms (chips) a 500 ms (zoom de foto) con `cubic-bezier(0.22, 1, 0.36, 1)`, todas bajo `prefers-reduced-motion: no-preference`; la barra de categorías usa `motion-safe`. El foco global usa `--cobalt`, que dentro de `.carta` vale el verde de la paleta.

## Do's and Don'ts

### Do:
- **Do** elegir cada color de uno de los ocho roles de la paleta y verificar el par texto/celda con la regla de emparejamiento.
- **Do** usar Gloock a peso 400 para títulos y Schibsted Grotesk para todo el resto.
- **Do** separar superficies con color de celda o filete `ink/15`, con radio de 24 px en celdas y cards.
- **Do** mantener el número de índice igual en la celda del bento y en la banda de su sección.
- **Do** mantener 44 px como mínimo de objetivo táctil y `tabular-nums` en importes.
- **Do** probar toda pieza nueva con y sin foto, con y sin logo, y con nombres largos (`overflow-wrap:anywhere`).

### Don't:
- **Don't** usar sombras fuera del dock de llamado.
- **Don't** aplicar negrita a Gloock ni usar las fuentes del panel (Young Serif, Hanken Grotesk) ni el azul cobalto dentro de la carta.
- **Don't** escribir un hex suelto en un componente de la carta: rompe las otras tres paletas.
- **Don't** volver a la lista plana de platos con puntos guía, a celdas uniformes ni a un encabezado centrado de plantilla.
- **Don't** reordenar los platos ni dejar huecos en las grillas.
- **Don't** documentar ni extender este sistema al panel, la sala o el login.

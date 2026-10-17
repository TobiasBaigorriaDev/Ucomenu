---
version: 1
slug: "src-app-m-org-branch-page-tsx"
primary_target: "src/app/m/[org]/[branch]/page.tsx"
related_targets: ["src/app/t/[token]/page.tsx"]
---

# Surface brief: carta pública

## Scope and mode
Carta pública de una sucursal: `/m/{org}/{sucursal}` y `/t/{token}` (misma vista, esta última con mesa y barra de llamado). Modo **Persuade** con restricciones de escaneo rápido: el comensal decide qué pedir, pero busca y filtra con una mano.

## Audience, job, constraints
Comensal anónimo, celular a 390 px, mesa de salón con poca luz. Trabajo: entender de qué local es, encontrar su plato (por categoría, búsqueda o dieta), abrir el detalle y, si hay mesa, llamar al mozo. Restricciones: solo presentación; cuatro paletas por local (variables CSS dentro de `.carta`, contraste AA ya probado) y logo opcional; con y sin foto; cartas de 5 a 300 platos; tipografía nueva sujeta a aprobación del usuario; sin dependencias nuevas sin aprobación; firma «Hecho con UcoMenu» al pie; voseo es-AR.

## Direction
Fijada por el usuario (gana al sorteo): Bento + Editorial + Card-based. Bento en portada y categorías, platos destacados y todo el listado; editorial como jerarquía de revista y asimetría con quiebres de grilla. Memorable moment: la carta se lee como un número de revista armado en celdas, no como una lista.

## Unresolved decisions
- Par tipográfico: se propone en el chat con motivos y lo aprueba el usuario antes de aplicarse.
- Cómo se eligen los platos destacados dentro de una categoría (sin campo nuevo en la base: criterio visual, por ejemplo los que tienen foto).
- Si la ficha de detalle se rehace como bento (hoy fuera de alcance).

## Direction contract
THESIS: La carta es una revista de bolsillo armada en bento: cada categoría es una sección con cabecera editorial y sus platos son cards de escala variable que quiebran la grilla a propósito. Rechaza la lista plana de platos con puntos guía, el mosaico de celdas uniformes y el encabezado centrado de plantilla.
OWN-WORLD: Superficie de papel del local (el fondo, la tinta y los acentos salen siempre de los roles de la paleta elegida, nunca de colores fijos). Celdas bento con radio generoso y filete fino en lugar de sombras. Kickers y numeración de sección («01», «02») con filetes, títulos de sección en display grande, precios tabulares. Tres cards de plato: destacada (grande, con foto o bloque de color editorial), estándar y compacta sin foto, que se sostiene solo con tipografía y color. Reconocible sin contenido por la grilla asimétrica de celdas y los kickers numerados.
STORY: En tres segundos el comensal sabe qué local y sucursal es, ve las categorías como un índice de celdas, encuentra su plato con búsqueda y filtros siempre al alcance, abre un detalle sin perder el lugar y, si entró por QR, llama al mozo con un toque.
FIRST VIEWPORT: A 390 px: encabezado editorial asimétrico con logo y nombre del local en display grande; sucursal y mesa como kicker; buscador visible; debajo, el bento de categorías ya asoma (celdas ancha y alta mezcladas). La barra de llamado al mozo queda fija abajo cuando hay mesa. Ningún bloque promocional ni hero decorativo.
FORM: Bento + Editorial + Card-based, fijada por el usuario el 2026-10-17; no hay semilla de sorteo porque la dirección está fijada. Camino de construcción: código primero (sin generación de imágenes disponible).
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

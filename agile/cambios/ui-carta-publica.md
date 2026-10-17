# Cambio: rediseño de la interfaz de la carta pública

Estado: **En curso (iterando con el usuario)**. Nivel **M**: varias piezas de presentación, sin consecuencias C (no toca autorización, datos expuestos, dinero ni borrados). Rama `feat/ui-carta`, desde `main`.

## Objetivo y método
Modificar la UI de la carta pública (`/m/{org}/{sucursal}` y `/t/{token}`) según lo que el usuario vaya pidiendo y comentando. Se itera en vivo con `pnpm dev` y recarga en caliente; cada ronda es un cambio pequeño que el usuario ve, aprueba o corrige. Se usan los skills de frontend (`impeccable`, `frontend-design`).

## Restricciones (no negociables salvo decisión explícita)
- Solo presentación: sin cambios de esquema, RLS, lecturas ni reglas de negocio.
- Se conservan las paletas por organización (variables CSS de `.carta`), el logo, el buscador, los filtros, el detalle del plato, el estado Agotado y los avisos de alérgenos.
- Accesibilidad y móvil primero: 390 px sin desborde, objetivos táctiles de 44 px, contraste AA en las cuatro paletas (`src/lib/identidad/palettes.test.ts`), foco visible, `prefers-reduced-motion`.
- Si un cambio de diseño necesita tocar los tokens de `globals.css` o las paletas, se avisa antes: afecta al panel y al contraste probado.

## Contexto de diseño y decisiones (2026-10-17)
Contexto durable en [`PRODUCT.md`](../../PRODUCT.md) y en el surface brief con el contrato de dirección (`.impeccable/surfaces/src-app-m-org-branch-page-tsx.md`); no se repiten aquí. `DESIGN.md` se genera al cerrar la primera iteración construida, no antes.
- **Alcance:** rediseño profundo; se conservan funciones, contenido y las cuatro paletas por local.
- **Dirección fijada por el usuario:** Bento + Editorial + Card-based.
- **Bento:** portada y categorías, platos destacados y todo el listado. **Editorial:** jerarquía de revista y asimetría con quiebres de grilla.
- **Fotos:** mezcla; las cards funcionan con y sin foto. **Marca:** el local manda, con firma discreta «Hecho con UcoMenu» al pie. **Voz:** voseo cercano.
- **Tipografía:** el usuario eligió el par A: **Gloock** (display, un solo peso) + **Schibsted Grotesk** (texto), cargadas solo para la carta desde `src/components/menu/carta-fonts.ts`; el panel conserva Young Serif + Hanken. Paletas sin cambios.
- **Kickers y numeración:** el skill los desaconseja por decorativos; el usuario los pidió, así que llevan información real (el número es el índice de la categoría; la línea de sucursal y mesa es dato real).

## Rondas
**Ronda 1 (2026-10-17):** tipografía Gloock + Schibsted aplicada a la carta; encabezado editorial alineado a la izquierda, con filete y línea de sucursal y mesa (se quitó el confeti); categorías como bento: la primera celda siempre ancha, cada celda con índice, nombre y cantidad de platos, y foto con scrim o bloque de color de la paleta. Verificado: typecheck, lint y `pnpm test` 444/444. E2E de carta pendientes hasta cerrar la iteración. Falta el feedback del usuario sobre esta ronda.

**Datos de demo (2026-10-17):** a pedido del usuario, `pnpm db:demo` (`tools/sembrar-demo.mjs`, solo local, idempotente, `--quitar` la deshace) llena `cafe-ejemplo` (7 categorías, 28 platos, 24 con foto, logo) y `parrilla-demo` (7 categorías, 24 platos, 19 con foto, logo) con descripciones, etiquetas, variantes y un plato agotado por local. Fotos de Unsplash descargadas a `.demo-cache/` (ignorada por Git; no se versionan binarios). **No modifica `supabase/seed.sql`**: las pruebas de RLS y E2E siguen asumiendo el seed limpio, así que antes de correrlas hay que volver con `pnpm db:reset` o `pnpm db:demo --quitar`. Cierre de la iteración: correr los E2E sobre el seed limpio.

**Ronda 2 (2026-10-17), feedback del usuario:** (1) el aviso de alérgenos y la leyenda de filtros salen del inicio (el aviso aparece al filtrar por etiqueta); (2) el logo va al lado del nombre del local, en una caja cuadrada con `object-contain`; (3) los botones «Llamar al mozo» y «Pedir la cuenta» se integran al diseño como un dock flotante de dos celdas (icono dibujado, colores de la paleta), con el mismo comportamiento, `data-testid` y ticket de visita. Solo existen en `/t/{token}` y con plan Pro: la demo pasa las dos organizaciones a Pro (`/t/c0ffee01000000000000000000000000` y `/t/fa11a001000000000000000000000000`); `--quitar` las devuelve a Básico. Verificado sobre seed limpio: typecheck, lint, build y 97 E2E de carta, llamado, ticket de visita, identidad y legales.

**Ronda 3 (2026-10-17):** secciones y platos. Cabecera de sección editorial (filete, número del índice del bento, nombre en display a la izquierda, cantidad de platos a la derecha) y platos como cards en bento, en `dish-card.tsx` y `menu-section.tsx` (reemplazan la lista con puntos guía y `dish-photo.tsx`): el primer plato de la categoría es el destacado si tiene foto y hay al menos tres (2 columnas; en escritorio, 2 filas con dos cards apiladas al lado); el resto en media columna (3 columnas en escritorio), foto 4:3, nombre en Gloock, precio, descripción de tres líneas, etiquetas y opciones; una cola impar ocupa el ancho completo en el celular. Sin foto: card tipográfica teñida con la paleta y una inicial editorial tenue. Toda la card abre el detalle; Agotado es una insignia. Decisiones técnicas: la detección de foto rota usa solo `onError` (mirar `complete` con ancho 0 marcaba como rota a una imagen diferida aún no cargada); las pruebas de foto pasan de una imagen de 1×1 píxel a una de 480×300 (`FOTO_PNG` en `e2e/support.ts`) y el test de fotos optimizadas verifica `sizes`, `srcset` por ancho y las dimensiones fijas de la card. Verificado sobre seed limpio: typecheck, lint, `pnpm test` 448/448, build y 105+28 E2E de carta, fotos, opciones, disponibilidad, identidad, llamado y ticket de visita. Capturas revisadas a 390 y 1280 px en `cafe-ejemplo` (Oliva) y `parrilla-demo` (Cacao). Falta el feedback del usuario.

**Ronda 4 (2026-10-17), feedback del usuario:** al bajar se perdía el nombre de la categoría. La cabecera de cada sección pasa a ser una **banda pegajosa** (`sticky top-16`, debajo de la barra de categorías) con el color de su celda en el bento (`tones.ts` compartido entre el bento y la sección: rosa, verde, arena y terracota, ya con contraste AA). Una franja de fondo sólido detrás evita que las cards se asomen por las esquinas redondeadas; al entrar en la sección siguiente, su banda empuja a la anterior. Verificado: typecheck, lint, 448 unitarias, build y 115 E2E sobre seed limpio; capturas a 390 y 1280 px con scroll. **Nota de proceso:** correr `pnpm build` mientras `pnpm dev` está vivo en el mismo proyecto dejó al servidor de desarrollo con el CSS desactualizado (faltaban clases nuevas): detener `pnpm dev` antes de compilar o correr E2E, y reiniciarlo después.

## Aceptación
- [ ] Los cambios pedidos por el usuario están hechos y aprobados por él en el navegador.
- [ ] Móvil (390 px) y escritorio (1280 px) sin desborde; contraste y foco intactos en las cuatro paletas.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm build` y los E2E de carta (`menu`, `buscador`, `disponibilidad`, `identidad`, `rendimiento-carta`) en verde; ajustar los E2E que dependan de textos o estructura que cambien por decisión de diseño.

Evidencia: pendiente.

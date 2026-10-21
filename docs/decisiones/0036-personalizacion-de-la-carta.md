# 0036 — Personalización de la carta: doce paletas cerradas (claras y oscuras) y tres estilos

- Estado: aceptada (aprobada por el usuario el 2026-10-21)
- Fecha: 2026-10-21

## Contexto
La identidad del local eran cuatro paletas claras y un logo, con una sola composición de carta (bento). Hay locales a los que no les van los colores pastel o claros ni ese diseño. El ADR de identidad no existía: la decisión vivía en `agile/cambios/identidad-del-local.md`. Se mantiene la regla de producto: **sin selector libre de color**, contraste AA comprobado, incluido en todos los planes.

## Decisión
1. **Paletas cerradas ampliadas a doce**: ocho claras (Oliva, Azul, Vino, Cacao, Cítrico, Mar, Trattoria, Monocromo) y cuatro oscuras (Carbón, Medianoche, Bosque, Borgoña). Cada una cumple AA en `palettes.test.ts`.
2. **Nuevo rol `--on-accent`**: texto sobre el acento y la terracota. Blanco en las claras; la tinta del fondo en las oscuras (un blanco fijo no pasa AA sobre acentos dorados o verdes claros). Dentro de la carta no se usa `text-white` sobre esos fondos.
3. **El panel del Dueño nunca es oscuro.** Cada paleta oscura trae una variante clara `panel` (mismo tono de marca); `paletteStyle(valor, "panel")` la usa. La carta pública sí adopta el esquema oscuro y declara `color-scheme: dark`.
4. **Tres estilos de carta** (`organizations.menu_layout`: `bento` por defecto, `clasica`, `minimal`) que cambian la composición sobre los mismos datos, colores y tipografía: `clasica` = categorías en la barra fija y platos en lista con puntos guía y precio; `minimal` = una columna de cards con foto grande. Sin tipografías nuevas.
5. **Valores cerrados también en la base** (`check` en `menu_palette` y `menu_layout`) y mismo permiso de escritura que el resto de la identidad (Dueño con la cuenta editable; el grant de columnas ya existente se extiende a `menu_layout`). La lista de la base y la de `PALETTES` / `LAYOUTS` deben coincidir: una prueba RLS guarda cada valor.
6. **Vista previa real** en `/apariencia`: los componentes de la carta con platos de muestra, para ver paleta y estilo antes de guardar.

## Consecuencias
- Locales existentes sin cambios (Oliva + bento por defecto).
- Agregar una paleta o un estilo = una entrada en el código, una migración que amplía el `check` y su prueba AA.
- Con `clasica` y `minimal` el mosaico no se muestra: la barra de categorías es siempre visible y hace de índice.
- Queda fuera, por decisión del usuario: tipografía y esquinas por local, y una portada con imagen.

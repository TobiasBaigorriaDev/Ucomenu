# 0037 — Temas de fechas especiales en la carta (decoración opcional con ventana de fechas)

- Estado: aceptada (aprobada por el usuario el 2026-10-21)
- Fecha: 2026-10-21

## Contexto
Tras las paletas y los estilos (ADR 0036), el usuario pidió «mini detalles» opcionales para días especiales (San Valentín, Navidad, Halloween…), por ejemplo corazoncitos de fondo. Eligió: activación **manual con ventana opcional «desde / hasta»** y alcance **decorativo sutil** (sin animaciones, sin colores propios del tema, sin texto libre).

## Decisión
1. **Nueve temas cerrados** pensados para Argentina: San Valentín, Pascuas, Día de la Madre, Día del Padre, Fiestas patrias, Día del Amigo, Halloween, Navidad y Año Nuevo; más `ninguno` (predeterminado). Cada uno es un conjunto de motivos, un saludo en es/en/pt y nada más.
2. **Tres columnas en `organizations`** (`menu_theme`, `menu_theme_from`, `menu_theme_until`), con `check` cerrado y `until >= from`; mismo permiso de escritura que el resto de la identidad (Dueño con cuenta editable).
3. **Ventana en días de Buenos Aires**, inclusiva, con cualquiera de los extremos opcional; sin fechas el tema queda hasta que se apague. Se resuelve en el servidor en cada pedido de la carta (la página ya es dinámica), así que **vence sola** sin tareas programadas ni invalidar cachés. Una fecha ilegible se ignora (nunca oculta ni fuerza el tema por error).
4. **Render sin red y sin tocar colores**: patrón de fondo = máscara SVG inline sobre la terracota de la paleta del local con opacidad fija 0,07 (`--tema-patron`, `--tema-opacidad`), detrás del contenido y sin eventos; saludo en la cabecera; los rombos del pie pasan a ser los motivos. Todo `aria-hidden` salvo el saludo. Una prueba mezcla el patrón en su peor caso sobre el fondo de cada paleta y exige AA para tinta, texto secundario, acento y terracota.
5. **Un solo origen de los motivos** (`MOTIFS` en `src/lib/identidad/temas.ts`) para los íconos y el patrón; sin emoji (cambian por sistema) ni imágenes subidas.
6. **Valores cerrados también en la base**; una prueba compara la lista de la migración con `THEMES`.

## Consecuencias
- Locales existentes sin cambios. Agregar un tema = una entrada en `THEMES`, una migración que amplía el `check` y su saludo en tres idiomas.
- El saludo sigue el idioma de la carta que el local ofrece (sin traducciones, el comensal ve español).
- Queda fuera, por decisión: animaciones, colores propios del tema, saludo libre, imágenes y activación automática por calendario.

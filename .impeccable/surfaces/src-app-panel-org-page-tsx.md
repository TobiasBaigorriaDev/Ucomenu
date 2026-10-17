---
version: 1
slug: "src-app-panel-org-page-tsx"
primary_target: "src/app/panel/[org]/page.tsx"
related_targets: ["src/app/admin/page.tsx"]
---

# Surface brief: panel del Dueño y SuperAdmin

## Scope and mode
Modo **Operate**. Marco compartido (`AppShell`) y todas las pantallas de `/panel/{org}` y `/admin`. La sala (`/sala`), `/cuenta` y el login heredan marco, tipografía y botones; su layout no se rehace.

## Audience, job, constraints
Dueño y Staff del local (celular o notebook, durante el servicio o al cargar la carta) y equipo de UcoNext (SuperAdmin, escritorio). Trabajo: cargar y ordenar la carta, mesas, llamados, sucursales, suscripción y personal; en admin, alta de organizaciones, planes, pagos y suspensiones. Restricciones: solo presentación (sin tocar permisos, datos ni reglas); DOM, textos, roles y `data-testid` se conservan porque los E2E dependen de ellos; un solo `<nav>` por área; 390 px sin desborde; AA; sin dependencias nuevas; voseo es-AR; avisos de mora con sus colores funcionales.

## Direction
Decidida por el usuario el 2026-10-17: llevar el estilo de la carta pública (Gloock + Schibsted Grotesk, papel y tinta, celdas de 24 px con filete, bandas de tono) al panel. El panel del Dueño se tiñe con la paleta que el local eligió (misma que su carta); el de SuperAdmin usa la paleta UcoNext (verde oscuro #155B20, verde vivo #4A9E38, blanco y grises cálidos). Navegación lateral en escritorio y chips en celular.

## Unresolved decisions
- Si la sala en vivo se rehace para tablet/pantalla fija (fuera de alcance por ahora).

## Direction contract
THESIS: El panel es el reverso de la carta: el mismo papel, la misma tipografía y los mismos tonos, pero al servicio de trabajar. Rechaza la tabla gris con acento único y la lista de filas con puntos guía.
OWN-WORLD: Marco de dos zonas: riel lateral en el verde profundo de la paleta (nombre del local en display, secciones agrupadas, cuenta al pie) y un lienzo de papel. El contenido se arma en celdas de 24 px con filete `ink/15` y relleno claro; los títulos de página y de sección en Gloock 400; las categorías de la carta llevan la banda con el mismo tono (`toneFor`) que ven los comensales. Botones en píldora verde, campos de 8 px, insignias en píldora. Sin sombras. Reconocible sin contenido por el riel verde profundo y las celdas redondeadas.
STORY: El Dueño entra y sabe de qué local es el panel por su nombre, logo y color; ve qué sigue en el Resumen, y llega a cualquier sección en un toque. El SuperAdmin reconoce de inmediato que está en la plataforma, no en un local, por el verde UcoNext.
FIRST VIEWPORT: 1440 px: riel de 17 rem con nombre del local en display, secciones y cuenta; lienzo con título de página en Gloock y celdas (primeros pasos, carta pública, uso del plan). 390 px: cabecera con nombre y cuenta, chips de secciones de 44 px, celdas apiladas.
FORM: Extensión del mundo de la carta (sin sorteo). Camino de construcción: código primero.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

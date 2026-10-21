# Cambio: Temas de fechas especiales en la carta

Estado: **Implementado y verificado en local; aprobado por el usuario el 2026-10-21 y commiteado** (decisión aceptada en `docs/decisiones/0037-temas-de-fechas-especiales.md`). Migración `20261109100000` **aún no empujada a staging** (el `db push` quedó pendiente); la app sin desplegar.
Nivel: **M** (amplía la identidad con valores cerrados; sin autorización nueva, dinero ni borrado).

## Objetivo y decisiones

Detalles opcionales para días especiales (corazoncitos en San Valentín, etc.). El usuario eligió activación **manual con ventana «desde / hasta» opcional** y alcance **decoración sutil** (sin animaciones, sin colores propios, sin texto libre).

- 9 temas: San Valentín, Pascuas, Día de la Madre, Día del Padre, Fiestas patrias, Día del Amigo, Halloween, Navidad, Año Nuevo (+ `ninguno`).
- Migración `20261109100000_temas_de_fecha.sql`: `menu_theme`, `menu_theme_from`, `menu_theme_until` (`check` cerrado y `until >= from`; grant de columnas al `authenticated`).
- Vigencia: función pura `activeTheme` por día de Buenos Aires, inclusiva, resuelta en `getPublicMenu`; vence sola.
- Render: `data-tema` + patrón por máscara SVG inline (terracota de la paleta, opacidad 0,07), saludo en la cabecera y motivos en el pie. Sin pedidos de red nuevos.
- Panel: sección «Fecha especial» en `/apariencia` con estado en palabras, fechas opcionales, aviso si «Hasta» < «Desde» y vista previa real. Los saludos viven en `temas.ts` (no en `textos.ts`): un solo lugar por tema; su prueba exige es/en/pt.

## Aceptación

- [x] Apagado por defecto: los locales existentes no cambian.
- [x] Dentro de la ventana la carta (`/m` y `/t`) muestra el tema; vencida, programada o apagada, se ve normal.
- [x] El contraste AA se conserva con el patrón puesto, en las 12 paletas (peor caso probado).
- [x] Solo el Dueño con cuenta editable cambia el tema; la base rechaza temas desconocidos y ventanas invertidas.
- [x] Revisión visual a 390 px: San Valentín + Vino, Halloween + Carbón, Navidad + Cítrico (patrón discreto, pie con motivos, sin desborde horizontal).

## Evidencia (árbol sin confirmar sobre `68cfb60`)

- `pnpm test`: 805 verdes (`temas.test.ts`: ventana en Buenos Aires con límites inclusivos, fechas ausentes o mal formadas, catálogo, coincidencia con la migración y contraste con el patrón) · `pnpm typecheck`, `pnpm lint` y `pnpm build`: sin errores.
- `pnpm test:rls identidad`: 10 verdes (cada tema con su ventana, «ninguno» borra las fechas, valores y ventanas inválidos rechazados, Staff, ajeno y anónimo sin escritura).
- `e2e/identidad.spec.ts`: 5 verdes (Navidad activa con saludo y patrón; ventana vencida → carta normal; «Hasta» anterior a «Desde» avisa; «Ninguno»). `e2e/rendimiento-carta.spec.ts` y `e2e/carta.spec.ts`: 35 verdes.
- No corrido: `menu.spec.ts` y 15 pruebas RLS de otras áreas, que ya fallaban por los escenarios locales cargados (ver [personalización](personalizacion-carta.md)); revisión independiente (no exigida en M); staging.

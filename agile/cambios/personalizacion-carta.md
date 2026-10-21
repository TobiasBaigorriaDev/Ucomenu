# Cambio: Personalización de la carta por local (paletas, vista previa y estilo)

Estado: **Implementado y verificado en local; aprobado por el usuario el 2026-10-21 y commiteado** (decisión aceptada en `docs/decisiones/0036-personalizacion-de-la-carta.md`). Migraciones `20261108100000` y `20261108110000` empujadas a staging con el catálogo del feed; la app sin desplegar.
Nivel: **M** (amplía un conjunto cerrado de valores y la presentación; sin autorización, datos ni dinero).

## Objetivo y decisiones

Hay locales a los que no les van los colores claros ni la carta bento. El usuario eligió: A (paletas nuevas, incluidas oscuras), E (vista previa real) y B (estilo de carta); quedan fuera tipografía/esquinas y portada.

- **A + E (hecho):** 12 paletas cerradas (8 claras y 4 oscuras) con contraste AA probado en `palettes.test.ts`. Nuevo rol `--on-accent` (texto sobre acento y terracota) para que las oscuras no usen blanco fijo. Cada oscura trae una variante clara `panel`: el panel del Dueño nunca es oscuro. La carta oscura declara `color-scheme: dark`.
- La vista previa de `/apariencia` usa los componentes reales (cabecera con el logo, mosaico, banda y cards) con platos de muestra; es `inert` y `aria-hidden`.
- Migración `20261108100000_paletas_nuevas.sql`: solo amplía el `check` de `menu_palette`; Oliva y los datos existentes no cambian.
- **B (hecho):** migración `20261108110000_estilo_de_carta.sql` (`menu_layout`, por defecto `bento`, con `check` y grant de columna); `data-layout` en `.carta`; `DishRow` (lista con puntos guía) y card `single` (una columna, foto grande); sin mosaico en `clasica` y `minimal` (la barra fija hace de índice; la carta reserva 4 rem arriba). Selector «Estilo de la carta» con vista previa. Sin tipografías nuevas.

## Aceptación

- [x] Todas las paletas cumplen AA (carta y panel); la base acepta cada una.
- [x] Carta pública oscura legible (revisión visual con Carbón).
- [x] El Dueño ve la vista previa con la paleta elegida y el panel sigue claro.
- [x] Estilo de carta elegible y visible en `/m` (revisión visual de `clasica` con Borgoña y `minimal` con Bosque a 390 px, sin desborde).

## Evidencia (árbol sin confirmar sobre `68cfb60`)

- `pnpm test`: 774 verdes (incluye contraste AA de las 12 paletas y de sus variantes de panel) · `pnpm typecheck`, `pnpm lint` y `pnpm build`: sin errores.
- `pnpm test:rls identidad`: 10 verdes (cada paleta y cada estilo se guardan; valor desconocido, Staff, ajeno y anónimo rechazados). `pnpm exec playwright test e2e/identidad.spec.ts`: 5 verdes (paleta oscura en carta y panel claro; clásica, minimal y bento en `/m`). `menu`, `carta` y `rendimiento-carta`: sin fallos propios, salvo `menu.spec` (ver abajo).
- Revisión visual a 390 px: Carbón (bento), Borgoña (clásica) y Bosque (minimal), sin desborde horizontal.
- **No pasa por datos locales, no por el cambio:** con los escenarios de `tools/escenarios-locales.mjs` cargados, 15 pruebas de `pnpm test:rls` (catalog, opciones, push, tables, tenancy) y 3 de `e2e/menu.spec.ts` comparan contra el seed puro y fallan (p. ej. 26 platos en vez de 5). Hace falta `pnpm db:reset` para confirmarlas verdes; no se hizo para no borrar esos escenarios.
- No corrido: revisión independiente (no exigida en M), staging.

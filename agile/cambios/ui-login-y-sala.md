# Cambio: login y sala en vivo con el lenguaje del panel

Estado: **Hecho e integrado a `main`** (aprobado por el usuario el 2026-10-17; desplegado en staging). Nivel **M**: solo presentación; ni esquema, ni permisos, ni reglas. Cierra el pendiente de [rediseño del panel](ui-panel-dueno-y-superadmin.md).

## Objetivo y decisiones
- **Login:** pasa a `.panel` con la paleta de UcoNext (`platformStyle()`) y la tipografía de la carta. Todavía no se sabe el local, así que no usa la paleta de ninguno; no usa Geist porque entran dueños y personal. Dos celdas (marca y formulario); apiladas en celular. Textos, etiquetas, botón y encabezado («Ingresá a tu cuenta») no cambian: los E2E y la accesibilidad dependen de ellos. `Mark` (los rombos) se extrae a `src/components/panel/mark.tsx` para compartirla con el riel.
- **Sala en vivo:** los llamados son tarjetas (banda por tipo de aviso, mesa en display grande, espera legible a distancia). Se conservan todos los `data-testid` y los nombres accesibles de los botones. El estado se dice con borde y texto, no solo con color. Alertas, vacío, plan sin llamados y avisos de conexión pasan a celdas con los colores funcionales de gravedad. Sin cambios de comportamiento (sondeo, sonido, Wake Lock).
- `DESIGN.md` documenta las dos pantallas y deja de decir «no extender al login».

## Aceptación
- [x] Login a 390 y 1280 px sin desborde; el formulario sigue funcionando (error, `next`, ya con sesión).
- [x] Sala a 390, 1024 y 1280 px sin desborde; botones de 44 px o más; los llamados nuevos, urgentes y viejos se distinguen sin depender del color.
- [x] Los E2E existentes de login, acceso, sala y ticket de visita pasan sin cambiarlos.

## Evidencia (2026-10-17, build propio sobre la base local)
`pnpm lint` y `pnpm typecheck` limpios · `pnpm test` 471/471 · `pnpm build` · `pnpm exec playwright test` completo **257 verdes, 1 omitido**: el login lo ejercitan todas las specs, y las de acceso, sala y ticket de visita pasaron sin cambiarlas. Revisión visual con capturas del navegador (login a 390 y 1280 px y con error; sala a 390, 1024 y 1280 px con un llamado nuevo, uno de 12 minutos y uno de «Escaneó el QR» de 2 h 18 min): sin desborde; la captura detectó que un rombo decorativo del login pasaba detrás del titular y se movió a la esquina. Sin revisión independiente de Codex (nivel M, sin duda sobre autorización ni datos).
**Probado por el usuario en el teléfono sobre staging (2026-10-17): funciona bien.** **No ejecutado:** tablet real; contraste de las tarjetas contra una paleta de local con verde claro (la banda usa los pares ya probados en `palettes.test.ts`).

# Aparición suave de bloques de la portada

Nivel M · 2026-10-30 · cambio local sobre `a26b9e8`.

Al bajar por la portada, los bloques principales aparecen con un movimiento breve y suave. La animación ocurre una vez por bloque; no cambia el hero ni retrasa la interacción. El contenido es visible desde el inicio, incluso sin JavaScript. Con movimiento reducido no se anima. No cambia datos ni agrega dependencias.

## Verificación

- Diff local sin commit: `pnpm build` y ESLint de los archivos afectados correctos.
- Chromium contra `next start` del build: 6/6 pruebas focalizadas (aparición una vez, movimiento reducido, contenido sin JavaScript y regresiones de rotación móvil del hero). Capturas inspeccionadas en `output/ux/` a 390 y 1440 px.
- No se verificó en teléfono físico ni se desplegó. La comprobación de navegador usó una configuración local sin inicialización de base.

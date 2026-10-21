# Cambio: selección directa de sucursal en Sala en vivo

Estado: hecho y commiteado (2026-10-21, aprobado por el usuario); sin despliegue de la app.
Nivel: M (interacción y regresión E2E; no cambia autorización, RPC, esquema ni reglas de avisos).

## Problema y decisión

El usuario informa que al pasar de Norte a otra sucursal se activa «Todas».
Los botones acumulaban la elección y normalizaban el conjunto completo a «Todas».
Cada botón pasará directamente a esa sucursal; tocar la activa la conserva.
La selección múltiple sigue disponible mediante «Elegir varias», de forma explícita.
Desactivar ese modo conserva la selección hasta el próximo toque de sucursal,
sin guardar cambios implícitos. Una vista múltiple guardada abre en modo múltiple.
Esto actualiza la interacción aditiva implícita descrita en la decisión 7 de
[vista por sucursal](vista-por-sucursal.md), conservando su persistencia y reglas de avisos.

## Aceptación

- Pasar de una sucursal a otra deja elegida solo la última, también con sondeo lento y tras recargar.
- Tocar la sucursal activa no activa «Todas»; ese botón sigue siendo explícito.
- «Elegir varias» permite sumar y quitar sucursales; ninguna o todas equivale a «Todas».
- Una selección múltiple persiste; apagar el modo permite volver a una sola con un toque.
- Selector sin desborde a 390 px y escritorio; controles inactivos durante el guardado.

## Evidencia

2026-10-21, diff local basado en `68cfb60`, limitado al selector y `e2e/sala.spec.ts`:

- Regresión antes del arreglo: `pnpm exec playwright test e2e/sala.spec.ts --workers=1 -g "cambiar de sucursal con el sondeo lento"` falla porque Norte queda con `aria-pressed=false` tras elegir Centro → Norte.
- `pnpm db:start` y `pnpm db:reset` locales, luego `pnpm build`, `pnpm lint` y `pnpm typecheck`: OK. Tras ajustar el fixture: typecheck y ESLint del spec OK.
- `pnpm exec playwright test e2e/sala.spec.ts --workers=1`: 26 pasan; la prueba nueva de selección múltiple falla al preparar una tercera sucursal con plan Pro (`limit_exceeded:branches`). Fixture corregido a Premium y repetición filtrada `-g "elegir varias es explícito"`: 1 pasa. No se modificó código de aplicación después de esa suite.
- Inspección de capturas y comprobación de desborde a 390 y 1280 px: OK (`test-results/selector-sucursal-mobile.png` y `selector-sucursal-desktop.png`, ignoradas por Git).
- Diff revisado; sin pruebas RLS ni suite global: no cambia esquema, permisos, consultas ni envío de avisos. La suite de Sala cubre sus flujos y las reglas de sonido existentes.
- Demo y escenarios locales previos restaurados con `pnpm db:demo` y `node tools/escenarios-locales.mjs` después de los E2E.

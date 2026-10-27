# Ahora (handoff)

Actualizado: 2026-10-26 · agente saliente: Codex. Historia en Git y fichas.

## Punto de retomada

**Propina sugerida por sucursal (C):** implementada en `ad2e3cb`, revisada y aprobada por Claude. El usuario autorizó push y staging; rama integrada por fast-forward a `main` y publicada hasta `83c488d`, incluidos los commits previos de personal que estaban pendientes de subir. Alcance, decisiones, revisión, evidencia y recuperación en la [ficha](cambios/propina-sugerida.md). La configuración está en Sucursales, solo para el Dueño; cuenta del cliente y precuenta imprimible separan consumo y sugerencia opcional. Falta la comprobación manual del usuario con sesión real en staging.

**Staging está en Fly v64**, imagen `propina-83c488d-git`, construida desde el snapshot Git exacto de `83c488d`. La migración `20261209100000` está aplicada en Supabase staging. Los resultados de las comprobaciones están en la ficha, no se duplican acá. Marcha atrás: imagen `personal-sucursal-a14dded` (v62), conservando la migración aditiva. Se mantuvieron los secretos y la configuración pública previa; producción no se tocó.

**Personal por sucursal, solo pantalla (M):** sigue pendiente la comprobación manual con sesiones reales en staging; ver [ficha](cambios/personal-por-sucursal.md) y [tablero](tablero.md). El aislamiento real por RLS permanece en Backlog: las asignaciones filtran las pantallas y una llamada directa todavía puede operar con ids de otra sucursal de la organización.

## Límites y bloqueos

- Producción continúa bloqueada por revisión legal y preparación operativa; ver [ficha legal](cambios/informacion-alimentaria-y-textos-legales.md).
- Siguen abiertas etiquetas por sucursal, alergias en observaciones y limpieza de `rate_key`.
- Preservar los archivos ajenos sin seguimiento: `tools/escenarios-locales.mjs`, `public/notificacion.mp3` y `public/notificacion-plato-listo.mp3`. Los audios aparecieron durante el despliegue; la imagen final los excluye.
- Para desplegar, usar snapshot Git; para RLS/E2E, base local y corridas separadas. Siguiente migración libre: `20261210100000`.

## Próximo paso

Probar la propina en Sucursales, pedir la cuenta desde el QR y comparar con la precuenta. Retomar después la comprobación de personal o el backlog.

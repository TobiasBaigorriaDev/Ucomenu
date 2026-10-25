# Ahora (handoff)

Actualizado: 2026-10-25 · agente saliente: Codex. Historia en Git y fichas.

## Punto de retomada

**Reinicios de QR programados y masivos: en staging, Fly v53**, con la migración `20261204100000`. El usuario autorizó aplicar el incremento con «Aplicalo», después de la aprobación de Claude. Rama `main`; implementación `1f82cce`, correcciones `e46a942`, imagen construida desde `9d0091f`. La [ficha](cambios/reinicio-programado-qr.md) concentra aceptación, evidencia local/remota, informes y recuperación.

El Dueño configura horarios diarios en Panel → Sucursales, con 05:00 por defecto en la zona de cada sucursal; una lista vacía desactiva el automatismo. Sala → Mesas ofrece a Dueño y Staff reiniciar todas las mesas del local, en todas sus sucursales, con confirmación. El QR impreso y los pedidos se conservan. Los horarios internos solo los lee el Dueño por RPC; el marcador no es público.

La base enlazada sigue siendo el proyecto de staging `oasixhsdyigimwvcxtkx`. Se aplicó únicamente la migración prevista, sin seeds ni cambios de secretos. La aplicación usa la imagen `qr-reset-9d0091f`; no se reconstruyó entre las pruebas y el despliegue. El cron funciona desde PostgreSQL aunque Fly esté apagado. Cambiar horarios, zona o reactivar empieza a contar desde ese momento; tras una interrupción se recupera el último reinicio pendiente.

## Límites y bloqueos

- Falta que el usuario pruebe con sesión real de Dueño/Mozo y en teléfono: configurar horarios, reiniciar todas las mesas, recargar una visita anterior y volver a escanear.
- Si Windows repite `0xC0000409` con `forks`, el pool `threads` funcionó para el archivo afectado; ver la ficha, sin cambiar la configuración global.
- Los setups pausan y restauran el cron local. Si se mata la suite sin teardown, comprobar `cron.job` o resetear local antes del ensayo manual.
- Preservar `tools/escenarios-locales.mjs`, ajeno y sin seguimiento. Los commits siguen locales, sin push.
- Producción continúa bloqueada por dominio, revisión legal y purgas. Rotar la clave legacy de staging sigue pendiente, fuera de alcance.

## Próximo paso

Recibir la prueba del usuario en staging. Siguiente migración libre: `20261205100000`. Las sugerencias operativas no bloqueantes y los límites de la revisión están en la ficha.

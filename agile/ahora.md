# Ahora (handoff)

Actualizado: 2026-10-26 · agente saliente: Codex. Historia en Git y fichas.

## Punto de retomada

**Audios de avisos para mozo y cocina (M):** rama `feat/audios-notificaciones`, desde `e98a02a`; incremento local verificado. El usuario aportó dos MP3 en `public` y pidió reemplazar el pitido habitual y distinguir el pedido terminado por cocina. Se usa `notificacion.mp3` para llamados y platos nuevos, y `notificacion-plato-listo.mp3` cuando al pedido no le quedan platos pendientes de cocina. Alcance, decisiones y evidencia en la [ficha](cambios/audios-notificaciones.md). El cambio conserva los avisos visuales por plato y las preferencias de alertas del dispositivo. Falta escucha manual en los dispositivos del usuario. No se pidió publicar este nuevo cambio.

Los dos MP3 pasan a formar parte del incremento porque ahora el usuario autorizó expresamente su uso. No modificarlos ni reemplazarlos por sonidos generados. `tools/escenarios-locales.mjs` sigue ajeno y sin seguimiento.

**Staging permanece en Fly v64**, imagen `propina-83c488d-git`, desde un snapshot Git de `83c488d`, con migración `20261209100000`. La propina fue revisada y desplegada con autorización; ver [ficha](cambios/propina-sugerida.md). El registro está en `e98a02a`, subido a origin/main. Staging todavía no incluye estos audios. Se mantiene pendiente la comprobación manual de propina por el usuario con sesión real.

**Personal por sucursal, solo pantalla:** también espera comprobación manual; ver [ficha](cambios/personal-por-sucursal.md). La restricción real por RLS está en Backlog: hoy las asignaciones filtran pantallas, sin impedir llamadas directas entre sucursales de la organización.

## Límites y bloqueos

Producción continúa bloqueada por revisión legal y preparación operativa; ver [ficha legal](cambios/informacion-alimentaria-y-textos-legales.md). Siguen abiertas etiquetas por sucursal, alergias en observaciones y limpieza de `rate_key`. Usar snapshot Git para desplegar. RLS y E2E comparten base local y deben ejecutarse separados. Siguiente migración libre: `20261210100000`; este cambio no necesita esquema nuevo.

## Próximo paso

Escuchar los avisos en los dispositivos del usuario, con las alertas activadas. Si se autoriza después, subir y desplegar el commit con ambos MP3 incluidos. Mantener las comprobaciones manuales pendientes del tablero.

# Ahora (handoff)

Actualizado: 2026-10-26 · agente saliente: Codex. Historia en Git y fichas.

## Punto de retomada

**Audios de avisos para mozo y cocina (M):** implementación `1de1e22`, integrada por fast-forward y subida a `main`. El usuario aportó dos MP3 en `public` y autorizó después el push y staging. Se usa `notificacion.mp3` para llamados y platos nuevos, y `notificacion-plato-listo.mp3` cuando al pedido no le quedan platos pendientes de cocina. Alcance, decisiones y evidencia en la [ficha](cambios/audios-notificaciones.md). El cambio conserva los avisos visuales por plato y las preferencias de alertas del dispositivo. Falta escucha manual en los dispositivos del usuario, con sesión real y las alertas activadas.

Los dos MP3 pasan a formar parte del incremento porque ahora el usuario autorizó expresamente su uso. No modificarlos ni reemplazarlos por sonidos generados. `tools/escenarios-locales.mjs` sigue ajeno y sin seguimiento.

**Staging está en Fly v65**, imagen `audios-1de1e22-git`, construida desde un snapshot Git de `1de1e22` en una carpeta temporal fuera del repositorio. La migración más reciente sigue siendo `20261209100000`: este despliegue no modificó la base ni los secretos. Rollback: imagen `propina-83c488d-git` (v64), sin cambios de base. La propina sigue disponible; su [ficha](cambios/propina-sugerida.md) conserva la evidencia y queda pendiente su comprobación manual por el usuario.

**Personal por sucursal, solo pantalla:** también espera comprobación manual; ver [ficha](cambios/personal-por-sucursal.md). La restricción real por RLS está en Backlog: hoy las asignaciones filtran pantallas, sin impedir llamadas directas entre sucursales de la organización.

## Límites y bloqueos

Producción continúa bloqueada por revisión legal y preparación operativa; ver [ficha legal](cambios/informacion-alimentaria-y-textos-legales.md). Siguen abiertas etiquetas por sucursal, alergias en observaciones y limpieza de `rate_key`. Usar snapshot Git para desplegar. RLS y E2E comparten base local y deben ejecutarse separados. Siguiente migración libre: `20261210100000`; este cambio no necesita esquema nuevo.

## Próximo paso

Recargar staging y escuchar los avisos en los dispositivos del usuario, con las alertas activadas: plato parcial, último plato listo y silencio. Mantener las comprobaciones manuales pendientes de propina y personal del tablero.

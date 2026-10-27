# Ahora (handoff)

Actualizado: 2026-10-27 · agente saliente: Codex. Historia en Git y fichas.

## Punto de retomada

**Acciones del pedido desde Mesas (M):** implementado en `d146c2e` sobre `main`, desplegado en staging con autorización del usuario. Alcance, aceptación y evidencia en la [ficha](cambios/acciones-pedido-desde-mesas.md). Mesas ofrece «Cerrar o anular pedido…» en tarjetas y filas con pedido. Abre la confirmación existente desde el detalle, con datos frescos; no ejecuta operaciones al navegar. El detalle agrega «Anotar plato» junto a «Volver a mesas» y conserva el acceso inferior. El cierre sale de la barra inferior; queda disponible en el detalle para los casos excepcionales descritos en la ficha. No cambian reglas de negocio ni permisos.

Falta comprobación manual con sesión real. El botón verde «Volver a mesas», implementado antes en `300a9d7`, también está en staging. Sin push a origin. Preservar `tools/escenarios-locales.mjs`, ajeno y sin seguimiento; no incluirlo en snapshots ni commits.

**Audios de avisos para mozo y cocina (M):** implementación `1de1e22`, integrada y subida a `main`. Alcance y evidencia en la [ficha](cambios/audios-notificaciones.md). Falta escucha manual en los dispositivos del usuario, con sesión real y las alertas activadas.

Conservar los MP3 aportados por el usuario.

**Staging está en Fly v67**, imagen `pedidos-d146c2e-git`, desde snapshot Git de `d146c2e`. Sin cambios de base ni secretos. Migración más reciente: `20261209100000`. Rollback: imagen `mesas-300a9d7-git` (v66). La [propina](cambios/propina-sugerida.md) espera comprobación manual.

**Personal por sucursal, solo pantalla:** también espera comprobación manual; ver [ficha](cambios/personal-por-sucursal.md). La restricción real por RLS está en Backlog: hoy las asignaciones filtran pantallas, sin impedir llamadas directas entre sucursales de la organización.

## Límites y bloqueos

Producción continúa bloqueada por revisión legal y preparación operativa; ver [ficha legal](cambios/informacion-alimentaria-y-textos-legales.md). Siguen abiertas etiquetas por sucursal, alergias en observaciones y limpieza de `rate_key`. Usar snapshot Git para desplegar. RLS y E2E comparten base local y deben ejecutarse separados. Siguiente migración libre: `20261210100000`; este cambio no necesita esquema nuevo.

## Próximo paso

Recargar staging y comprobar cierre desde Mesas y ambos accesos de anotar, con sesión de mozo. Mantener las comprobaciones de audios, propina y personal del tablero. Producción sigue fuera del alcance autorizado.

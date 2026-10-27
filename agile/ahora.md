# Ahora (handoff)

Actualizado: 2026-10-27 · agente saliente: Codex. Historia en Git y fichas.

## Punto de retomada

**Ajustes visuales (S):** diff local sobre `main`, desde `28ffabc`, todavía sin desplegar. Se elimina «Anotar plato» del encabezado; se conserva en la barra inferior. «Cerrar o anular pedido…» usa fondo rojo y texto blanco en tarjetas, filas y detalle, reutilizando el estilo de peligro. El E2E existente comprueba un único acceso de anotación. Evidencia en el apartado posterior de la [ficha](cambios/acciones-pedido-desde-mesas.md).

**Acciones del pedido desde Mesas (M):** implementado en `d146c2e`, desplegado en staging con autorización del usuario. Alcance y aceptación en la misma ficha. Mesas ofrece «Cerrar o anular pedido…» en tarjetas y filas con pedido. Abre la confirmación existente desde el detalle, con datos frescos; no ejecuta operaciones al navegar. El cierre sale de la barra inferior; queda disponible en el detalle para los casos excepcionales descritos en la ficha. No cambian reglas de negocio ni permisos.

Sin push a origin. Preservar `tools/escenarios-locales.mjs`, ajeno y sin seguimiento; excluirlo de snapshots y commits.

**Audios de avisos para mozo y cocina (M):** implementación `1de1e22`, integrada y subida a `main`. Alcance y evidencia en la [ficha](cambios/audios-notificaciones.md). Falta escucha manual en los dispositivos del usuario, con sesión real y las alertas activadas.

Conservar los MP3 aportados por el usuario.

**Staging está en Fly v67**, imagen `pedidos-d146c2e-git`, desde snapshot Git de `d146c2e`. Sin cambios de base ni secretos. Migración más reciente: `20261209100000`. Rollback: imagen `mesas-300a9d7-git` (v66). La [propina](cambios/propina-sugerida.md) espera comprobación manual.

**Personal por sucursal, solo pantalla:** también espera comprobación manual; ver [ficha](cambios/personal-por-sucursal.md). La restricción real por RLS está en Backlog: hoy las asignaciones filtran pantallas, sin impedir llamadas directas entre sucursales de la organización.

## Límites y bloqueos

Producción continúa bloqueada por revisión legal y preparación operativa; ver [ficha legal](cambios/informacion-alimentaria-y-textos-legales.md). Siguen abiertas etiquetas por sucursal, alergias en observaciones y limpieza de `rate_key`. Usar snapshot Git para desplegar. RLS y E2E comparten base local y deben ejecutarse separados. Siguiente migración libre: `20261210100000`; este cambio no necesita esquema nuevo.

## Próximo paso

Publicar el ajuste S cuando el usuario autorice. Comprobar cierre desde Mesas y el único acceso de anotar. Mantener las comprobaciones de audios, propina y personal. Producción sigue fuera del alcance autorizado.

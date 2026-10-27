# Ahora (handoff)

Actualizado: 2026-10-26 · agente saliente: Codex. Historia en Git y fichas.

## Punto de retomada

**Volver a mesas (S):** commit local `300a9d7` sobre `main`, desplegado en staging con autorización del usuario. En `src/app/sala/[org]/mesas/[mesa]/anotar/anotar-screen.tsx`, el enlace «← Mesas» ahora es un botón verde «Volver a mesas», con flecha SVG y altura mínima de 48 px. Conserva destino y navegación. Evidencia sobre ese commit: lint focalizado y typecheck correctos; build y tipos en Docker correctos. HTTP: inicio y login 200; sala sin sesión 307 y sondeo 401. El bundle publicado responde 200 y contiene el texto y tamaño nuevos. Falta comprobación visual con sesión de mozo; no se ejecutaron RLS ni E2E para este ajuste de presentación.

**Audios de avisos para mozo y cocina (M):** implementación `1de1e22`, integrada y subida a `main`. Alcance y evidencia en la [ficha](cambios/audios-notificaciones.md). Falta escucha manual en los dispositivos del usuario, con sesión real y las alertas activadas.

Conservar los MP3 aportados por el usuario. `tools/escenarios-locales.mjs` sigue ajeno y sin seguimiento.

**Staging está en Fly v66**, imagen `mesas-300a9d7-git`, desde snapshot Git de `300a9d7`: máquina started, control passing, smoke y DNS correctos. Sin cambios de base ni secretos. Migración más reciente: `20261209100000`. Rollback: imagen `audios-1de1e22-git` (v65). La [propina](cambios/propina-sugerida.md) espera comprobación manual.

**Personal por sucursal, solo pantalla:** también espera comprobación manual; ver [ficha](cambios/personal-por-sucursal.md). La restricción real por RLS está en Backlog: hoy las asignaciones filtran pantallas, sin impedir llamadas directas entre sucursales de la organización.

## Límites y bloqueos

Producción continúa bloqueada por revisión legal y preparación operativa; ver [ficha legal](cambios/informacion-alimentaria-y-textos-legales.md). Siguen abiertas etiquetas por sucursal, alergias en observaciones y limpieza de `rate_key`. Usar snapshot Git para desplegar. RLS y E2E comparten base local y deben ejecutarse separados. Siguiente migración libre: `20261210100000`; este cambio no necesita esquema nuevo.

## Próximo paso

Recargar staging y comprobar el botón de regreso en móvil y escritorio. El commit de interfaz sigue sin push a origin. Mantener las comprobaciones de audios, propina y personal del tablero.

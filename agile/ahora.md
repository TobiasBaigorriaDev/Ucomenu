# Ahora (handoff)

Actualizado: 2026-10-17 · agente saliente: Codex · historial anterior en `agile/historial.md`.

## Punto de retomada

Objetivo de esta sesión: subir el trabajo anterior y ejecutar los ensayos de restauración en un proyecto nuevo y Wake Lock del panel de sala. El push de `feat/revision-claude` hasta `3451851` terminó correctamente. Los ensayos se trabajaron en `chore/ensayo-restauracion-y-wake-lock`, desde ese commit. Ambas tareas están en «Hecho»; resultados y límites están en las fichas de [salida a producción](cambios/salida-a-produccion.md#ensayo-de-restauración-en-un-proyecto-nuevo-2026-10-17) y [panel de sala](cambios/panel-de-sala.md#ensayo-de-wake-lock-nativo-con-https-2026-10-17).

El usuario autorizó crear el destino de ensayo y eligió un recordatorio mensual, sin restauraciones automáticas. Se creó `ucomenu-restore-20261017` en el plan Free existente y se ensayó el respaldo remoto conservado fuera del repositorio. El staging compartido no recibió escrituras y el enlace original de Supabase se conservó. El proyecto de ensayo quedó pausado, estado `INACTIVE`; staging sigue `ACTIVE_HEALTHY`. Las credenciales nuevas se guardaron protegidas con DPAPI fuera de Git.

Wake Lock se probó mediante HTTPS local y Chrome aislado, sin cambiar la aplicación. Se eliminaron la organización local efímera, las cookies de ensayo y el certificado temporal, y se cerraron los servidores y navegadores usados. `tools/recordar-restauracion.ps1` queda como fuente del aviso mensual; la tarea instalada usa una copia en LocalAppData.

## Bloqueos y riesgos

Flyctl sigue bloqueado por Application Control de Windows; no se cambió esa política ni se desplegó nada. Producción y las pruebas físicas de pantalla, batería e iOS/Android siguen fuera de estos ensayos. La integración de revisiones todavía debe incorporarse a `main` antes de crear una rama desde allí.

El recordatorio requiere sesión de Windows iniciada; cada mes el responsable ejecuta el ensayo y registra la evidencia según `docs/operacion.md`.

## Próximo paso

Elegir otra tarea desbloqueada del backlog, conservando la configuración de revisiones al crear la próxima rama. La revisión automática de Claude continúa reservada a tareas críticas C.

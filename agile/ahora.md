# Ahora (handoff)

Actualizado: 2026-10-17 · agente saliente: Codex · historial anterior en `agile/historial.md`.

## Punto de retomada

Objetivo de esta sesión: explicar el procedimiento en ambos sentidos y reservar la skill de revisión de Claude a tareas críticas C, por pedido del usuario. Rama local `feat/revision-claude`, sobre la integración `1971975`; el ajuste actual solo modifica documentación y la skill. La [guía](../docs/revision-entre-agentes.md) explica quién implementa, quién revisa y cómo se verifican las correcciones. La [ficha](cambios/revision-claude-desde-codex.md) conserva aceptación y evidencia; el [ADR 0019](../docs/decisiones/0019-revision-claude-solo-criticas.md) acota el disparador del ADR anterior. El usuario sigue eligiendo al implementador.

La integración usa la instalación y autenticación existentes de Claude. No necesita instalar dependencias ni cambiar credenciales. La skill específica de Codex está en `.agents/skills/ciclo-revision-claude/SKILL.md`; las cuatro skills Agile compartidas conservan su sincronización habitual. Los informes quedan en `output/revisiones/`, ignorados por Git. La integración anterior de Claude hacia Codex sigue disponible.

Mientras se trabajaba apareció un commit externo: `d2a5446` actualizó este handoff con el avance de staging. Se conservó íntegramente ese commit y su información operativa; esta sesión no ejecutó operaciones remotas ni de base de datos.

## Bloqueos y riesgos

El estado heredado registra las migraciones aplicadas en staging y el código previo subido a origin. El despliegue de la app en Fly de staging seguía pendiente. Producción continúa bloqueada según la [ficha de salida](cambios/salida-a-produccion.md) y ADR 0015. No se verificó ese entorno durante esta sesión.

Siguen pendientes la comprobación en teléfono real y el posible rediseño de login, sala y cuenta. Los detalles del incremento de sucursales permanecen en su [ficha](cambios/desactivar-sucursales.md).

## Próximo paso

Continuar con el trabajo que el usuario elija; la skill de Claude se reserva a tareas críticas. Publicar la rama o desplegar requiere autorización. Si se retoma staging, revisar primero Git y la ficha de salida para confirmar qué quedó publicado desde la otra sesión.

# 0018 — Revisión cruzada automática entre Codex y Claude

- Estado: aceptada; el disparador general de Codex → Claude fue reemplazado por [ADR 0019](0019-revision-claude-solo-criticas.md). La integración técnica en ambos sentidos sigue vigente.
- Fecha: 2026-10-17.

## Decisión y motivos

Usar las CLI ya instaladas para la revisión en ambas direcciones. Claude → Codex conserva su integración; Codex → Claude usa un proceso nuevo no interactivo. Evita instalar un intermediario o copiar mensajes manualmente. Codex queda autorizado a pedir la revisión al terminar implementaciones verificadas.

El implementador sigue siendo el único escritor. Para Claude, el coordinador obtiene el diff con Git y el revisor solo dispone de herramientas de lectura; se desactivan personalizaciones, hooks y MCP para evitar ediciones indirectas y revisiones recursivas. No se comparte la conversación completa del implementador.

## Consecuencias

Cada revisión consume el uso de la cuenta local del revisor y requiere autenticación vigente. No es una conversación con una sesión de Claude ya abierta: cada pedido es independiente y las verificaciones reciben el informe anterior. Los errores no aprueban. Las rondas están acotadas y las operaciones peligrosas conservan aprobación humana.

La [skill](../../.agents/skills/ciclo-revision-claude/SKILL.md) describe el uso; la [ficha](../../agile/cambios/revision-claude-desde-codex.md) registra aceptación y evidencia.

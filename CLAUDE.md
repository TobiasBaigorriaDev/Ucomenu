# CLAUDE.md

@AGENTS.md

## Notas específicas para Claude Code
- Las reglas operativas viven en `AGENTS.md` (importado arriba). **No dupliques instrucciones acá**: lo común a ambos agentes va en `AGENTS.md`.
- Podés implementar y pedir revisión a Codex, o revisar lo que implementó Codex. El usuario elige el implementador; [procedimiento en ambos sentidos](docs/revision-entre-agentes.md).
- Las cuatro skills Agile están en `.claude/skills/` (copia de `.agents/skills/`; no las edites solo en una carpeta: `python tools/sincronizar_skills.py`). Las demás skills y plugins (Impeccable, etc.) no se sincronizan.
- Revisiones: en modo solo lectura (plan mode o permisos restrictivos) siempre que sea posible.
- Revisión de Codex automatizada: skill `ciclo-revision-codex` (`pnpm revision:codex --commit HEAD --ficha … --nivel C`, luego `--verificar --hallazgos <informe>`). Solo de Claude; no se sincroniza.
- Si Codex te invoca mediante `revision:claude`, sos el revisor: seguí el pedido de solo lectura y no inicies `ciclo-revision-codex` ni otro revisor.

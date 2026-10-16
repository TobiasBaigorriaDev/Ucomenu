# CLAUDE.md

@AGENTS.md

## Notas específicas para Claude Code
- Las reglas operativas viven en `AGENTS.md` (importado arriba). **No dupliques instrucciones acá**: lo común a ambos agentes va en `AGENTS.md`.
- Rol habitual (no exclusivo): explorar, definir problemas complejos y revisar. Podés también implementar si el usuario te lo pide.
- Las cuatro skills Agile están en `.claude/skills/` (copia de `.agents/skills/`; no las edites solo en una carpeta: `python tools/sincronizar_skills.py`). Las demás skills y plugins (Impeccable, etc.) no se sincronizan.
- Revisiones: en modo solo lectura (plan mode o permisos restrictivos) siempre que sea posible.

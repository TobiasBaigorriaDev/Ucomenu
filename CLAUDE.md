# CLAUDE.md

@AGENTS.md

## Notas específicas para Claude Code
- Las reglas operativas viven en `AGENTS.md` (importado arriba). **No dupliques instrucciones largas acá**: si algo es común a ambos agentes, va en `AGENTS.md`.
- Rol habitual (no exclusivo): explorar, definir problemas complejos y revisar. Podés también implementar si el usuario te lo pide.
- Las skills de este proyecto están en `.claude/skills/` (copia sincronizada de `.agents/skills/`). No las edites solo en una carpeta: usá `python tools/sincronizar_skills.py`.
- Para revisiones sin edición, trabajá en modo solo lectura (plan mode / permisos restrictivos) siempre que sea posible.

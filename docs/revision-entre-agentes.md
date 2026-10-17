# Implementar con un agente y revisar con el otro

El usuario puede elegir Codex o Claude como implementador. El otro agente revisa el cambio en solo lectura; los pedidos y los informes se transmiten mediante las CLI, sin copiar mensajes manualmente.

| Implementa y corrige | Revisa | Skill del implementador | Comando | Cuándo |
| --- | --- | --- | --- | --- |
| Codex | Claude Code | [ciclo-revision-claude](../.agents/skills/ciclo-revision-claude/SKILL.md) | `pnpm revision:claude` | Exclusivamente tareas críticas C |
| Claude Code | Codex CLI | [ciclo-revision-codex](../.claude/skills/ciclo-revision-codex/SKILL.md) | `pnpm revision:codex` | C; M solo con duda real o pedido del usuario |

Las consecuencias que definen C están en [AGENTS.md](../AGENTS.md#nivel-de-rigor-por-consecuencias). La skill de revisión de Claude no se activa para S/M ni para documentación sin consecuencias críticas. Las CLI conservan sus opciones de nivel para pruebas y pedidos manuales; eso no amplía el disparador de la skill.

## Procedimiento para una tarea crítica

1. El implementador termina el cambio, ejecuta las pruebas pertinentes y deja la ficha con aceptación, invariantes, fallos, recuperación y evidencia del alcance probado.
2. Suspende las ediciones e invoca al otro agente. Si implementó Codex:

   ```bash
   pnpm revision:claude --commit HEAD --ficha agile/cambios/<ficha>.md --nivel C
   ```

   Si implementó Claude, usa el mismo pedido con `pnpm revision:codex`. También se puede revisar una rama con `--base main` o los pendientes con `--uncommitted`.
3. Lee el informe de `output/revisiones/`: salida **0** aprobar, **1** aprobar con cambios, **2** rechazar, **3** error sin revisión válida. Cada pedido abre un proceso independiente; no conversa con otra sesión ya abierta.
4. Contrasta los hallazgos con el código y corrige los defectos confirmados. Después de comprobar las correcciones, agrega `--verificar --hallazgos output/revisiones/<informe-anterior>.md` al siguiente pedido. Máximo tres rondas; si persiste un desacuerdo, lo registra y consulta al usuario.
5. Registra el alcance, el veredicto y las correcciones en la ficha. La revisión no autoriza por sí misma operaciones peligrosas; se mantiene la aprobación humana exigida por `AGENTS.md`.

El implementador es siempre el único escritor. El revisor no edita ni invoca otro revisor. Las skills son específicas del implementador y no se copian entre `.agents/skills/` y `.claude/skills/`.

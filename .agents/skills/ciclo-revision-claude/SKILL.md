---
name: ciclo-revision-claude
description: Usar exclusivamente cuando Codex implementa una tarea crítica de nivel C y necesita revisión independiente de Claude Code con pnpm revision:claude. Incluye triage y verificación de correcciones en solo lectura. No activar para tareas S o M ni para documentación sin consecuencias críticas.
---

# ciclo-revision-claude

Codex es el único escritor. Claude revisa mediante CLI con Read/Glob/Grep; sin shell, edición, hooks, plugins ni MCP. Solo para sesiones implementadoras de Codex; un revisor no inicia otro ciclo.

## Activación: solo tareas críticas

Activar únicamente en **nivel C**, según las consecuencias definidas en `AGENTS.md`: autorización, exposición de información, dinero o eliminación irreversible. Evaluar el alcance real, no el tamaño del diff ni la cantidad de archivos. Si no está clara la clasificación, resolver el riesgo antes de iniciar el ciclo.

En **S y M no usar esta skill**. Un cambio ordinario, reversible o solo de documentación no dispara la revisión de Claude. El procedimiento en ambos sentidos está en [la guía](../../../docs/revision-entre-agentes.md).

## Ciclo

1. Confirmá que el cambio es C. Terminá la implementación y sus comprobaciones por impacto. Dejá la ficha con aceptación, invariantes, fallos, recuperación y evidencia. Pedí revisión automáticamente, sin nueva confirmación. Si el usuario indicó revisión manual u otro revisor, respetalo.
2. Suspendé las ediciones durante la revisión. Preferí un commit local; para pendientes usá `--uncommitted` (incluye staged y archivos nuevos). Ejecutá:

   ```bash
   pnpm revision:claude --commit HEAD --ficha agile/cambios/<ficha>.md --nivel C
   ```

   Mantené `--nivel C` y la ficha. Alternativas de alcance: `--base main`, `--uncommitted`. `--dry-run` muestra el pedido sin llamar a Claude. El comando tarda varios minutos: esperar su finalización sin editar el alcance.
3. Leé el informe en `output/revisiones/` y el código: **0** aprobar, **1** aprobar con cambios, **2** rechazar, **3** error sin revisión válida. Si falta Claude o la autenticación, informá el bloqueo; no instales ni cambies credenciales. Nunca interpretes un error como aprobación.
4. Contrastá cada hallazgo con el código y reproducilo o justificá por qué no aplica. Corregí defectos reales con las pruebas pertinentes; no apliques sugerencias de estilo por ritual.
5. Tras corregir y verificar, pedí una revisión acotada:

   ```bash
   pnpm revision:claude --commit HEAD --nivel C --ficha agile/cambios/<ficha>.md --verificar --hallazgos output/revisiones/<informe-anterior>.md
   ```

   Usá `--uncommitted` si las correcciones siguen sin commit. Máximo tres rondas totales; si no se resuelve, registrá el desacuerdo y consultá al usuario. No delegues implementación ni encadenes revisores.
6. Registrá en la ficha el alcance probado, hallazgos confirmados/descartados, informe y veredicto, sin copiarlo completo. El nivel C conserva aprobación humana antes de lo peligroso.

El script envía código a Claude usando la autenticación local existente. No usar con secretos o datos de clientes en el diff. Recorta contexto grande y lo declara; un recorte o la falta de pruebas deben figurar como límites del informe. `--salida` acepta un .md nuevo dentro de `output/revisiones/`; no pisa informes previos. `--timeout` limita a 25 minutos por defecto.

En Windows requiere la instalación nativa (`claude.exe` en PATH), como en este equipo. Un shim npm `.cmd` solo no es compatible con el lanzamiento sin shell; informá esa limitación sin instalar ni cambiar la configuración por tu cuenta. Las opciones se verificaron con Claude Code 2.1.296.

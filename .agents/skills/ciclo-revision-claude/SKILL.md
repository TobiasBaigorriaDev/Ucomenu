---
name: ciclo-revision-claude
description: Usar desde Codex al terminar una implementación para pedir automáticamente revisión independiente de Claude Code con pnpm revision:claude, evaluar hallazgos y verificar correcciones. Solo lectura; no reemplaza aprobación humana de operaciones críticas.
---

# ciclo-revision-claude

Codex es el único escritor. Claude revisa mediante CLI con Read/Glob/Grep; sin shell, edición, hooks, plugins ni MCP. Solo para sesiones implementadoras de Codex; un revisor no inicia otro ciclo.

1. Terminá la implementación y sus comprobaciones por impacto. Actualizá la ficha si corresponde. Por autorización del usuario, pedí revisión automática al cerrar implementaciones; documentación sola no la necesita, salvo pedido explícito. Si el usuario pide otro alcance o revisión manual, respetalo.
2. Suspendé las ediciones durante la revisión. Preferí un commit local; para pendientes usá `--uncommitted` (incluye staged y archivos nuevos). Ejecutá:

   ```bash
   pnpm revision:claude --commit HEAD --ficha agile/cambios/<ficha>.md --nivel M
   ```

   Ajustá el nivel S/M/C por consecuencias y omití `--ficha` en S. Alternativas: `--base main`, `--uncommitted`. `--dry-run` muestra el pedido sin llamar a Claude. El comando tarda varios minutos: esperar su finalización sin editar el alcance.
3. Leé el informe en `output/revisiones/` y el código: **0** aprobar, **1** aprobar con cambios, **2** rechazar, **3** error sin revisión válida. Si falta Claude o la autenticación, informá el bloqueo; no instales ni cambies credenciales. Nunca interpretes un error como aprobación.
4. Contrastá cada hallazgo con el código y reproducilo o justificá por qué no aplica. Corregí defectos reales con las pruebas pertinentes; no apliques sugerencias de estilo por ritual.
5. Tras corregir y verificar, pedí una revisión acotada:

   ```bash
   pnpm revision:claude --commit HEAD --nivel M --ficha agile/cambios/<ficha>.md --verificar --hallazgos output/revisiones/<informe-anterior>.md
   ```

   Usá `--uncommitted` si las correcciones siguen sin commit. Máximo tres rondas totales; si no se resuelve, registrá el desacuerdo y consultá al usuario. No delegues implementación ni encadenes revisores.
6. Registrá en la ficha el alcance probado, hallazgos confirmados/descartados, informe y veredicto, sin copiarlo completo. El nivel C conserva aprobación humana antes de lo peligroso.

El script envía código a Claude usando la autenticación local existente. No usar con secretos o datos de clientes en el diff. Recorta contexto grande y lo declara; un recorte o la falta de pruebas deben figurar como límites del informe. `--salida` acepta un .md nuevo dentro de `output/revisiones/`; no pisa informes previos. `--timeout` limita a 25 minutos por defecto.

En Windows requiere la instalación nativa (`claude.exe` en PATH), como en este equipo. Un shim npm `.cmd` solo no es compatible con el lanzamiento sin shell; informá esa limitación sin instalar ni cambiar la configuración por tu cuenta. Las opciones se verificaron con Claude Code 2.1.296.

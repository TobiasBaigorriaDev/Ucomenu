# Revisión automática de Claude desde Codex

Nivel M · 2026-10-17 · solicitado por el usuario.

Motivos duraderos: [ADR 0018](../../docs/decisiones/0018-revision-cruzada-automatica.md); alcance posterior de la skill: [ADR 0019](../../docs/decisiones/0019-revision-claude-solo-criticas.md). Uso en ambos sentidos: [guía](../../docs/revision-entre-agentes.md).

## Decisiones y aceptación

- Completar la integración existente Claude → Codex con `pnpm revision:claude`: commit, rama contra base o pendientes (staged, sin stage y nuevos), ficha opcional y nivel S/M/C.
- Por ajuste posterior del usuario, `ciclo-revision-claude` pide revisión automáticamente solo tras implementar y verificar tareas críticas C; no se activa en S/M. Un único escritor; Claude solo lee, no delega ni modifica código, datos, memoria o handoff.
- CLI existente y autenticación local, sin dependencias nuevas ni cambios de credenciales. El coordinador adjunta el diff; Claude dispone solo de Read/Glob/Grep, sin hooks/plugins/MCP ni shell.
- Informe local ignorado por Git; mismos códigos 0/1/2/3 que `revision:codex`. Fallo del proceso, timeout, JSON de error o falta de veredicto nunca aprueban; no reutilizar salidas anteriores.
- Verificación de hallazgos con `--verificar --hallazgos`; máximo tres rondas. Permisos del producto y aprobación humana C sin cambios.

## Evidencia

Diff local en `feat/revision-claude`; base actual `d2a5446`. Durante la sesión, otro implementador agregó ese commit de handoff sobre `538547f`; se conserva, sin cambios a sus operaciones de staging.

- `pnpm test tests/unit/revision-claude.test.ts tests/unit/revision-codex.test.ts`: 44/44 pruebas tras las correcciones, incluidas respuestas erróneas/incompletas, salida anterior, verificación, transporte/timeout y alcances Git con renombrados.
- `pnpm exec eslint tools/revision-claude.mjs tests/unit/revision-claude.test.ts`: OK.
- `pnpm revision:claude --commit HEAD --nivel S --dry-run`: OK, sin invocar el servicio.
- `python C:/Users/tobib/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/ciclo-revision-claude`: skill válida.
- Revisión real mediante `pnpm revision:claude --uncommitted --ficha agile/cambios/revision-claude-desde-codex.md --nivel M --salida output/revisiones/claude-integracion-r1.md`: CLI nativa 2.1.296, respuesta JSON success, informe en español recibido; salida 1 «APROBAR CON CAMBIOS». Sin permisos de comandos/edición ni solicitudes manuales.
- Triage: corregida omisión del borrado en renombrados (`--no-renames` y regresión); sustituida prueba débil de opción inválida por transporte con proceso Node falso, timeout real y ejecutable ausente. Limitación de shim npm en Windows documentada; HEAD discrepante se debió al commit externo, no al revisor.
- Segunda ronda real: mismo comando con `--verificar --hallazgos output/revisiones/claude-integracion-r1.md --salida output/revisiones/claude-integracion-r2.md`: salida 0, «VEREDICTO: APROBAR», sin hallazgos; verificó las correcciones y sus regresiones. Revisión estática: Claude no ejecutó las pruebas, las ejecutó Codex como coordinador.
- `python tools/sincronizar_skills.py --check`: cuatro skills Agile sincronizadas; la nueva skill es exclusiva de Codex.
- `git diff --check` y lectura de archivos nuevos/diff: OK. Tras la revisión solo se cerró la documentación de evidencia, tablero y handoff.
- Sin build/RLS/E2E: herramientas de desarrollo y metodología; no cambia Next.js ni base de datos.

## Recuperación

Revertir `tools/revision-claude.mjs`, su prueba, la skill `ciclo-revision-claude`, el comando de package.json y los cambios de reglas/documentación de esta ficha. No hay migraciones ni cambios de producto. Los informes se conservan en output/revisiones.

## Ajuste documental posterior: solo tareas críticas

Diff sobre `1971975`, por pedido del usuario: guía del procedimiento en ambos sentidos; activación de la skill limitada a C en descripción, instrucciones y ejemplos; reglas de entrada y ADR actualizados. Sin cambios de código ni de CLI.

Validación del ajuste: `quick_validate.py .agents/skills/ciclo-revision-claude` OK; `python tools/sincronizar_skills.py --check` OK; 39 enlaces Markdown locales comprobados en diez archivos, sin destinos faltantes; `git diff --check` OK. Índice local de skills regenerado (83 entradas, nueve duplicadas omitidas). Sin suites unitarias, build, RLS, E2E ni otra revisión de Claude: cambio exclusivamente documental y de metodología.

## Límites

Requiere CLI nativa de Claude en Windows. El timeout detiene el proceso principal; no garantiza terminar subprocesos de búsqueda que ya hubiera lanzado. Las revisiones leen código y evidencia; no ejecutan suites. Opciones de CLI contrastadas con `claude --help` 2.1.296 y [la referencia oficial](https://code.claude.com/docs/en/cli-reference); descubrimiento de skills contrastado con [OpenAI Docs](https://learn.chatgpt.com/docs/build-skills).

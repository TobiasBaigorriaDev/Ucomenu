# UcoMenu — Agile SDD 1.1.1

SaaS multi-tenant de **menú digital interactivo** para restaurantes, bares y cafeterías: carta por QR de mesa, llamado al mozo en tiempo real y, en niveles superiores, platos en realidad aumentada y fidelización con Apple/Google Wallet. Detalle en `docs/producto.md` y `docs/arquitectura.md`.

Proyecto creado con la plantilla **Agile SDD 1.1.1**: desarrollo guiado por especificaciones vivas, en iteraciones pequeñas y verificables, con Codex CLI y Claude Code elegidos manualmente.

## Cómo empezar
1. Completá `docs/producto.md` y `docs/arquitectura.md` (idealmente explorando con Claude Code + `agile-explorar`).
2. Completá la sección **Comandos del proyecto** de `AGENTS.md`.
3. Elegí un incremento pequeño y verificable y trabajalo con `agile-iterar` (Codex o Claude).
4. Revisá según el nivel de riesgo (`agile-revisar`).
5. Cerrá cada sesión actualizando `agile/ahora.md`.

## Estructura
| Ruta | Para qué sirve |
| --- | --- |
| `AGENTS.md` | Reglas compartidas, cortas. Comandos reales del proyecto |
| `CLAUDE.md` | Entrada para Claude Code (importa `AGENTS.md`) |
| `docs/producto.md` | Qué se construye y para quién |
| `docs/arquitectura.md` | Stack, módulos, datos, contratos, riesgos |
| `docs/decisiones/` | ADR breves de decisiones duraderas |
| `agile/tablero.md` | Backlog flexible (sin orden obligatorio) |
| `agile/ahora.md` | Handoff entre sesiones y agentes |
| `agile/cambios/` | Fichas vivas por cambio (M y C; S no requiere) |
| `agile/herramientas-aprobadas.md` | Skills/herramientas externas aprobadas |
| `memoria/README.md` | Política de memoria opcional (Engram) |
| `prompts/ejemplos.md` | Prompts sugeridos |
| `.agents/skills/`, `.claude/skills/` | Las 4 skills (copias sincronizadas) |
| `tools/sincronizar_skills.py` | Mantiene ambas carpetas de skills iguales |

## Principios en una línea
Iterativo · backlog flexible · especificaciones vivas · rigor proporcional (S/M/C) · entregas verticales · evidencia antes de «terminado» · Git y docs como fuente de verdad · una tarea principal por worktree · skills externas solo con aprobación.

## Comprobar skills sincronizadas
```powershell
python tools/sincronizar_skills.py --check
```
Edita siempre en `.agents/skills/` y luego ejecutá el script sin `--check` para copiar a `.claude/skills/`.

## Documentos de apoyo
La distribución original del kit incluye una carpeta `referencias/` con una guía de versión, un ejemplo ficticio de venta y una nota de OpenSpec. **No se copian a cada proyecto** para evitar confundir al agente con requisitos ajenos. Si necesitás un ejemplo, abrilo desde el kit maestro.

Las fichas reales se crean bajo `agile/cambios/` a partir de `agile/cambios/_plantilla.md`.

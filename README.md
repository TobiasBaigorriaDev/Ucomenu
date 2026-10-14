# UcoMenu — Agile SDD 1.1.1

SaaS multi-tenant de **menú digital interactivo** para restaurantes, bares y cafeterías: carta por QR de mesa, llamado al mozo en tiempo real y, en niveles superiores, platos en realidad aumentada y fidelización con Apple/Google Wallet. Detalle en `docs/producto.md` y `docs/arquitectura.md`.

Proyecto creado con la plantilla **Agile SDD 1.1.1**: desarrollo guiado por especificaciones vivas, en iteraciones pequeñas y verificables, con Codex CLI y Claude Code elegidos manualmente.

## Cómo trabajar
1. Leé `AGENTS.md` y `agile/ahora.md` (en qué quedó la última sesión y cuál es el próximo paso).
2. Elegí un incremento pequeño y verificable del `agile/tablero.md` y trabajalo con `agile-iterar` (Codex o Claude); si el tema no está claro, `agile-explorar` primero.
3. Revisá según el nivel de riesgo (`agile-revisar`); en el nivel C la revisión la hace el otro agente, en solo lectura.
4. Cerrá cada sesión actualizando `agile/ahora.md`.

**Estado (2026-10-14):** carta pública con RLS; multi-tenant con membresías y roles; planes, mora derivada y límites aplicados en la base. Sigue «Acceso del personal» (login y paneles). Detalle en `agile/tablero.md`.

## Desarrollo local
Requisitos: Node 24, pnpm y Docker encendido.
```powershell
pnpm install --frozen-lockfile
pnpm db:start        # Supabase local (primera vez: descarga imágenes de Docker)
pnpm db:reset        # aplica migraciones + datos semilla ficticios
# Copiá .env.example a .env.local y completá la clave con: pnpm exec supabase status -o env
pnpm dev             # http://localhost:3000/m/cafe-ejemplo/centro
```
Cartas de ejemplo del seed: `/m/cafe-ejemplo/centro`, `/m/parrilla-demo/sur` y `/m/resto-moroso/unica` (cuenta suspendida por mora: muestra «Carta temporalmente no disponible»).

Pruebas, lint y demás comandos: sección **Comandos del proyecto** de `AGENTS.md`. Las pruebas de RLS necesitan Docker encendido y la base reseteada (`pnpm db:reset`).

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

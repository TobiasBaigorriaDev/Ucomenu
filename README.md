# UcoMenu — Agile SDD 1.1.1

SaaS multi-tenant de **menú digital interactivo** para restaurantes, bares y cafeterías: carta por QR de mesa, llamado al mozo en tiempo real y, en niveles superiores, platos en realidad aumentada y fidelización con Apple/Google Wallet. Detalle en `docs/producto.md` y `docs/arquitectura.md`.

Proyecto creado con la plantilla **Agile SDD 1.1.1**: desarrollo guiado por especificaciones vivas, en iteraciones pequeñas y verificables, con Codex CLI y Claude Code elegidos manualmente.

El procedimiento de [implementación y revisión funciona en ambos sentidos](docs/revision-entre-agentes.md): Claude puede implementar y Codex revisar, o Codex implementar y Claude revisar. La skill de revisión automática de Claude se reserva a tareas críticas de nivel C.

## Cómo trabajar
1. Leé `AGENTS.md` y `agile/ahora.md` (en qué quedó la última sesión y cuál es el próximo paso).
2. Elegí un incremento pequeño y verificable del `agile/tablero.md` y trabajalo con `agile-iterar` (Codex o Claude); si el tema no está claro, `agile-explorar` primero.
3. El rigor se define por consecuencias (S, M o C; tabla en `AGENTS.md`). En el nivel C hace falta una revisión independiente en solo lectura (`agile-revisar`).
4. Cerrá cada sesión reescribiendo `agile/ahora.md` (una pantalla).

El estado actual del producto no se repite acá: está en `agile/tablero.md`, `agile/ahora.md` y Git.

## Desarrollo local
Requisitos: Node 24, pnpm y Docker encendido.
```powershell
pnpm install --frozen-lockfile
pnpm db:start        # Supabase local (primera vez: descarga imágenes de Docker)
pnpm db:reset        # aplica migraciones + datos semilla ficticios
# Copiá .env.example a .env.local y completá la clave con: pnpm exec supabase status -o env
pnpm dev             # http://localhost:3000/m/cafe-ejemplo/centro
pnpm db:demo         # opcional: demo completa (más platos, fotos y logo) en cafe-ejemplo y parrilla-demo
```
Cartas de ejemplo del seed: `/m/cafe-ejemplo/centro`, `/m/parrilla-demo/sur` y `/m/resto-moroso/unica` (cuenta suspendida por mora: muestra «Carta temporalmente no disponible»).

La demo completa (`pnpm db:demo`, solo local; necesita internet la primera vez para bajar las fotos) sirve para ver y diseñar la carta con material real; `pnpm db:demo --quitar` la deshace; `--sin-fotos` y `--sin-logo` (combinables) cargan la misma carta sin imágenes para ver el peor caso de un local chico. La demo pasa ambos locales al plan Pro para que se vean los botones de llamado en la carta de mesa: `/t/c0ffee01000000000000000000000000` (Café Ejemplo) y `/t/fa11a001000000000000000000000000` (Parrilla Demo). **Antes de correr RLS o E2E, volvé al seed limpio** con `pnpm db:reset` (o `pnpm db:demo --quitar`): las pruebas asumen esos datos. La carta pública cachea hasta 60 s, así que un cambio hecho directo en la base tarda ese tiempo en verse.

Pruebas, lint y demás comandos: sección **Comandos del proyecto** de `AGENTS.md`. Las pruebas de RLS necesitan Docker encendido y la base reseteada (`pnpm db:reset`).

## Estructura
| Ruta | Para qué sirve |
| --- | --- |
| `AGENTS.md` | Reglas compartidas, cortas. Comandos reales del proyecto |
| `CLAUDE.md` | Entrada para Claude Code (importa `AGENTS.md`) |
| `docs/producto.md` | Qué se construye y para quién |
| `docs/arquitectura.md` | Stack, módulos, datos, contratos, riesgos |
| `docs/decisiones/` | ADR breves de decisiones duraderas |
| `docs/produccion.md` | Procedimiento de salida a producción con sus aprobaciones (`pnpm prod:check` revisa las variables de entorno) |
| `Dockerfile`, `fly.toml`, `fly.staging.toml` | Imagen de producción (Next.js `standalone`) y plantillas de Fly.io (no validadas con `fly`) |
| `docs/operacion.md` | Entornos, respaldos (`pnpm respaldo`), seguimiento del consumo y criterios para subir de plan |
| `agile/tablero.md` | Backlog flexible: prioridad, estado breve y enlace a la ficha |
| `agile/ahora.md` | Handoff: punto de retomada, bloqueos y próximo paso (una pantalla) |
| `agile/historial.md` | Archivo del handoff anterior y recetas locales; no se lee al empezar |
| `agile/cambios/` | Fichas por cambio (M y C; S no requiere): aceptación, decisiones y evidencia |
| `agile/herramientas-aprobadas.md` | Skills/herramientas externas aprobadas |
| `memoria/README.md` | Política de memoria opcional (Engram) |
| `prompts/ejemplos.md` | Prompts sugeridos |
| `.agents/skills/`, `.claude/skills/` | Las 4 skills Agile (copias sincronizadas; Impeccable y otros plugins quedan fuera) |
| `tools/sincronizar_skills.py` | Mantiene iguales las 4 skills Agile en ambas carpetas |

## Principios en una línea
Iterativo · backlog flexible · especificaciones vivas · rigor por consecuencias (S/M/C) · pruebas por impacto · entregas verticales · evidencia antes de «terminado» · una función por documento · un escritor por worktree · skills externas solo con aprobación.

## Comprobar skills sincronizadas
```powershell
python tools/sincronizar_skills.py --check
```
Editá las cuatro skills Agile en `.agents/skills/` y ejecutá el script sin `--check` para copiarlas a `.claude/skills/`.

## Documentos de apoyo
La distribución original del kit incluye una carpeta `referencias/` con una guía de versión, un ejemplo ficticio de venta y una nota de OpenSpec. **No se copian a cada proyecto** para evitar confundir al agente con requisitos ajenos. Si necesitás un ejemplo, abrilo desde el kit maestro.

Las fichas reales se crean bajo `agile/cambios/` a partir de `agile/cambios/_plantilla.md`.

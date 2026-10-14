# Trabajo en paralelo: dos pares de agentes con Git Worktrees

Cada *worktree* lo usa un par de agentes con **roles intercambiables**: uno **implementa** (escribe) y el otro **audita** (solo lectura). Puede ser Claude Code + Codex o al revés, y se elige por *worktree* y por tarea. Una sola tarea principal por *worktree* y **un solo escritor a la vez** (`AGENTS.md`). Procedimiento de la sesión del 2026-10-14.

## Roles intercambiables

Lo que cambia es solo cómo se abre cada agente en la ruta del *worktree* (el resto del procedimiento es idéntico):

| Rol | Claude Code | Codex |
| --- | --- | --- |
| **Implementa** | `claude` (modo normal, con edición) | `codex -C <ruta> -s workspace-write` |
| **Audita (solo lectura)** | `claude --permission-mode plan` | `codex -C <ruta> -s read-only` |

- Elegí una combinación por *worktree*; pueden ser opuestas (A: Claude implementa y Codex audita; B: al revés).
- Skills: las dos carpetas (`.claude/skills` y `.agents/skills`) están sincronizadas. En Codex invocalas mencionándolas (p. ej. `$agile-iterar`; confirmá con `/skills`). Implementa: `/agile-explorar` → `/agile-iterar`. Audita: `/agile-revisar` sobre un SHA.
- **Cambiar los roles en medio de una tarea:** el implementador commitea y deja la ficha (`agile/cambios/<tema>.md`, sección de estado) al día; el otro agente pasa a escritor solo cuando el primero lo suelta. El *handoff* de un *worktree* A/B vive en su ficha, no en `agile/ahora.md` (ver reglas).
- Si **Codex implementa**: el sandbox `workspace-write` puede no alcanzar Docker ni la red (en esta máquina Docker respondió solo fuera del sandbox). Las pruebas de RLS y E2E (y `supabase-aislado`) piden aprobación fuera del sandbox o las corre el auditor/usuario. Si **Claude audita** en modo `plan`, tampoco ejecuta nada que escriba.

## Mapa

| | Ruta | Rama | Supabase (proyecto · API / DB) | `pnpm dev` | E2E (`E2E_PORT`) |
| --- | --- | --- | --- | --- | --- |
| **main** | el checkout original | `main` | `ucomenu` · 54321 / 54322 | 3000 | 3100 |
| **A** | `C:\dev\ucomenu-worktrees\a-<tema>` | `feat/<tema>` | `ucomenu-wt-a` · 56121 / 56122 | 3001 | 3101 |
| **B** | `C:\dev\ucomenu-worktrees\b-<tema>` | `feat/<tema>` | `ucomenu-wt-b` · 56221 / 56222 | 3002 | 3102 |

Solo `main` usa la pila compartida (`pnpm db:*`). Quien integra es `main`.

## Crear un *worktree* (ranura A como ejemplo)

```powershell
herdr worktree create --branch feat/<tema> --base main --path C:\dev\ucomenu-worktrees\a-<tema> --label "A <tema>"
cd C:\dev\ucomenu-worktrees\a-<tema>
pnpm install --frozen-lockfile
node tools/supabase-aislado.mjs a start      # pila propia; imprime URL, contenedor y variables
node tools/supabase-aislado.mjs a reset      # migraciones + seed de ESTE worktree
```

Después:
1. `.env.local` y `.env.test.local` **propios** (no se versionan): copiá los de `main` y cambiá solo `NEXT_PUBLIC_SUPABASE_URL` a `http://127.0.0.1:<API>`. La clave local es la misma.
2. En el panel donde se corran pruebas: `$env:SUPABASE_DB_CONTAINER = "supabase_db_ucomenu-wt-a"` y `$env:E2E_PORT = "3101"` (`node tools/supabase-aislado.mjs a env` las imprime).
3. Paneles de Herdr: un agente que implementa y otro que audita en solo lectura, ambos en la misma ruta (ver «Roles intercambiables»).

No se heredan (están ignorados por Git): `node_modules`, `.env*`, `.claude/settings.local.json` y la skill `impeccable`. Copiarlos a mano solo si se aprueba.

## Reglas de aislamiento

- **Nunca `pnpm db:start`, `db:reset` ni `db:stop` en un *worktree* A/B**: apuntan a la pila compartida (`ucomenu`). Usar `tools/supabase-aislado.mjs`.
- **Nunca correr RLS sin `SUPABASE_DB_CONTAINER`**: por defecto usan `supabase_db_ucomenu` (la base de `main`).
- `NEXT_PUBLIC_*` se fija al compilar: si cambia `.env.local`, `pnpm build` de nuevo.
- Las cookies de sesión no se aíslan por puerto: abrir A en `localhost` y B en `127.0.0.1`, o usar perfiles de navegador distintos.
- Migraciones: **un solo dueño del esquema por tanda**. Quien migra regenera `database.types.ts`; la otra rama hace `git merge main` antes de integrar.
- Cada rama escribe solo **su ficha** en `agile/cambios/`. `agile/tablero.md` y `agile/ahora.md` se actualizan en `main` al integrar.
- Correr E2E de a una suite por vez (tres pilas Supabase más Next consumen mucha memoria).

## Verificar el directorio de cada par

Primer comando de cada agente, antes de editar:

```
git rev-parse --show-toplevel ; git branch --show-current ; echo $env:SUPABASE_DB_CONTAINER
```

Desde fuera: `herdr agent list` y `herdr pane process-info`; `docker ps` debe mostrar una pila por ranura.

## Auditoría

1. Claude commitea un incremento y le pasa a Codex el **SHA**.
2. Codex revisa ese SHA fijo (`/agile-revisar`, solo lectura, una ronda normal).
3. El auditor en solo lectura no puede correr `build`, RLS ni E2E (escriben `.next` y usan Docker): las corre Claude y deja la evidencia en la ficha.

## Integración a `main`

1. Codex aprueba un SHA concreto.
2. En la rama: `git merge main` y repetir las pruebas completas en su pila aislada (obligatorio para la segunda rama que entre).
3. En el *worktree* de `main`, con orden del usuario: merge (*squash*) o `--ff-only`; luego `pnpm db:reset` y las suites contra la base compartida, sin otras corriendo.
4. Actualizar `tablero.md`, `ahora.md` y la ficha en `main`. `push` solo si el usuario lo pide.
5. Limpieza: `herdr worktree remove`, `git branch -d`, `node tools/supabase-aislado.mjs <a|b> stop`, `git worktree prune`.

## Siguiente tarea en el mismo par

`/clear` solo vacía la conversación de **ese** agente: no cambia la carpeta, la rama ni las variables del panel. Lo que no esté en commits, en la ficha o en `agile/` se pierde.

1. **Cerrar la tarea:** *worktree* limpio (`git status`), commit hecho, ficha al día, SHA aprobado por el auditor e integración a `main` hecha (sección anterior) o rama aparcada a propósito.
2. **Reiniciar los dos agentes:** `/clear` en Claude y `/new` en Codex (o `/clear` según tu versión; mirá `/help`). El auditor también debe empezar limpio para no arrastrar la tarea anterior.
3. **Elegir la tarea la persona, no los agentes:** que cada *worktree* tenga una distinta. Anotala en `agile/tablero.md` de `main` («En curso: A — …, B — …») para que el otro par no tome la misma.
4. **Rama nueva desde `main` actualizado**, en el mismo *worktree* y solo si la anterior ya entró a `main`:
   ```powershell
   git switch -c feat/<tema-nuevo> main
   pnpm install --frozen-lockfile                  # solo si cambió pnpm-lock.yaml
   node tools/supabase-aislado.mjs <a|b> reset     # migraciones y seed de main
   ```
   Con ramas viejas ya integradas: `git branch -d` (si la entrada fue *squash*, `-d` se niega: usar `-D` solo tras comprobar que `main` tiene el contenido y con tu visto bueno). Si la anterior quedó sin integrar, mejor un *worktree* nuevo (`herdr worktree create`) y no tocar el viejo.
5. **Arrancar:** el implementador con `/agile-explorar` (tarea ambigua) o `/agile-iterar` (tarea clara). Leen `AGENTS.md` → ficha de la tarea; no hace falta repetirles el contexto.

# Trabajo en paralelo: dos pares de agentes con Git Worktrees

Cada *worktree* lo usa un par: **Claude Code** (implementa) + **Codex** (audita, solo lectura). Una sola tarea principal por *worktree* (`AGENTS.md`). Procedimiento de la sesión del 2026-10-14.

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
3. Paneles de Herdr: Claude Code (implementa) y Codex con `--sandbox read-only` en la misma ruta.

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

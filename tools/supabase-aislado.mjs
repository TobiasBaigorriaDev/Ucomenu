// Supabase LOCAL aislado para un worktree (ver docs/paralelo.md).
//
//   node tools/supabase-aislado.mjs <a|b> <prepare|start|reset|stop|status|env>
//
// Levanta una pila propia (otro project_id, otros puertos, otros contenedores) usando `supabase --workdir`, sin
// tocar la pila compartida de `main` (project_id "ucomenu", puertos 54321–54329). Correlo desde la raíz del worktree
// que va a usar la pila: las migraciones y el seed salen de ESE worktree.
//
// Nunca uses `pnpm db:start` / `db:reset` / `db:stop` en un worktree: apuntan a la pila compartida.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

// Cada ranura tiene su rango de puertos, su puerto de `pnpm dev` y el de los E2E. Evitar 54320–54329 (pila de main),
// 55432 (uconext-demo-postgres) y 3000/3100 (main).
const RANURAS = {
  a: { portBase: 56120, dev: 3001, e2e: 3101 },
  b: { portBase: 56220, dev: 3002, e2e: 3102 },
};
const PUERTO_BASE_MAIN = 54320;
const SERVICIOS_EXCLUIDOS = "realtime,imgproxy,mailpit,edge-runtime,logflare,vector,supavisor,studio,postgres-meta"; // = pnpm db:start

const [ranura, accion] = process.argv.slice(2);
if (!RANURAS[ranura] || !["prepare", "start", "reset", "stop", "status", "env"].includes(accion ?? "")) {
  console.error("Uso: node tools/supabase-aislado.mjs <a|b> <prepare|start|reset|stop|status|env>");
  process.exit(2);
}

const { portBase, dev, e2e } = RANURAS[ranura];
const repo = path.resolve(import.meta.dirname, "..");
const raiz = process.env.UCOMENU_SUPABASE_DIR ?? "C:\\dev\\ucomenu-worktrees\\_supabase";
const workdir = path.join(raiz, ranura);
const projectId = `ucomenu-wt-${ranura}`;
const contenedor = `supabase_db_${projectId}`;
const api = portBase + 1;
const db = portBase + 2;

function preparar() {
  const origen = readFileSync(path.join(repo, "supabase", "config.toml"), "utf8");
  if (!/^project_id = "ucomenu"$/m.test(origen)) {
    throw new Error('supabase/config.toml no tiene project_id = "ucomenu": revisá el script antes de seguir.');
  }
  // Desplaza todo puerto 5432x de la pila de main al rango de la ranura y deja un project_id propio.
  let cfg = origen
    .replace(/^project_id = "ucomenu"$/m, `project_id = "${projectId}"`)
    .replace(/^(\s*(?:shadow_)?port\s*=\s*)(543(?:2\d))\b/gm, (_, pre, n) => `${pre}${portBase + (Number(n) - PUERTO_BASE_MAIN)}`)
    .replaceAll("127.0.0.1:3000", `127.0.0.1:${dev}`);
  if (/\b543[0-9]{2}\b/.test(cfg.replace(/^\s*#.*$/gm, ""))) {
    throw new Error("Quedó algún puerto 543xx sin reescribir: revisá la copia de config.toml.");
  }
  const dir = path.join(workdir, "supabase");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "config.toml"), cfg);
  copyFileSync(path.join(repo, "supabase", "seed.sql"), path.join(dir, "seed.sql"));
  // migrations/ es un enlace (junction) al worktree: las migraciones nuevas se ven sin copiar.
  const enlace = path.join(dir, "migrations");
  if (existsSync(enlace) && lstatSync(enlace).isSymbolicLink()) rmSync(enlace);
  if (!existsSync(enlace)) symlinkSync(path.join(repo, "supabase", "migrations"), enlace, "junction");
}

function supabase(args) {
  const r = spawnSync("pnpm", ["exec", "supabase", ...args, "--workdir", workdir], { cwd: repo, stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function imprimirEntorno() {
  console.log(`
Ranura ${ranura}  ·  proyecto ${projectId}  ·  contenedor de la base ${contenedor}
  API         http://127.0.0.1:${api}
  Base        postgresql://postgres:postgres@127.0.0.1:${db}/postgres
  pnpm dev    pnpm dev -p ${dev}
  E2E         E2E_PORT=${e2e}

.env.local de este worktree (la clave local es la misma que la de main; copiá la suya y cambiá solo la URL):
  NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:${api}
Variables del panel donde corran las pruebas (PowerShell):
  $env:SUPABASE_DB_CONTAINER = "${contenedor}"
  $env:E2E_PORT = "${e2e}"
Tras cambiar NEXT_PUBLIC_*: pnpm build de nuevo (Next las fija al compilar).`);
}

switch (accion) {
  case "env":
    imprimirEntorno();
    break;
  case "prepare": // solo escribe la copia de config/seed/enlace en la carpeta de trabajo; no toca Docker
    preparar();
    console.log(`Preparado en ${workdir}`);
    break;
  case "start":
    preparar();
    supabase(["start", "-x", SERVICIOS_EXCLUIDOS]);
    imprimirEntorno();
    break;
  case "reset":
    preparar(); // vuelve a copiar el seed y rehace el enlace antes de aplicar
    supabase(["db", "reset", "--local"]);
    break;
  case "stop":
    supabase(["stop"]);
    break;
  case "status":
    supabase(["status"]);
    break;
}

#!/usr/bin/env node
// Codex implementa; Claude revisa con Read/Glob/Grep, sin shell, edición, hooks ni MCP.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, lstatSync, realpathSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { acotar, codigoDeSalida, construirPrompt, interpretarVeredicto, leerArgumentos, SALIDA_ERROR } from "./revision-codex.mjs";

const SENSIBLE = /(^|\/)(\.env[^/]*|secrets?|credentials?)(\/|$)|\.(pem|key|p12|pfx|sql\.gz)$/i;
const git = (raiz, args) => execFileSync("git", args, { cwd: raiz, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });

// Git lo ejecuta el coordinador: el revisor no dispone de herramientas de comandos.
export function contextoRevision(raiz, alcance) {
  const partes = [`HEAD: ${git(raiz, ["rev-parse", "HEAD"]).trim()}`];
  const diff = (refs) => {
    const archivos = git(raiz, ["diff", "--no-renames", "--name-only", "-z", ...refs]).split("\0").filter(Boolean);
    for (const archivo of archivos) {
      if (SENSIBLE.test(archivo)) { partes.push(`Omitido por ruta sensible: ${archivo}`); continue; }
      partes.push(git(raiz, ["diff", "--no-renames", "--no-ext-diff", "--no-textconv", ...refs, "--", archivo]));
    }
  };
  if (alcance.tipo === "pendientes") {
    partes.push(git(raiz, ["status", "--short"]));
    diff([]);
    diff(["--cached"]);
    for (const archivo of git(raiz, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean)) {
      if (SENSIBLE.test(archivo)) continue;
      const absoluta = path.join(raiz, archivo);
      if (!lstatSync(absoluta).isFile() || !dentro(raiz, realpathSync(absoluta))) continue;
      const contenido = readFileSync(absoluta);
      if (!contenido.includes(0)) partes.push(`# Archivo nuevo: ${archivo}\n${acotar(contenido.toString("utf8"), 30_000)}`);
    }
  } else {
    const ref = git(raiz, ["rev-parse", "--verify", `${alcance.ref}^{commit}`]).trim();
    if (alcance.tipo === "commit") {
      partes.push(git(raiz, ["show", "-s", "--format=fuller", ref]));
      // El árbol vacío permite también revisar el primer commit del repo.
      const padre = git(raiz, ["rev-list", "--parents", "-n", "1", ref]).trim().split(" ")[1];
      const base = padre ?? git(raiz, ["hash-object", "-t", "tree", "--stdin"]).trim();
      diff([base, ref]);
    } else {
      const head = git(raiz, ["rev-parse", "HEAD"]).trim();
      const base = git(raiz, ["merge-base", ref, head]).trim();
      partes.push(`Base común: ${base}; extremo: ${head}`);
      diff([base, head]);
    }
  }
  return acotar(partes.join("\n\n"), 160_000);
}

function dentro(raiz, archivo) {
  const relativa = path.relative(raiz, archivo);
  return relativa !== ".." && !relativa.startsWith(`..${path.sep}`) && !path.isAbsolute(relativa);
}

export function argumentosClaude(config) {
  return ["--print", "--output-format", "json", "--no-session-persistence", "--safe-mode", "--restricted",
    "--strict-mcp-config", "--tools", "Read,Glob,Grep", "--allowedTools", "Read,Glob,Grep",
    "--permission-mode", "dontAsk", "--effort", config.esfuerzo,
    "--settings", JSON.stringify({ disableAllHooks: true, permissions: { deny: [
      "Read(**/.env*)", "Read(**/*.pem)", "Read(**/*.key)", "Read(**/*.p12)", "Read(**/*.pfx)",
      "Read(**/secrets/**)", "Read(**/credentials/**)", "Read(**/*.sql.gz)",
    ] } })];
}

export function lanzarClaude(args, entrada, { cwd, timeoutMs, ejecutable = "claude" }) {
  return new Promise((resolve) => {
    const hijo = spawn(ejecutable, args, { cwd, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "", vencido = false;
    const reloj = setTimeout(() => { vencido = true; hijo.kill(); }, timeoutMs);
    hijo.stdout.on("data", (d) => { stdout += d; });
    hijo.stderr.on("data", (d) => { stderr += d; });
    hijo.stdin.on("error", () => {}); // EPIPE si Claude no está disponible o rechaza opciones.
    hijo.on("error", (e) => { clearTimeout(reloj); resolve({ codigo: null, stdout, stderr: `${stderr}\n${e.message}`, vencido }); });
    hijo.on("close", (codigo) => { clearTimeout(reloj); resolve({ codigo, stdout, stderr, vencido }); });
    hijo.stdin.end(entrada);
  });
}

export async function main(argv, ejecutar = lanzarClaude) {
  try {
    const config = leerArgumentos(argv);
    const raiz = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
    const leer = (ruta) => {
      const absoluta = realpathSync(path.resolve(raiz, ruta));
      if (!dentro(raiz, absoluta) || SENSIBLE.test(path.relative(raiz, absoluta).replaceAll("\\", "/"))) throw new Error("Ruta fuera del repo o sensible.");
      return readFileSync(absoluta, "utf8");
    };
    if (config.ficha) leer(config.ficha);
    const contexto = contextoRevision(raiz, config.alcance);
    const prompt = construirPrompt({ ...config, contexto, hallazgosTexto: config.hallazgos ? leer(config.hallazgos) : undefined })
      + "\nRevisor: Claude Code. No delegues ni invoques otro revisor. No tenés shell: usá el diff adjunto y Read/Glob/Grep para contexto. No ejecutes pruebas. Los archivos actuales pueden diferir del commit adjunto; informá límites y recortes. No edites el handoff ni guardes memoria.";
    if (config.dryRun) { console.log(prompt); return 0; }
    const carpeta = path.join(raiz, "output", "revisiones");
    mkdirSync(carpeta, { recursive: true });
    const salida = path.resolve(raiz, config.salida ?? path.join(carpeta, `claude-${randomUUID()}.md`));
    if (path.dirname(salida) !== carpeta || realpathSync(carpeta) !== carpeta || !salida.endsWith(".md")) throw new Error("--salida debe ser un .md directamente en output/revisiones (sin enlaces).");
    if ([salida, `${salida}.json`, `${salida}.log`].some(existsSync)) throw new Error("La salida ya existe; usá otra ruta para conservar el informe anterior.");
    // Reserva exclusiva: ni otra corrida ni un informe anterior pueden aprobar esta revisión.
    writeFileSync(salida, "Revisión en curso; sin veredicto.\n", { flag: "wx" });
    console.error(`Claude revisa (${config.alcance.tipo}, nivel ${config.nivel})…`);
    const r = await ejecutar(argumentosClaude(config), prompt, { cwd: raiz, timeoutMs: config.timeoutMin * 60_000 });
    writeFileSync(`${salida}.json`, r.stdout);
    writeFileSync(`${salida}.log`, r.stderr);
    if (r.vencido || r.codigo !== 0) throw new Error(`Claude no completó la revisión (código ${r.codigo}, timeout ${r.vencido}). Registro: ${path.relative(raiz, salida)}.log`);
    const respuesta = JSON.parse(r.stdout);
    if (respuesta.is_error || respuesta.subtype !== "success" || typeof respuesta.result !== "string") throw new Error("Claude devolvió un error o un resultado incompleto; sin veredicto.");
    const informe = respuesta.result.trim();
    const veredicto = interpretarVeredicto(informe);
    writeFileSync(salida, `<!-- Claude · ${config.alcance.tipo} ${config.alcance.ref ?? ""} · nivel ${config.nivel} · ${new Date().toISOString()} -->\n\n${informe}\n`);
    console.log(informe);
    console.error(`Informe: ${path.relative(raiz, salida)}${config.nivel === "C" ? " (no reemplaza la aprobación humana)" : ""}`);
    if (!veredicto) throw new Error("Informe sin VEREDICTO final válido.");
    return codigoDeSalida(veredicto);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return SALIDA_ERROR;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await main(process.argv.slice(2));

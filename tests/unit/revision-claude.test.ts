import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { argumentosClaude, contextoRevision, lanzarClaude, main } from "../../tools/revision-claude.mjs";

const raiz = path.resolve(import.meta.dirname, "../..");
const salidas: string[] = [];
beforeAll(() => { vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterAll(() => {
  vi.restoreAllMocks();
  for (const p of salidas) for (const sufijo of ["", ".json", ".log"]) rmSync(p + sufijo, { force: true });
});

describe("coordinación con Claude", () => {
  const respuesta = (result: string, extra = {}) => ({ codigo: 0, vencido: false, stderr: "", stdout: JSON.stringify({ subtype: "success", is_error: false, result, ...extra }) });
  function salida() {
    const p = path.join(raiz, "output/revisiones", `test-claude-${crypto.randomUUID()}.md`);
    salidas.push(p);
    return p;
  }
  it.each([["APROBAR", 0], ["APROBAR CON CAMBIOS", 1], ["RECHAZAR", 2]] as const)("devuelve %s y guarda el informe de esta corrida", async (veredicto, codigo) => {
    const p = salida();
    const ejecutar = vi.fn(async () => respuesta(`Sin hallazgos\nVEREDICTO: ${veredicto}`));
    expect(await main(["--commit", "HEAD", "--salida", p], ejecutar)).toBe(codigo);
    expect(readFileSync(p, "utf8")).toContain(`VEREDICTO: ${veredicto}`);
    const [args, prompt] = ejecutar.mock.calls[0] as unknown as [string[], string];
    expect(args).toContain("--restricted");
    expect(prompt).toContain("HEAD:");
    expect(prompt).toContain("No delegues");
  });
  it.each([
    { codigo: 1, vencido: false, stderr: "falló", stdout: JSON.stringify({ subtype: "success", result: "VEREDICTO: APROBAR" }) },
    { codigo: 0, vencido: true, stderr: "", stdout: JSON.stringify({ subtype: "success", result: "VEREDICTO: APROBAR" }) },
    respuesta("VEREDICTO: APROBAR", { is_error: true }),
    respuesta("VEREDICTO: APROBAR", { subtype: "error_max_turns" }),
    respuesta("VEREDICTO: APROBAR\nIncompleto"),
    { codigo: 0, vencido: false, stderr: "", stdout: "no es JSON" },
  ])("rechaza fallos y respuestas incompletas", async (r) => {
    expect(await main(["--commit", "HEAD", "--salida", salida()], async () => r)).toBe(3);
  });
  it("no pisa ni usa un informe anterior", async () => {
    const p = salida();
    writeFileSync(p, "VEREDICTO: APROBAR");
    const ejecutar = vi.fn();
    expect(await main(["--commit", "HEAD", "--salida", p], ejecutar)).toBe(3);
    expect(ejecutar).not.toHaveBeenCalled();
    expect(readFileSync(p, "utf8")).toBe("VEREDICTO: APROBAR");
  });
  it("dry-run no invoca Claude ni crea informes y verificación adjunta hallazgos", async () => {
    const p = salida();
    const ejecutar = vi.fn();
    expect(await main(["--commit", "HEAD", "--dry-run", "--salida", p], ejecutar)).toBe(0);
    expect(existsSync(p)).toBe(false);
    expect(ejecutar).not.toHaveBeenCalled();
    writeFileSync(p, "Hallazgo anterior de prueba\nVEREDICTO: APROBAR CON CAMBIOS");
    const verificar = vi.fn(async (_args: string[], prompt: string) => {
      expect(prompt).toContain("RONDA DE VERIFICACIÓN");
      expect(prompt).toContain("Hallazgo anterior de prueba");
      return respuesta("VEREDICTO: APROBAR");
    });
    expect(await main(["--commit", "HEAD", "--verificar", "--hallazgos", p, "--salida", salida()], verificar)).toBe(0);
  });
  it("no permite salidas sobre código del proyecto", async () => {
    const ejecutar = vi.fn();
    expect(await main(["--commit", "HEAD", "--salida", "package.json"], ejecutar)).toBe(3);
    expect(ejecutar).not.toHaveBeenCalled();
  });
  it("transmite stdin y captura stdout/stderr del proceso sin shell", async () => {
    const programa = 'let texto = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", d => texto += d); process.stdin.on("end", () => { process.stdout.write(texto); process.stderr.write("registro"); });';
    const r = await lanzarClaude(["--input-type=module", "-e", programa], "revisión con espacios y ñ", { cwd: raiz, timeoutMs: 10_000, ejecutable: process.execPath });
    expect(r).toMatchObject({ codigo: 0, stdout: "revisión con espacios y ñ", stderr: "registro", vencido: false });
  });
  it("detiene un proceso que excede el timeout", async () => {
    const r = await lanzarClaude(["-e", "setInterval(() => {}, 1000)"], "", { cwd: raiz, timeoutMs: 100, ejecutable: process.execPath });
    expect(r.vencido).toBe(true);
  });
  it("reporta un ejecutable ausente sin confundirlo con un resultado válido", async () => {
    const r = await lanzarClaude([], "", { cwd: raiz, timeoutMs: 1000, ejecutable: path.join(raiz, "output/no-existe-claude") });
    expect(r.codigo).toBeNull();
    expect(r.stderr).toContain("ENOENT");
  });
});

describe("contexto de revisión", () => {
  it("incluye commit raíz, base, staged, sin stage y nuevos; omite secretos", () => {
    const repo = mkdtempSync(path.join(tmpdir(), "revision-claude-"));
    const g = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    try {
      g("init", "-b", "main");
      writeFileSync(path.join(repo, "a.txt"), "inicial\n");
      writeFileSync(path.join(repo, ".env.test"), "dato-sensible-inicial\n");
      g("add", ".");
      g("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "inicial");
      const inicial = contextoRevision(repo, { tipo: "commit", ref: "HEAD" });
      expect(inicial).toContain("inicial");
      expect(inicial).not.toContain("dato-sensible-inicial");
      writeFileSync(path.join(repo, "a.txt"), "cambio staged\n");
      g("add", "a.txt");
      writeFileSync(path.join(repo, "a.txt"), "cambio sin stage\n");
      writeFileSync(path.join(repo, "nuevo.txt"), "nuevo visible\n");
      writeFileSync(path.join(repo, ".env.test"), "dato-sensible-modificado\n");
      const pendiente = contextoRevision(repo, { tipo: "pendientes" });
      for (const texto of ["cambio staged", "cambio sin stage", "nuevo visible"]) expect(pendiente).toContain(texto);
      expect(pendiente).not.toContain("dato-sensible");
      g("mv", "a.txt", "renombrado.txt");
      const renombrado = contextoRevision(repo, { tipo: "pendientes" });
      expect(renombrado).toContain("deleted file mode");
      expect(renombrado).toContain("--- a/a.txt");
      expect(renombrado).toContain("+++ b/renombrado.txt");
      g("add", "renombrado.txt");
      g("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "segundo");
      expect(contextoRevision(repo, { tipo: "base", ref: "HEAD~1" })).toContain("cambio sin stage");
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });
  it("solo habilita lecturas, con hooks y MCP deshabilitados", () => {
    const args = argumentosClaude({ esfuerzo: "high" });
    expect(args[args.indexOf("--tools") + 1]).toBe("Read,Glob,Grep");
    expect(args).toContain("--safe-mode");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--no-session-persistence");
    expect(args).not.toContain("--dangerously-skip-permissions");
  });
});

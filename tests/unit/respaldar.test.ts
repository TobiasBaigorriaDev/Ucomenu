import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AUTH_EXCLUIDAS,
  TABLAS_EXCLUIDAS,
  armarManifiesto,
  leerArgumentos,
  marcaDeTiempo,
  sha256,
  validarDestino,
  validarEntorno,
  verificarRespaldo,
} from "../../tools/respaldar.mjs";

/** Respaldo propio (tools/respaldar.mjs): lo que no necesita Docker ni red. */

describe("leerArgumentos", () => {
  it("exige uno solo de --local o --remoto y un destino", () => {
    expect(() => leerArgumentos(["--destino", "x"])).toThrow(/exactamente uno/);
    expect(() => leerArgumentos(["--local", "--remoto", "--destino", "x"])).toThrow(/exactamente uno/);
    expect(() => leerArgumentos(["--local"])).toThrow(/--destino/);
  });

  it("--remoto exige --env y tolera el «--» que agrega pnpm", () => {
    expect(() => leerArgumentos(["--remoto", "--destino", "x"])).toThrow(/--env/);
    expect(leerArgumentos(["--", "--remoto", "--env", "p.env", "--destino", "x"])).toMatchObject({ remoto: true, env: "p.env" });
    expect(leerArgumentos(["--local", "--destino", "x"])).toMatchObject({ local: true, remoto: false });
  });
});

describe("validarDestino", () => {
  const raiz = path.resolve(tmpdir(), "repo-falso");

  it("rechaza el repositorio y cualquier carpeta dentro de él", () => {
    expect(() => validarDestino(raiz, raiz)).toThrow(/dentro del repositorio/);
    expect(() => validarDestino(path.join(raiz, "respaldos"), raiz)).toThrow(/dentro del repositorio/);
    expect(() => validarDestino(path.join(raiz, "a", "..", "b"), raiz)).toThrow(/dentro del repositorio/);
  });

  it("acepta una carpeta fuera, incluso una con el mismo prefijo de nombre", () => {
    expect(validarDestino(path.resolve(tmpdir(), "otro"), raiz)).toBe(path.resolve(tmpdir(), "otro"));
    expect(validarDestino(`${raiz}-hermano`, raiz)).toBe(`${raiz}-hermano`);
  });
});

describe("validarEntorno", () => {
  const remoto = {
    NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_x",
    RESPALDO_DB_URL: "postgresql://postgres:clave@db.abc.supabase.co:5432/postgres",
  };
  const local = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "k" };

  it("--local solo contra el Supabase local y --remoto solo contra uno remoto", () => {
    expect(validarEntorno(local, { local: true }).esLocal).toBe(true);
    expect(() => validarEntorno(remoto, { local: true })).toThrow(/no es el Supabase local/);
    expect(() => validarEntorno(local, { local: false })).toThrow(/es el Supabase local/);
    expect(validarEntorno(remoto, { local: false }).esLocal).toBe(false);
  });

  it("faltan variables: error claro, y el remoto necesita la conexión a la base", () => {
    expect(() => validarEntorno({}, { local: true })).toThrow(/Faltan/);
    expect(() => validarEntorno({ ...remoto, RESPALDO_DB_URL: undefined } as never, { local: false })).toThrow(/RESPALDO_DB_URL/);
    expect(() => validarEntorno({ ...remoto, NEXT_PUBLIC_SUPABASE_URL: "no es url" }, { local: false })).toThrow(/dirección válida/);
  });
});

describe("verificarRespaldo", () => {
  let dir: string;
  const archivos = { "esquema.sql": "create table a();", "datos.sql": "copy a;", "storage/org/p/foto.png": "PNG" };

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "respaldo-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const armar = (nombre: string, contenidos: Record<string, string>) => {
    const carpeta = path.join(dir, nombre);
    const lista = Object.entries(contenidos).map(([ruta, texto]) => {
      mkdirSync(path.dirname(path.join(carpeta, ruta)), { recursive: true });
      writeFileSync(path.join(carpeta, ruta), texto);
      return { ruta, bytes: Buffer.byteLength(texto), sha256: sha256(Buffer.from(texto)) };
    });
    writeFileSync(path.join(carpeta, "manifiesto.json"), JSON.stringify(armarManifiesto({ entorno: "local", fecha: new Date(0), archivos: lista })));
    return carpeta;
  };

  it("un respaldo íntegro no tiene problemas", () => {
    expect(verificarRespaldo(armar("sano", archivos))).toEqual([]);
  });

  it("detecta un archivo alterado, uno borrado y un volcado vacío", () => {
    const alterado = armar("alterado", archivos);
    writeFileSync(path.join(alterado, "storage/org/p/foto.png"), "PNX");
    expect(verificarRespaldo(alterado).join("\n")).toContain("SHA-256");

    const borrado = armar("borrado", archivos);
    rmSync(path.join(borrado, "storage/org/p/foto.png"));
    expect(verificarRespaldo(borrado).join("\n")).toContain("Falta storage/org/p/foto.png");

    expect(verificarRespaldo(armar("vacio", { ...archivos, "datos.sql": "" })).join("\n")).toContain("datos.sql falta o está vacío");
  });

  it("sin manifiesto no hay respaldo válido", () => {
    expect(verificarRespaldo(path.join(dir, "no-existe"))).toEqual(["No se pudo leer manifiesto.json."]);
  });
});

describe("otros", () => {
  it("la marca de tiempo sirve de nombre de carpeta", () => {
    expect(marcaDeTiempo(new Date("2026-10-16T05:31:19.123Z"))).toBe("2026-10-16T05-31-19Z");
  });

  it("no respalda sesiones ni tokens, pero sí las cuentas", () => {
    for (const tabla of ["auth.sessions", "auth.refresh_tokens", "auth.one_time_tokens", "auth.audit_log_entries"]) {
      expect(AUTH_EXCLUIDAS).toContain(tabla);
    }
    expect(AUTH_EXCLUIDAS).not.toContain("auth.users");
    expect(AUTH_EXCLUIDAS).not.toContain("auth.identities");
  });

  it("no copia los llamados: llevan el identificador derivado de la IP, que se borra a los 14 días", () => {
    expect(TABLAS_EXCLUIDAS).toContain("public.waiter_calls");
    expect(TABLAS_EXCLUIDAS).toEqual(expect.arrayContaining(AUTH_EXCLUIDAS));
  });
});

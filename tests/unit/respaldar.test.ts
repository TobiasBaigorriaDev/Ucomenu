import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AUTH_EXCLUIDAS,
  BUCKETS,
  TABLAS_EXCLUIDAS,
  armarManifiesto,
  copiarStorage,
  leerArgumentos,
  marcaDeTiempo,
  objetosPorBucket,
  sha256,
  validarDestino,
  validarEntorno,
  verificarRespaldo,
} from "../../tools/respaldar.mjs";

/** Respaldo propio (tools/respaldar.mjs): lo que no necesita Docker ni red. Todos los datos son sintéticos. */

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

type EntradaManifiesto = { ruta: string; bytes: number; sha256: string; bucket?: string; objeto?: string };
type Manifiesto = { version?: number; buckets?: string[]; archivos: EntradaManifiesto[] };

describe("verificarRespaldo", () => {
  const archivos = {
    "esquema.sql": "create table a();",
    "datos.sql": "copy a;",
    "storage/product-images/org/p/foto.png": "PNG",
    "storage/organization-logos/org/logo.png": "LOGO",
  };
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "respaldo-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const entradaDe = (m: Manifiesto, bucket: string) => m.archivos.find((a) => a.bucket === bucket) as EntradaManifiesto;

  /** Arma una carpeta de respaldo; `ajustar` altera el manifiesto antes de escribirlo. */
  const armar = (nombre: string, contenidos: Record<string, string>, ajustar?: (m: Manifiesto) => void) => {
    const carpeta = path.join(dir, nombre);
    const lista = Object.entries(contenidos).map(([ruta, texto]): EntradaManifiesto => {
      mkdirSync(path.dirname(path.join(carpeta, ruta)), { recursive: true });
      writeFileSync(path.join(carpeta, ruta), texto);
      const base = { ruta, bytes: Buffer.byteLength(texto), sha256: sha256(Buffer.from(texto)) };
      const [, bucket, ...objeto] = ruta.startsWith("storage/") ? ruta.split("/") : [];
      return bucket ? { ...base, bucket, objeto: objeto.join("/") } : base;
    });
    const manifiesto = armarManifiesto({ entorno: "local", fecha: new Date(0), archivos: lista }) as Manifiesto;
    ajustar?.(manifiesto);
    writeFileSync(path.join(carpeta, "manifiesto.json"), JSON.stringify(manifiesto));
    return carpeta;
  };

  it("un respaldo íntegro no tiene problemas y declara ambos buckets", () => {
    expect(verificarRespaldo(armar("sano", archivos))).toEqual([]);
    expect(BUCKETS).toEqual(["product-images", "organization-logos"]);
  });

  it("detecta un archivo alterado, uno borrado y un volcado vacío", () => {
    const alterado = armar("alterado", archivos);
    writeFileSync(path.join(alterado, "storage/product-images/org/p/foto.png"), "PNX");
    expect(verificarRespaldo(alterado).join("\n")).toContain("SHA-256");

    const borrado = armar("borrado", archivos);
    rmSync(path.join(borrado, "storage/organization-logos/org/logo.png"));
    expect(verificarRespaldo(borrado).join("\n")).toContain("Falta storage/organization-logos/org/logo.png");

    expect(verificarRespaldo(armar("vacio", { ...archivos, "datos.sql": "" })).join("\n")).toContain("datos.sql falta o está vacío");
  });

  it("sin manifiesto no hay respaldo válido", () => {
    expect(verificarRespaldo(path.join(dir, "no-existe"))).toEqual(["No se pudo leer manifiesto.json."]);
  });

  it("un manifiesto sin el bucket de logos no pasa: no puede confundirse con un respaldo completo", () => {
    const carpeta = armar("sin-bucket", archivos, (m) => {
      m.buckets = ["product-images"];
      m.archivos = m.archivos.filter((a) => a.bucket !== "organization-logos");
    });
    expect(verificarRespaldo(carpeta).join("\n")).toContain("no incluye el bucket organization-logos");
  });

  it("un bucket sin archivos es válido si figura en el manifiesto", () => {
    const sinLogos = Object.fromEntries(Object.entries(archivos).filter(([ruta]) => !ruta.startsWith("storage/organization-logos/")));
    expect(verificarRespaldo(armar("logos-vacio", sinLogos))).toEqual([]);
  });

  it("detecta archivos de Storage sin bucket, con un bucket ajeno, con la ruta cruzada o con una ruta que escapa", () => {
    const sinBucket = armar("storage-sin-bucket", archivos, (m) => {
      delete entradaDe(m, "product-images").bucket;
    });
    expect(verificarRespaldo(sinBucket).join("\n")).toContain("no indica su bucket");

    const ajeno = armar("bucket-ajeno", archivos, (m) => {
      entradaDe(m, "product-images").bucket = "otro";
    });
    expect(verificarRespaldo(ajeno).join("\n")).toContain("no figura en el manifiesto");

    const cruzada = armar("ruta-cruzada", archivos, (m) => {
      entradaDe(m, "product-images").bucket = "organization-logos";
    });
    expect(verificarRespaldo(cruzada).join("\n")).toContain("la ruta no coincide con el bucket organization-logos");

    const escape = armar("ruta-escape", archivos, (m) => {
      const foto = entradaDe(m, "product-images");
      foto.objeto = "../../esquema.sql";
      foto.ruta = "storage/product-images/../../esquema.sql";
    });
    expect(verificarRespaldo(escape).join("\n")).toContain("ruta no permitida");
  });

  it("un manifiesto de versión 1 (un solo bucket, sin buckets declarados) se sigue pudiendo verificar", () => {
    const carpeta = armar("v1", { "esquema.sql": "x", "datos.sql": "y", "storage/org/p/foto.png": "PNG" }, (m) => {
      m.version = 1;
      delete m.buckets;
      for (const a of m.archivos) {
        delete a.bucket;
        delete a.objeto;
      }
    });
    expect(verificarRespaldo(carpeta)).toEqual([]);
  });

  it("objetosPorBucket separa los objetos de cada bucket para restaurarlos donde corresponde", () => {
    const manifiesto = JSON.parse(readFileSync(path.join(armar("restaurar", archivos), "manifiesto.json"), "utf8"));
    expect(objetosPorBucket(manifiesto)).toEqual({
      "product-images": [{ objeto: "org/p/foto.png", ruta: "storage/product-images/org/p/foto.png" }],
      "organization-logos": [{ objeto: "org/logo.png", ruta: "storage/organization-logos/org/logo.png" }],
    });
  });
});

describe("copiarStorage", () => {
  /** Cliente de Storage falso con datos sintéticos: cada bucket es un árbol de carpetas (objetos) y archivos (textos). */
  type Arbol = { [nombre: string]: Arbol | string };
  function clienteFalso(buckets: Record<string, Arbol>, fallaEn?: string) {
    const nodo = (arbol: Arbol, prefijo: string) =>
      prefijo.split("/").filter(Boolean).reduce<Arbol | string>((n, p) => (typeof n === "string" ? n : (n[p] ?? {})), arbol) as Arbol;
    return {
      storage: {
        from: (nombre: string) => ({
          list: async (prefijo: string, { limit, offset }: { limit: number; offset: number }) => {
            if (nombre === fallaEn) return { data: null, error: { message: "bucket inexistente" } };
            const entradas = Object.entries(nodo(buckets[nombre] ?? {}, prefijo)).map(([name, valor]) => ({
              name,
              id: typeof valor === "string" ? `id-${name}` : null,
            }));
            return { data: entradas.slice(offset, offset + limit), error: null };
          },
          download: async (ruta: string) => {
            const texto = ruta.split("/").reduce<Arbol | string>((n, p) => (n as Arbol)[p], buckets[nombre] ?? {});
            return { data: new Blob([texto as string]), error: null };
          },
        }),
      },
    };
  }

  const sintetico: Record<string, Arbol> = {
    "product-images": { "org-1": { plato: { "a.png": "FOTO-A" } }, "raiz.png": "RAIZ" },
    // Misma ruta de objeto que en product-images: sin distinguir buckets, una pisaría a la otra.
    "organization-logos": { "org-1": { plato: { "a.png": "LOGO-A" } } },
  };

  const enCarpetaTemporal = async (prueba: (carpeta: string) => Promise<void>) => {
    const carpeta = mkdtempSync(path.join(tmpdir(), "copia-"));
    try {
      await prueba(carpeta);
    } finally {
      rmSync(carpeta, { recursive: true, force: true });
    }
  };

  it("copia ambos buckets en carpetas separadas y registra bucket y objeto de cada archivo", () =>
    enCarpetaTemporal(async (carpeta) => {
      const copiados: EntradaManifiesto[] = await copiarStorage({ carpeta, cliente: clienteFalso(sintetico) });

      expect(copiados.map((a) => a.ruta).sort()).toEqual([
        "storage/organization-logos/org-1/plato/a.png",
        "storage/product-images/org-1/plato/a.png",
        "storage/product-images/raiz.png",
      ]);
      expect(copiados.find((a) => a.ruta === "storage/organization-logos/org-1/plato/a.png")).toMatchObject({
        bucket: "organization-logos",
        objeto: "org-1/plato/a.png",
        bytes: 6,
        sha256: sha256(Buffer.from("LOGO-A")),
      });
      expect(readFileSync(path.join(carpeta, "storage/product-images/org-1/plato/a.png"), "utf8")).toBe("FOTO-A");
      expect(readFileSync(path.join(carpeta, "storage/organization-logos/org-1/plato/a.png"), "utf8")).toBe("LOGO-A");
    }));

  it("un bucket vacío no es un error; uno que no se puede listar sí (no queda un respaldo incompleto en silencio)", () =>
    enCarpetaTemporal(async (carpeta) => {
      const soloFotos = { "product-images": { "x.png": "X" }, "organization-logos": {} };
      expect(await copiarStorage({ carpeta, cliente: clienteFalso(soloFotos) })).toHaveLength(1);
      await expect(copiarStorage({ carpeta, cliente: clienteFalso(sintetico, "organization-logos") })).rejects.toThrow(/organization-logos/);
    }));

  it("lo copiado, con su manifiesto, pasa la verificación", () =>
    enCarpetaTemporal(async (carpeta) => {
      const copiados: EntradaManifiesto[] = await copiarStorage({ carpeta, cliente: clienteFalso(sintetico) });
      const base = ["esquema.sql", "datos.sql"].map((ruta) => {
        writeFileSync(path.join(carpeta, ruta), ruta);
        return { ruta, bytes: ruta.length, sha256: sha256(Buffer.from(ruta)) };
      });
      writeFileSync(
        path.join(carpeta, "manifiesto.json"),
        JSON.stringify(armarManifiesto({ entorno: "local", fecha: new Date(0), archivos: [...copiados, ...base] })),
      );

      expect(verificarRespaldo(carpeta)).toEqual([]);
    }));
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

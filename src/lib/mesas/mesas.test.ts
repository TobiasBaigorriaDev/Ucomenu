import { describe, expect, it } from "vitest";
import { LABEL_MAX, sortByLabel, suggestNextLabel, validateLabel } from "./labels";
import { mesasBlockNotice, mesasErrorMessage, mesasWriteBlock } from "./messages";
import { qrMatrix, qrPath, qrViewSize, QUIET_ZONE } from "./qr";
import { parseResolvedTable } from "./tables";
import { isToken, resolveBaseUrl, tableUrl } from "./url";
import type { Entitlements } from "@/lib/entitlements";

describe("validateLabel", () => {
  it("recorta y rechaza vacío o demasiado largo", () => {
    expect(validateLabel("  Mesa 4 ")).toEqual({ ok: true, value: "Mesa 4" });
    expect(validateLabel("   ")).toEqual({ ok: false, problem: "blank" });
    expect(validateLabel(undefined)).toEqual({ ok: false, problem: "blank" });
    expect(validateLabel(12)).toEqual({ ok: false, problem: "blank" });
    expect(validateLabel("a".repeat(LABEL_MAX)).ok).toBe(true);
    expect(validateLabel("a".repeat(LABEL_MAX + 1))).toEqual({ ok: false, problem: "too_long" });
    expect(validateLabel("🍽".repeat(LABEL_MAX)).ok).toBe(true);
  });
});

describe("orden y sugerencia de etiquetas", () => {
  it("ordena en orden natural", () => {
    const orden = sortByLabel([{ label: "Mesa 10" }, { label: "Mesa 2" }, { label: "mesa 1" }, { label: "Barra" }]).map((t) => t.label);
    expect(orden).toEqual(["Barra", "mesa 1", "Mesa 2", "Mesa 10"]);
  });

  it("sugiere el siguiente número", () => {
    expect(suggestNextLabel([])).toBe("Mesa 1");
    expect(suggestNextLabel(["Mesa 1", "Mesa 2"])).toBe("Mesa 3");
    expect(suggestNextLabel(["Mesa 1", "Mesa 7", "mesa 3"])).toBe("Mesa 8");
    expect(suggestNextLabel(["Barra", "Terraza"])).toBe("Mesa 3");
    expect(suggestNextLabel(["Mesa 10 (afuera)"])).toBe("Mesa 2");
  });
});

describe("URL del QR", () => {
  const token = "c0ffee01000000000000000000000000";

  it("reconoce tokens y los arma sin barras de más", () => {
    expect(isToken(token)).toBe(true);
    for (const malo of ["", "abc", token.toUpperCase(), `${token}0`, token.slice(1), "g".repeat(32), null, 12]) {
      expect(isToken(malo), String(malo)).toBe(false);
    }
    expect(tableUrl("https://ucomenu.example", token)).toBe(`https://ucomenu.example/t/${token}`);
    expect(tableUrl("https://ucomenu.example///", token)).toBe(`https://ucomenu.example/t/${token}`);
  });

  const cabeceras = (valores: Record<string, string>) => ({ get: (nombre: string) => valores[nombre.toLowerCase()] ?? null });

  it("prefiere NEXT_PUBLIC_SITE_URL y la reduce a su origen", () => {
    expect(resolveBaseUrl(cabeceras({ host: "evil.test" }), "https://carta.example.com/panel?x=1")).toBe("https://carta.example.com");
    expect(resolveBaseUrl(cabeceras({}), "http://localhost:3000/")).toBe("http://localhost:3000");
  });

  it("rechaza una SITE_URL que no es http(s) o está rota (no cae al host del pedido)", () => {
    expect(resolveBaseUrl(cabeceras({ host: "ok.test" }), "javascript:alert(1)")).toBeNull();
    expect(resolveBaseUrl(cabeceras({ host: "ok.test" }), "no es una url")).toBeNull();
    expect(resolveBaseUrl(cabeceras({ host: "ok.test" }), "ftp://x.test")).toBeNull();
  });

  it("sin SITE_URL usa el host del pedido: http para local, https para el resto, respetando el proxy", () => {
    expect(resolveBaseUrl(cabeceras({ host: "localhost:3100" }), "")).toBe("http://localhost:3100");
    expect(resolveBaseUrl(cabeceras({ host: "127.0.0.1:3000" }), "")).toBe("http://127.0.0.1:3000");
    expect(resolveBaseUrl(cabeceras({ host: "carta.example.com" }), "")).toBe("https://carta.example.com");
    expect(
      resolveBaseUrl(cabeceras({ host: "interno:3000", "x-forwarded-host": "publico.example.com, otro.test", "x-forwarded-proto": "https" }), ""),
    ).toBe("https://publico.example.com");
    expect(resolveBaseUrl(cabeceras({ host: "x.test", "x-forwarded-proto": "ftp" }), "")).toBe("https://x.test");
  });

  it("descarta hosts mal formados o con basura (inyección de cabecera)", () => {
    for (const host of ["", "evil.test/ruta", "a b.test", "x.test\r\nSet-Cookie: a=b", "<script>", "evil.test@otro.test", "x.test:99999999", "-malo.test"]) {
      expect(resolveBaseUrl(cabeceras({ host }), ""), host).toBeNull();
    }
    expect(resolveBaseUrl(cabeceras({}), "")).toBeNull();
  });
});

describe("QR", () => {
  const url = tableUrl("http://localhost:3100", "c0ffee01000000000000000000000000");

  it("arma una matriz cuadrada de tamaño válido (17 + 4·versión) y es determinista", () => {
    const matriz = qrMatrix(url);
    expect(matriz.length).toBeGreaterThanOrEqual(21);
    expect((matriz.length - 17) % 4).toBe(0);
    expect(matriz.every((fila) => fila.length === matriz.length)).toBe(true);
    expect(qrMatrix(url)).toEqual(matriz);
  });

  it("tiene los tres patrones de posición (esquinas superiores e inferior izquierda) y el módulo oscuro", () => {
    const m = qrMatrix(url);
    const n = m.length;
    const finder = (r0: number, c0: number) => {
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
          const borde = r === 0 || r === 6 || c === 0 || c === 6;
          const centro = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          expect(m[r0 + r][c0 + c], `(${r0 + r},${c0 + c})`).toBe(borde || centro);
        }
      }
    };
    finder(0, 0);
    finder(0, n - 7);
    finder(n - 7, 0);
    expect(m[n - 8][8]).toBe(true); // módulo oscuro fijo de la norma
  });

  it("declara corrección de errores M en sus bits de formato (se lee de la matriz, no de la librería)", () => {
    const m = qrMatrix(url);
    const n = m.length;
    // Información de formato (15 bits), primera copia: ver ISO/IEC 18004 §7.9. Se le quita la máscara 0x5412.
    let bits = 0;
    for (let i = 0; i < 15; i++) {
      const row = i < 6 ? i : i < 8 ? i + 1 : n - 15 + i;
      if (m[row][8]) bits |= 1 << i;
    }
    const datos = (bits ^ 0x5412) >> 10; // 2 bits de nivel + 3 de máscara
    const nivel = datos >> 3;
    expect(nivel).toBe(0b00); // L=01, M=00, Q=11, H=10
    // La segunda copia, en el otro borde, dice lo mismo.
    let copia = 0;
    for (let i = 0; i < 15; i++) {
      const col = i < 8 ? n - i - 1 : 15 - i - (i < 9 ? 0 : 1);
      if (m[8][col]) copia |= 1 << i;
    }
    expect(copia).toBe(bits);
  });

  it("dos URL distintas dan matrices distintas (el token cambia el dibujo)", () => {
    const otra = tableUrl("http://localhost:3100", "c0ffee02000000000000000000000000");
    expect(qrMatrix(otra)).not.toEqual(qrMatrix(url));
  });

  it("el trazado SVG tiene un cuadrado por módulo oscuro, desplazado por la zona de silencio", () => {
    const m = qrMatrix(url);
    const oscuros = m.flat().filter(Boolean).length;
    const path = qrPath(m);
    expect(path.match(/M/g)).toHaveLength(oscuros);
    expect(qrViewSize(m)).toBe(m.length + 2 * QUIET_ZONE);
    // Vuelve a armar la matriz desde el trazado y compara.
    const rearmada = m.map((fila) => fila.map(() => false));
    for (const [, x, y] of path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) rearmada[Number(y) - QUIET_ZONE][Number(x) - QUIET_ZONE] = true;
    expect(rearmada).toEqual(m);
    // Nada dentro de la zona de silencio.
    for (const [, x, y] of path.matchAll(/M(\d+) (\d+)h/g)) {
      expect(Number(x)).toBeGreaterThanOrEqual(QUIET_ZONE);
      expect(Number(y)).toBeGreaterThanOrEqual(QUIET_ZONE);
      expect(Number(x)).toBeLessThan(m.length + QUIET_ZONE);
      expect(Number(y)).toBeLessThan(m.length + QUIET_ZONE);
    }
  });
});

describe("parseResolvedTable", () => {
  const valido = {
    org_slug: "cafe-ejemplo",
    org_name: "Café Ejemplo",
    branch_slug: "centro",
    table_label: "Mesa 1",
    table_active: true,
    status: "available",
    calls_enabled: true,
    likes_enabled: true,
  };

  it("lee una respuesta válida", () => {
    expect(parseResolvedTable(valido)).toEqual({
      orgSlug: "cafe-ejemplo",
      orgName: "Café Ejemplo",
      branchSlug: "centro",
      tableLabel: "Mesa 1",
      tableActive: true,
      status: "available",
      callsEnabled: true,
      likesEnabled: true,
    });
    expect(parseResolvedTable({ ...valido, calls_enabled: false })?.callsEnabled).toBe(false);
    expect(parseResolvedTable({ ...valido, likes_enabled: false })?.likesEnabled).toBe(false);
    // Los likes fallan cerrado: sin la clave o con otro tipo no se ofrecen, pero la mesa sigue resolviendo.
    const sinLikes: Record<string, unknown> = { ...valido };
    delete sinLikes.likes_enabled;
    expect(parseResolvedTable(sinLikes)?.likesEnabled).toBe(false);
    expect(parseResolvedTable({ ...valido, likes_enabled: "true" })?.likesEnabled).toBe(false);
    expect(parseResolvedTable({ ...valido, status: "suspended" })?.status).toBe("suspended");
  });

  it("cualquier forma inesperada es «no existe»", () => {
    expect(parseResolvedTable(null)).toBeNull();
    expect(parseResolvedTable("texto")).toBeNull();
    expect(parseResolvedTable([valido])).toBeNull();
    expect(parseResolvedTable({ ...valido, status: "otro" })).toBeNull();
    expect(parseResolvedTable({ ...valido, table_active: "true" })).toBeNull();
    expect(parseResolvedTable({ ...valido, calls_enabled: "true" })).toBeNull();
    expect(parseResolvedTable({ ...valido, org_slug: 5 })).toBeNull();
    const sinEtiqueta: Record<string, unknown> = { ...valido };
    delete sinEtiqueta.table_label;
    expect(parseResolvedTable(sinEtiqueta)).toBeNull();
  });
});

describe("mensajes", () => {
  const ent = (cambios: Partial<Entitlements>): Entitlements => ({
    state: "active",
    canWrite: true,
    features: [],
    limits: { tables_per_branch: 20 },
    usage: {},
    ...cambios,
  });

  it("el tope usa el número que viene de la base", () => {
    expect(mesasErrorMessage("limit", ent({}))).toContain("tope de 20 mesas activas");
    expect(mesasErrorMessage("limit", ent({ limits: { tables_per_branch: null } }))).not.toMatch(/\d/);
    expect(mesasErrorMessage("limit", null)).not.toMatch(/\d/);
  });

  it("distingue solo lectura de suspendida y falla cerrado sin estado", () => {
    expect(mesasWriteBlock(ent({}))).toBeNull();
    expect(mesasWriteBlock(ent({ state: "grace" }))).toBeNull();
    expect(mesasWriteBlock(ent({ state: "read_only", canWrite: false }))).toBe("blocked_read_only");
    expect(mesasWriteBlock(ent({ state: "suspended", canWrite: false }))).toBe("blocked_suspended");
    expect(mesasWriteBlock(null)).toBe("unexpected");
    expect(mesasBlockNotice(ent({ state: "read_only", canWrite: false }))).toContain("solo lectura");
    expect(mesasBlockNotice(ent({ state: "suspended", canWrite: false }))).toContain("suspendida");
    expect(mesasBlockNotice(ent({}))).toBeNull();
  });
});

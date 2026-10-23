import { describe, expect, it } from "vitest";
import { branchBreakdown, type Entitlements } from "@/lib/entitlements";
import { branchLimitMessage, sucursalesBlockNotice, sucursalesErrorMessage, sucursalesWriteBlock } from "./messages";
import { REVIEW_LINK_CASES } from "./resenas-casos";
import {
  BRANCH_NAME_MAX,
  BRANCH_TIME_ZONES,
  DEFAULT_BRANCH_TIME_ZONE,
  GOOGLE_REVIEW_HOSTS,
  REVIEW_URL_MAX,
  branchTimeZoneLabel,
  publicReviewUrl,
  suggestSlug,
  validateBranchName,
  validateBranchSlug,
  validateBranchTimeZone,
  validateReviewLink,
} from "./rules";

const ent = (over: Partial<Entitlements> = {}): Entitlements => ({
  state: "active",
  canWrite: true,
  features: [],
  limits: { branches: 2 },
  usage: { branches: 1 },
  ...over,
});

describe("validateBranchName", () => {
  it("recorta y acepta de 1 a 80 caracteres", () => {
    expect(validateBranchName("  Palermo  ")).toEqual({ ok: true, value: "Palermo" });
    expect(validateBranchName("x".repeat(BRANCH_NAME_MAX))).toMatchObject({ ok: true });
  });

  it("rechaza vacío, solo espacios, no texto y más de 80", () => {
    expect(validateBranchName("")).toEqual({ ok: false, problem: "blank" });
    expect(validateBranchName("   ")).toEqual({ ok: false, problem: "blank" });
    expect(validateBranchName(null)).toEqual({ ok: false, problem: "blank" });
    expect(validateBranchName("x".repeat(BRANCH_NAME_MAX + 1))).toEqual({ ok: false, problem: "too_long" });
  });

  it("cuenta caracteres, no unidades UTF-16 (igual que la base)", () => {
    expect(validateBranchName("😀".repeat(BRANCH_NAME_MAX))).toMatchObject({ ok: true });
    expect(validateBranchName("😀".repeat(BRANCH_NAME_MAX + 1))).toEqual({ ok: false, problem: "too_long" });
  });
});

describe("validateBranchSlug", () => {
  it("recorta y pasa a minúsculas, pero no arregla nada más", () => {
    expect(validateBranchSlug("  Palermo-2 ")).toEqual({ ok: true, value: "palermo-2" });
    expect(validateBranchSlug("a".repeat(64))).toMatchObject({ ok: true });
  });

  it("rechaza lo que la base rechazaría", () => {
    expect(validateBranchSlug("")).toEqual({ ok: false, problem: "blank" });
    expect(validateBranchSlug(7)).toEqual({ ok: false, problem: "blank" });
    for (const slug of ["con espacio", "ñandú", "-a", "a-", "a--b", "a_b", "a/b", "a".repeat(65)]) {
      expect(validateBranchSlug(slug), slug).toEqual({ ok: false, problem: "invalid" });
    }
  });
});

describe("suggestSlug", () => {
  it("saca acentos, pasa a minúsculas y junta con guiones simples", () => {
    expect(suggestSlug("Palermo Soho")).toBe("palermo-soho");
    expect(suggestSlug("  Ñandú & Cía.  ")).toBe("nandu-cia");
    expect(suggestSlug("Sucursal  N°  2")).toBe("sucursal-n-2");
  });

  it("lo que propone siempre es un identificador válido (o vacío)", () => {
    for (const name of ["Centro", "¡¡¡", "", "x".repeat(100), `${"a".repeat(63)} b`, "Ñ", "---"]) {
      const slug = suggestSlug(name);
      expect(slug === "" || validateBranchSlug(slug).ok, name).toBe(true);
      expect(slug.length).toBeLessThanOrEqual(64);
    }
  });
});

describe("mensajes", () => {
  it("el tope muestra el número del plan, en singular y plural, y nunca sale del texto del error", () => {
    expect(branchLimitMessage(ent({ limits: { branches: 1 } }))).toContain("incluye 1 sucursal y");
    expect(branchLimitMessage(ent({ limits: { branches: 2 } }))).toContain("incluye 2 sucursales y");
    expect(branchLimitMessage(null)).toContain("tope de sucursales");
    expect(sucursalesErrorMessage("limit", ent({ limits: { branches: 2 } }))).toBe(branchLimitMessage(ent({ limits: { branches: 2 } })));
    expect(branchLimitMessage(ent())).toContain("contactá a UcoMenu");
  });

  it("reactivar sin cupo explica la salida (desactivar otra) con el número del plan y dice que no se reactivó", () => {
    const uno = sucursalesErrorMessage("limit_reactivate", ent({ limits: { branches: 1 } }));
    expect(uno).toContain("incluye 1 sucursal activa y");
    expect(uno).toContain("desactivá otra");
    expect(uno).toContain("No se reactivó");
    expect(sucursalesErrorMessage("limit_reactivate", ent({ limits: { branches: 2 } }))).toContain("incluye 2 sucursales activas y");
    expect(sucursalesErrorMessage("limit_reactivate", null)).toContain("tope de sucursales activas");
    // Al crear, el tope también sugiere desactivar una.
    expect(branchLimitMessage(ent())).toContain("desactivá una");
  });

  it("todos los errores tienen mensaje propio", () => {
    for (const error of [
      "name_blank",
      "name_too_long",
      "slug_blank",
      "slug_invalid",
      "slug_duplicate",
      "review_link_invalid",
      "review_link_too_long",
      "time_zone_invalid",
      "limit",
      "limit_reactivate",
      "blocked_read_only",
      "blocked_suspended",
      "forbidden",
      "not_found",
      "unexpected",
    ] as const) {
      expect(sucursalesErrorMessage(error, null).length, error).toBeGreaterThan(10);
    }
  });

  it("la cuenta bloqueada se explica; sin dato del plan falla cerrado", () => {
    expect(sucursalesWriteBlock(ent())).toBeNull();
    expect(sucursalesBlockNotice(ent())).toBeNull();
    expect(sucursalesWriteBlock(ent({ state: "read_only", canWrite: false }))).toBe("blocked_read_only");
    expect(sucursalesWriteBlock(ent({ state: "suspended", canWrite: false }))).toBe("blocked_suspended");
    expect(sucursalesBlockNotice(ent({ state: "read_only", canWrite: false }))).toContain("solo lectura");
    expect(sucursalesBlockNotice(ent({ state: "suspended", canWrite: false }))).toContain("suspendida");
    expect(sucursalesWriteBlock(null)).toBe("unexpected");
  });
});

describe("sucursales adicionales (ficha sucursal-adicional)", () => {
  const conAdicional = (extra: number, over: Partial<Entitlements> = {}) =>
    ent({
      limits: { branches: 2 + extra },
      extraBranches: extra,
      extraBranchPriceCents: 1_200_000,
      extraBranchCurrency: "ARS",
      extraBranchMax: 3,
      ...over,
    });

  it("al llegar al tope, el Dueño de Pro lee «Pedí una sucursal adicional» con el precio", () => {
    const mensaje = branchLimitMessage(conAdicional(0));
    expect(mensaje).toContain("Pedí una sucursal adicional a UcoMenu (ARS 12.000/mes cada una)");
    expect(mensaje).toContain("desactivá una");
    expect(mensaje).not.toContain("cambiar de plan");
    const reactivar = sucursalesErrorMessage("limit_reactivate", conAdicional(1));
    expect(reactivar).toContain("Pedí una sucursal adicional");
    expect(reactivar).toContain("No se reactivó");
  });

  it("sin oferta (Básico, Premium, Staff o ya en el máximo) queda la salida de siempre y nunca un precio", () => {
    for (const e of [ent(), conAdicional(3), ent({ extraBranchMax: undefined, extraBranches: undefined })]) {
      const mensaje = branchLimitMessage(e);
      expect(mensaje).toContain("contactá a UcoMenu para cambiar de plan");
      expect(mensaje).not.toMatch(/ARS|12\.000/);
    }
  });

  it("el desglose cuenta las del plan y las adicionales con su costo; sin adicionales no hay desglose", () => {
    expect(branchBreakdown(conAdicional(1))).toBe("2 del plan + 1 adicional · ARS 12.000/mes");
    expect(branchBreakdown(conAdicional(2))).toBe("2 del plan + 2 adicionales · ARS 24.000/mes");
    expect(branchBreakdown(conAdicional(0))).toBeNull();
    expect(branchBreakdown(ent())).toBeNull();
    expect(branchBreakdown(null)).toBeNull();
    expect(branchBreakdown(ent({ limits: { branches: null as unknown as number }, extraBranches: 1 }))).toBeNull();
  });
});

describe("validateReviewLink (ficha enlace-de-resenas-de-google)", () => {
  it("responde según la tabla de casos que también recorre la prueba de la base", () => {
    for (const { url, valid } of REVIEW_LINK_CASES) {
      expect(validateReviewLink(url).ok, JSON.stringify(url)).toBe(valid);
    }
  });

  it("recorta los espacios de los bordes, y vacío o ausente lo quita", () => {
    expect(validateReviewLink("  https://g.page/r/abc/review \n")).toEqual({ ok: true, value: "https://g.page/r/abc/review" });
    for (const vacio of ["", "   ", undefined, null]) expect(validateReviewLink(vacio), String(vacio)).toEqual({ ok: true, value: null });
    expect(validateReviewLink(42)).toEqual({ ok: false, problem: "invalid" });
  });

  it("distingue lo demasiado largo de lo que no es de Google", () => {
    expect(validateReviewLink("https://g.page/" + "a".repeat(REVIEW_URL_MAX))).toEqual({ ok: false, problem: "too_long" });
    expect(validateReviewLink("https://example.com/a")).toEqual({ ok: false, problem: "invalid" });
    expect(validateReviewLink("https://g.page/" + "a".repeat(REVIEW_URL_MAX - "https://g.page/".length)).ok).toBe(true);
  });

  it("la lista de hosts no tiene comodines ni repetidos", () => {
    expect(new Set(GOOGLE_REVIEW_HOSTS).size).toBe(GOOGLE_REVIEW_HOSTS.length);
    for (const host of GOOGLE_REVIEW_HOSTS) expect(host).toMatch(/^[a-z0-9.]+$/);
  });
});

describe("publicReviewUrl (ficha invitacion-a-resenar)", () => {
  it("la carta solo usa lo que cumple la lista de Google, sin recortar ni arreglar nada", () => {
    for (const { url, valid } of REVIEW_LINK_CASES) expect(publicReviewUrl(url), JSON.stringify(url)).toBe(valid ? url : null);
    expect(publicReviewUrl(" https://g.page/r/abc/review")).toBeNull();
  });
  it("sin enlace o con un valor que no es texto no hay invitación", () => {
    for (const v of [null, undefined, "", 42, {}]) expect(publicReviewUrl(v), String(v)).toBeNull();
  });
});

describe("zona horaria de la sucursal (ficha zona-horaria-por-sucursal)", () => {
  it("la zona por defecto es Buenos Aires y está en la lista", () => {
    expect(DEFAULT_BRANCH_TIME_ZONE).toBe("America/Argentina/Buenos_Aires");
    expect(validateBranchTimeZone(DEFAULT_BRANCH_TIME_ZONE)).toEqual({ ok: true, value: DEFAULT_BRANCH_TIME_ZONE });
  });

  it("acepta solo las zonas de la lista, tal cual", () => {
    for (const { id } of BRANCH_TIME_ZONES) expect(validateBranchTimeZone(id), id).toEqual({ ok: true, value: id });
    for (const malo of ["", " America/Lima", "america/lima", "America/Lima ", "EST", "UTC", "Etc/GMT+3", "posix/America/Lima", "America/Nowhere", 42, null, undefined, {}]) {
      expect(validateBranchTimeZone(malo), String(malo)).toEqual({ ok: false, problem: "invalid" });
    }
  });

  it("la lista no repite zonas ni etiquetas, y este Node conoce cada una (el cálculo de promociones la usa con Intl)", () => {
    expect(new Set(BRANCH_TIME_ZONES.map((z) => z.id)).size).toBe(BRANCH_TIME_ZONES.length);
    expect(new Set(BRANCH_TIME_ZONES.map((z) => z.label)).size).toBe(BRANCH_TIME_ZONES.length);
    // Una zona desconocida lanza RangeError (el nombre que devuelve `resolvedOptions` puede ser un alias canónico, no se compara).
    for (const { id } of BRANCH_TIME_ZONES) expect(() => new Intl.DateTimeFormat("en-US", { timeZone: id }), id).not.toThrow();
    expect(() => new Intl.DateTimeFormat("en-US", { timeZone: "America/Nowhere" })).toThrow(RangeError);
  });

  it("la medianoche de cada sucursal cae en su propio día (Buenos Aires UTC−3, Madrid UTC+1 en invierno)", () => {
    const dia = (iso: string, timeZone: string) =>
      new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
    expect(dia("2026-12-21T02:30:00Z", "America/Argentina/Buenos_Aires")).toBe("2026-12-20");
    expect(dia("2026-12-21T02:30:00Z", "Europe/Madrid")).toBe("2026-12-21");
  });

  it("el nombre que se muestra sale de la lista; una zona desconocida se muestra tal cual", () => {
    expect(branchTimeZoneLabel("America/Lima")).toBe("Perú (Lima)");
    expect(branchTimeZoneLabel("Asia/Tokyo")).toBe("Asia/Tokyo");
  });
});

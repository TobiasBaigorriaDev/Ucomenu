import { afterEach, describe, expect, it, vi } from "vitest";
import { createGeminiSummaryProvider, getSummaryProvider } from "./proveedor-resumen";
import { buildFacts } from "./resumen";
import { parseProducts, parseSales } from "./ventas";

const TOTALES = { orders: 5, revenue_cents: 100000, units: 9, promo_discount_cents: 0, voided_orders: 0, voided_cents: 0, cancelled_units: 0, cancelled_cents: 0, median_minutes: 40 };
const sales = parseSales({
  days: 7,
  current: TOTALES,
  previous: { ...TOTALES, orders: 0, revenue_cents: 0, units: 0, median_minutes: null },
  by_day: [],
  by_slot: [],
  by_category: [],
  void_reasons: [{ reason: "Nombre y teléfono de un comensal", orders: 0, cents: 0 }],
  cancel_reasons: [],
})!;
const products = parseProducts({ best: [], unsold: [], unsold_total: 0 })!;
const facts = buildFacts(sales, products, { timeZone: "America/Argentina/Buenos_Aires", allBranches: true });
const config = { apiKey: "SECRETA", model: "modelo-x", origin: "http://127.0.0.1:4011" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("createGeminiSummaryProvider", () => {
  it("manda la clave en el encabezado, las instrucciones aparte y SOLO los hechos como mensaje, y devuelve el JSON", async () => {
    const resumen = { summary: "Algo.", highlights: [], actions: [] };
    const fetchMock = vi.fn(async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(resumen) }] } }] }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await createGeminiSummaryProvider(config).summarize(facts)).toEqual(resumen);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:4011/v1beta/models/modelo-x:generateContent");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("SECRETA");
    const body = JSON.parse(init.body as string);
    expect(body.systemInstruction.parts[0].text).toContain("business summary");
    expect(JSON.parse(body.contents[0].parts[0].text)).toEqual(JSON.parse(JSON.stringify(facts)));
    expect(body.contents[0].parts[0].text).not.toContain("teléfono");
    expect(body.generationConfig.responseMimeType).toBe("application/json");
  });
  it("una respuesta vacía, bloqueada o que no es JSON da null (la validación la rechaza)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ candidates: [] })));
    expect(await createGeminiSummaryProvider(config).summarize(facts)).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ candidates: [{ content: { parts: [{ text: "no es json" }] } }] })));
    expect(await createGeminiSummaryProvider(config).summarize(facts)).toBeNull();
  });
  it("un error del servicio falla sin repetir el cuerpo (puede traer las cifras del local)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ventas 100000", { status: 500 })));
    await expect(createGeminiSummaryProvider(config).summarize(facts)).rejects.toThrow("Gemini respondió 500.");
  });
});

describe("getSummaryProvider", () => {
  it("sin clave la función queda apagada; con clave hay proveedor", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(getSummaryProvider()).toBeNull();
    vi.stubEnv("GEMINI_API_KEY", "k");
    expect(getSummaryProvider()?.name).toBe("gemini");
  });
});

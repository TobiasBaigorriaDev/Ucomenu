import { afterEach, describe, expect, it, vi } from "vitest";
import { createGeminiProvider, getTranslationProvider, parseAnswer, resolveOrigin } from "./gemini";
import type { SuggestionItem } from "./sugerir";

const items: SuggestionItem[] = [{ key: "c:1:name", field: "name", kind: "category", text: "Bebidas" }];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("parseAnswer", () => {
  it("convierte [{key, text}] en un objeto y descarta lo que no tiene esa forma", () => {
    expect(parseAnswer(JSON.stringify([{ key: "a", text: "A" }, { key: "b" }, "x", { key: 1, text: "y" }]))).toEqual({ a: "A" });
  });
  it("texto que no es JSON o no es una lista da vacío", () => {
    expect(parseAnswer("no es json")).toEqual({});
    expect(parseAnswer('{"a":"A"}')).toEqual({});
  });
});

describe("createGeminiProvider", () => {
  it("manda la clave en el encabezado (no en la dirección) y los textos como datos, y lee la respuesta", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify([{ key: "c:1:name", text: "Drinks" }]) }] } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await createGeminiProvider("SECRETA", "modelo-x").translate(items, "en");
    expect(result).toEqual({ "c:1:name": "Drinks" });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/models/modelo-x:generateContent");
    expect(url).not.toContain("SECRETA");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("SECRETA");
    const body = JSON.parse(init.body as string);
    expect(body.systemInstruction.parts[0].text).toContain("English");
    expect(JSON.parse(body.contents[0].parts[0].text)).toEqual([{ key: "c:1:name", type: "menu category name", text: "Bebidas" }]);
  });
  it("una respuesta con error falla sin repetir el cuerpo (puede traer los textos de la carta)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Bebidas… detalle", { status: 429 })));
    await expect(createGeminiProvider("k").translate(items, "pt")).rejects.toThrow("Gemini respondió 429.");
  });
  it("una respuesta bloqueada o vacía no da traducciones", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ candidates: [] })));
    expect(await createGeminiProvider("k").translate(items, "en")).toEqual({});
  });
});

describe("getTranslationProvider", () => {
  it("sin clave la función queda apagada", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(getTranslationProvider()).toBeNull();
    vi.stubEnv("GEMINI_API_KEY", "   ");
    expect(getTranslationProvider()).toBeNull();
  });
  it("con clave hay proveedor", () => {
    vi.stubEnv("GEMINI_API_KEY", "k");
    expect(getTranslationProvider()?.name).toBe("gemini");
  });
});

describe("resolveOrigin", () => {
  it("solo acepta una dirección de la propia máquina; cualquier otra vuelve a Google", () => {
    const google = "https://generativelanguage.googleapis.com";
    expect(resolveOrigin(undefined)).toBe(google);
    expect(resolveOrigin("http://127.0.0.1:4011")).toBe("http://127.0.0.1:4011");
    expect(resolveOrigin("http://localhost:4011/x")).toBe("http://localhost:4011");
    expect(resolveOrigin("https://otro-host.example")).toBe(google);
    expect(resolveOrigin("no es una url")).toBe(google);
  });
});

import { describe, expect, it } from "vitest";
import { callMessage, type CallKind, type CallResult } from "@/lib/llamados/result";
import { LANGS } from "./idiomas";
import { TEXTOS } from "./textos";

/** Recorre todos los textos de un idioma: cadenas y funciones (con argumentos de ejemplo). */
function collect(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (typeof value === "function") {
    const call = value as (...args: unknown[]) => unknown;
    return [call("Ejemplo", 2), call(1, 1), call(2, 5)]
      .filter((text): text is string => typeof text === "string")
      .map((text, i) => [`${path}()${i}`, text]);
  }
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, child]) => collect(child, path ? `${path}.${key}` : key));
  return [];
}

describe("textos de la carta", () => {
  it("los tres idiomas tienen exactamente los mismos textos", () => {
    const keys = (lang: (typeof LANGS)[number]) => collect(TEXTOS[lang]).map(([path]) => path);
    expect(keys("en")).toEqual(keys("es"));
    expect(keys("pt")).toEqual(keys("es"));
  });
  it("ningún texto está vacío", () => {
    for (const lang of LANGS) for (const [path, text] of collect(TEXTOS[lang])) expect(text.trim(), `${lang}.${path}`).not.toBe("");
  });
  it("no queda una carta a medio traducir: en inglés y portugués casi nada coincide con el español", () => {
    // Coinciden de forma legítima los nombres propios, el pie «Made with UcoMenu» no (se traduce) y poco más.
    const es = new Map(collect(TEXTOS.es));
    const allowed = /logoAlt|branch|photoAlt|vegano|vegetarian|dietary\.vegan|dietary\.vegetarian|sending|unavailableTitle|languageLabel|legal\.privacy|allergenLink|legal\.allergens/;
    for (const lang of ["en", "pt"] as const) {
      const same = collect(TEXTOS[lang]).filter(([path, text]) => es.get(path) === text && !allowed.test(path));
      expect(same.map(([path]) => path), lang).toEqual([]);
    }
  });
  it("el pluralizado de platos", () => {
    expect([TEXTOS.es.count.dishes(1), TEXTOS.es.count.dishes(3)]).toEqual(["1 plato", "3 platos"]);
    expect([TEXTOS.en.count.dishes(1), TEXTOS.en.count.dishes(3)]).toEqual(["1 dish", "3 dishes"]);
    expect([TEXTOS.pt.count.dishes(1), TEXTOS.pt.count.dishes(3)]).toEqual(["1 prato", "3 pratos"]);
    expect(TEXTOS.es.count.status(2, true)).toBe("2 platos encontrados");
    expect(TEXTOS.es.count.status(1, false)).toBe("1 plato en la carta");
  });
  it("las reglas de elección en cada idioma", () => {
    const rules = (lang: (typeof LANGS)[number]) => [TEXTOS[lang].options.rule(1, 1), TEXTOS[lang].options.rule(0, 3), TEXTOS[lang].options.rule(1, 3)];
    expect(rules("es")).toEqual(["Elegí 1", "Opcional · hasta 3", "Elegí de 1 a 3"]);
    expect(rules("en")).toEqual(["Choose 1", "Optional · up to 3", "Choose 1 to 3"]);
    expect(rules("pt")).toEqual(["Escolha 1", "Opcional · até 3", "Escolha de 1 a 3"]);
  });
});

describe("mensajes del llamado en cada idioma", () => {
  const results: CallResult[] = [
    { status: "created" },
    { status: "already_pending" },
    { status: "cooldown", retryAfterSeconds: 1 },
    { status: "cooldown", retryAfterSeconds: 42 },
    { status: "rate_limited", retryAfterSeconds: 90 },
    { status: "session_closed" },
    { status: "unavailable" },
    { status: "not_found" },
  ];
  it("todos los resultados tienen mensaje, con el mismo tono que en español", () => {
    for (const lang of LANGS) {
      for (const kind of ["waiter", "bill"] as CallKind[]) {
        for (const result of results) {
          const message = callMessage(kind, result, lang);
          expect(message.text.trim(), `${lang} ${kind} ${result.status}`).not.toBe("");
          expect(message.tone).toBe(callMessage(kind, result, "es").tone);
        }
      }
    }
  });
  it("los mensajes de «no disponible» no revelan plan, pago ni estado de la cuenta, en ningún idioma", () => {
    for (const lang of LANGS) {
      for (const status of ["unavailable", "not_found"] as const) {
        expect(callMessage("waiter", { status }, lang).text).not.toMatch(/plan|pago|payment|mora|silenc|mute|inactiv|suscrip|subscri|b[aá]sico|basic|\bpro\b/i);
      }
    }
  });
  it("el plural del tiempo", () => {
    expect(callMessage("waiter", { status: "cooldown", retryAfterSeconds: 1 }, "en").text).toContain("in 1 second.");
    expect(callMessage("waiter", { status: "cooldown", retryAfterSeconds: 42 }, "pt").text).toContain("em 42 segundos.");
    expect(callMessage("waiter", { status: "rate_limited", retryAfterSeconds: 5 }, "en").text).toContain("in 1 minute.");
  });
});

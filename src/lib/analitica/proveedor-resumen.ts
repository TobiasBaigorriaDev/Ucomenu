import { callGemini, geminiConfig, type GeminiConfig } from "@/lib/idiomas/gemini";
import { SUMMARY_SYSTEM_PROMPT, summaryUserMessage, type SummaryProvider } from "./resumen";

/**
 * Proveedor del resumen de la analítica (ficha resumen-de-analitica-con-ia, ADR 0047). Hoy Gemini, con la misma clave y el mismo
 * entorno que las sugerencias de traducción. **Solo para datos ficticios** mientras se use la clave gratuita (Google puede usar
 * lo que se envía para mejorar sus productos): antes de producción este punto pasa a Claude u otro servicio de pago, con otra
 * implementación de `SummaryProvider` y sin tocar la pantalla.
 */

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    highlights: {
      type: "ARRAY",
      items: { type: "OBJECT", properties: { title: { type: "STRING" }, detail: { type: "STRING" } }, required: ["title", "detail"] },
    },
    actions: {
      type: "ARRAY",
      items: { type: "OBJECT", properties: { action: { type: "STRING" }, reason: { type: "STRING" } }, required: ["action", "reason"] },
    },
  },
  required: ["summary", "highlights", "actions"],
};

export function createGeminiSummaryProvider(config: GeminiConfig): SummaryProvider {
  return {
    name: "gemini",
    async summarize(facts) {
      const text = await callGemini(config, { system: SUMMARY_SYSTEM_PROMPT, user: summaryUserMessage(facts), schema: RESPONSE_SCHEMA, temperature: 0.3 });
      if (!text) return null;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return null;
      }
    },
  };
}

/** El proveedor configurado, o `null` si falta la clave (la función queda apagada y el botón no aparece). */
export function getSummaryProvider(): SummaryProvider | null {
  const config = geminiConfig();
  return config ? createGeminiSummaryProvider(config) : null;
}

import { describe, expect, it } from "vitest";
import { readBodyLimited } from "./cuerpo";

const enc = new TextEncoder();

/** Un cuerpo que entrega `piezas` de a una y cuenta cuántas se llegaron a leer. */
function cuerpoPorPartes(piezas: string[]) {
  let leidas = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (leidas >= piezas.length) return controller.close();
      controller.enqueue(enc.encode(piezas[leidas]));
      leidas += 1;
    },
  });
  return { stream, leidas: () => leidas };
}

const pedido = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/vista-plato", { method: "POST", body, headers, ...(body instanceof ReadableStream ? { duplex: "half" } : {}) } as RequestInit);

describe("leer un cuerpo con tope", () => {
  it("un cuerpo chico se lee entero, también con tildes (UTF-8)", async () => {
    expect(await readBodyLimited(pedido('{"branch":"á","product":"ñ"}'), 512)).toBe('{"branch":"á","product":"ñ"}');
    expect(await readBodyLimited(pedido(null), 512)).toBe("");
  });

  it("justo en el tope se acepta y un byte más se rechaza", async () => {
    expect(await readBodyLimited(pedido("x".repeat(10)), 10)).toBe("x".repeat(10));
    expect(await readBodyLimited(pedido("x".repeat(11)), 10)).toBeNull();
  });

  it("si el encabezado ya declara de más, se rechaza sin leer nada", async () => {
    const { stream, leidas } = cuerpoPorPartes(["x".repeat(5), "x".repeat(5)]);
    expect(await readBodyLimited(pedido(stream, { "content-length": "9999" }), 100)).toBeNull();
    expect(leidas()).toBe(0);
  });

  it("sin content-length (por partes) o con uno que miente, se corta apenas se supera el tope: no se lee todo", async () => {
    const piezas = Array.from({ length: 1000 }, () => "x".repeat(100)); // 100 kB en total
    const { stream, leidas } = cuerpoPorPartes(piezas);
    expect(await readBodyLimited(pedido(stream, { "content-length": "10" }), 512)).toBeNull();
    // Con piezas de 100 bytes y un tope de 512, alcanza con leer 6 (más alguna adelantada por el propio stream), nunca las 1000.
    expect(leidas()).toBeLessThan(20);
  });

  it("un cuerpo que falla a mitad de camino es ilegible (null), no una excepción", async () => {
    const roto = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("conexión cortada"));
      },
    });
    expect(await readBodyLimited(pedido(roto), 512)).toBeNull();
  });
});

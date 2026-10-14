import { describe, expect, it } from "vitest";
import { detectImage, imagePath, imageUrl, isOwnImagePath, MAX_IMAGE_BYTES } from "./images";
import { changesFor, moveWithin, nextSortOrder, sortForDisplay } from "./ordering";
import { MAX_PRICE_CENTS, parsePrice, priceToInput } from "./price";
import { asUuid, DESCRIPTION_MAX, NAME_MAX, validateDescription, validateName } from "./validation";

describe("parsePrice", () => {
  it.each([
    ["2800", 280000],
    ["2.800", 280000],
    ["2800,5", 280050],
    ["2800,50", 280050],
    ["2.800,50", 280050],
    ["1.234.567,89", 123456789],
    ["$ 2.800", 280000],
    ["  $2800  ", 280000],
    ["2800.50", 280050],
    ["2800.5", 280050],
    ["2.80", 280], // punto con 2 cifras: decimal, no miles
    ["0", 0],
    ["0,99", 99],
    ["007", 700],
  ])("%s -> %i centavos", (text, cents) => {
    expect(parsePrice(text)).toEqual({ ok: true, cents });
  });

  it.each([
    ["", "blank"],
    ["   ", "blank"],
    ["$", "blank"],
    ["abc", "invalid"],
    ["-100", "invalid"],
    ["1e3", "invalid"],
    ["28,00,5", "invalid"],
    ["12.34.56", "invalid"],
    ["2800,", "invalid"],
    [",50", "invalid"],
    ["2800,5a", "invalid"],
    ["2800,555", "too_many_decimals"],
    ["99999999999", "too_big"],
    ["10.000.001", "too_big"],
  ])("rechaza %j (%s)", (text, problem) => {
    expect(parsePrice(text)).toEqual({ ok: false, problem });
  });

  it("acepta el máximo y rechaza un centavo más", () => {
    expect(parsePrice("10.000.000")).toEqual({ ok: true, cents: MAX_PRICE_CENTS });
    expect(parsePrice("10.000.000,01")).toEqual({ ok: false, problem: "too_big" });
  });

  it("no es una cadena: un valor que no es texto se trata como vacío", () => {
    expect(parsePrice(undefined)).toEqual({ ok: false, problem: "blank" });
    expect(parsePrice(null)).toEqual({ ok: false, problem: "blank" });
    expect(parsePrice(1200)).toEqual({ ok: false, problem: "blank" });
  });

  it("no pierde centavos por coma flotante", () => {
    expect(parsePrice("1234567,89")).toEqual({ ok: true, cents: 123456789 });
    expect(parsePrice("19,99")).toEqual({ ok: true, cents: 1999 });
    expect(parsePrice("4,35")).toEqual({ ok: true, cents: 435 });
  });
});

describe("priceToInput", () => {
  it("es la inversa de parsePrice para los precios guardados", () => {
    for (const cents of [0, 5, 99, 100, 280000, 280050, 123456789, MAX_PRICE_CENTS]) {
      const text = priceToInput(cents);
      expect(parsePrice(text)).toEqual({ ok: true, cents });
    }
  });
});

describe("validateName / validateDescription", () => {
  it("recorta los espacios y rechaza vacío o demasiado largo", () => {
    expect(validateName("  Milanesa  ")).toEqual({ ok: true, value: "Milanesa" });
    expect(validateName("   ")).toEqual({ ok: false, problem: "blank" });
    expect(validateName(undefined)).toEqual({ ok: false, problem: "blank" });
    expect(validateName("a".repeat(NAME_MAX))).toEqual({ ok: true, value: "a".repeat(NAME_MAX) });
    expect(validateName("a".repeat(NAME_MAX + 1))).toEqual({ ok: false, problem: "too_long" });
  });

  it("cuenta caracteres, no unidades UTF-16", () => {
    expect(validateName("🍕".repeat(NAME_MAX)).ok).toBe(true);
    expect(validateName("🍕".repeat(NAME_MAX + 1)).ok).toBe(false);
  });

  it("la descripción es opcional y vacía queda en null", () => {
    expect(validateDescription("")).toEqual({ ok: true, value: null });
    expect(validateDescription("   ")).toEqual({ ok: true, value: null });
    expect(validateDescription(undefined)).toEqual({ ok: true, value: null });
    expect(validateDescription(" Con papas ")).toEqual({ ok: true, value: "Con papas" });
    expect(validateDescription("a".repeat(DESCRIPTION_MAX + 1))).toEqual({ ok: false, problem: "too_long" });
  });
});

describe("asUuid", () => {
  it("solo deja pasar uuids", () => {
    expect(asUuid("13000000-0000-4000-8000-000000000001")).toBe("13000000-0000-4000-8000-000000000001");
    expect(asUuid("13000000-0000-4000-8000-00000000000G")).toBeNull();
    expect(asUuid("1; drop table products")).toBeNull();
    expect(asUuid("")).toBeNull();
    expect(asUuid(null)).toBeNull();
    expect(asUuid(["13000000-0000-4000-8000-000000000001"])).toBeNull();
  });
});

describe("orden", () => {
  const item = (id: string, name: string, sort_order: number) => ({ id, name, sort_order });
  const items = [item("c", "Cafe", 2), item("a", "Agua", 0), item("b", "Batido", 1)];

  it("ordena como la carta pública: orden y luego nombre", () => {
    expect(sortForDisplay(items).map((i) => i.id)).toEqual(["a", "b", "c"]);
    const empate = [item("z", "Zeta", 0), item("a", "Alfa", 0)];
    expect(sortForDisplay(empate).map((i) => i.id)).toEqual(["a", "z"]);
  });

  it("mueve un lugar y no pasa de los bordes", () => {
    expect(moveWithin(items, "b", "up")).toEqual(["b", "a", "c"]);
    expect(moveWithin(items, "b", "down")).toEqual(["a", "c", "b"]);
    expect(moveWithin(items, "a", "up")).toBeNull();
    expect(moveWithin(items, "c", "down")).toBeNull();
    expect(moveWithin(items, "x", "up")).toBeNull();
  });

  it("con números repetidos, mueve según lo que se VE y renumera sin repetidos", () => {
    const repetidos = [item("z", "Zeta", 0), item("a", "Alfa", 0), item("m", "Mora", 0)];
    // Se ve: Alfa, Mora, Zeta. Subir Zeta la deja entre Alfa y Mora.
    const final = moveWithin(repetidos, "z", "up")!;
    expect(final).toEqual(["a", "z", "m"]);
    expect(changesFor(repetidos, final)).toEqual([
      { id: "z", sort_order: 1 },
      { id: "m", sort_order: 2 },
    ]);
  });

  it("changesFor solo devuelve lo que cambia", () => {
    expect(changesFor(items, ["a", "b", "c"])).toEqual([]);
    expect(changesFor(items, ["b", "a", "c"])).toEqual([
      { id: "b", sort_order: 0 },
      { id: "a", sort_order: 1 },
    ]);
  });

  it("lo nuevo va al final", () => {
    expect(nextSortOrder([])).toBe(0);
    expect(nextSortOrder(items)).toBe(3);
    expect(nextSortOrder([{ sort_order: 7 }, { sort_order: 2 }])).toBe(8);
  });
});

describe("imágenes", () => {
  const bytes = (...values: number[]) => Uint8Array.from(values);
  const ascii = (text: string) => Uint8Array.from([...text].map((c) => c.charCodeAt(0)));

  it("reconoce JPEG, PNG y WebP por su firma", () => {
    expect(detectImage(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toEqual({ ext: "jpg", mime: "image/jpeg" });
    expect(detectImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toEqual({ ext: "png", mime: "image/png" });
    const webp = new Uint8Array(16);
    webp.set(ascii("RIFF"), 0);
    webp.set(ascii("WEBP"), 8);
    expect(detectImage(webp)).toEqual({ ext: "webp", mime: "image/webp" });
  });

  it("rechaza HTML, SVG, GIF, vacío y firmas truncadas aunque se llamen .jpg", () => {
    expect(detectImage(ascii("<html><script>alert(1)</script>"))).toBeNull();
    expect(detectImage(ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(detectImage(ascii("GIF89a......"))).toBeNull();
    expect(detectImage(new Uint8Array())).toBeNull();
    expect(detectImage(bytes(0xff, 0xd8))).toBeNull();
    expect(detectImage(ascii("RIFF....WAVE"))).toBeNull();
  });

  it("el tope coincide con el del bucket (2 MB)", () => {
    expect(MAX_IMAGE_BYTES).toBe(2 * 1024 * 1024);
  });

  it("arma rutas de la carpeta del plato y reconoce las ajenas", () => {
    const org = "10000000-0000-4000-8000-000000000001";
    const product = "13000000-0000-4000-8000-000000000001";
    const path = imagePath(org, product, "png");
    expect(isOwnImagePath(path, org, product)).toBe(true);
    expect(isOwnImagePath(path, "20000000-0000-4000-8000-000000000001", product)).toBe(false);
    expect(isOwnImagePath(path, org, "13000000-0000-4000-8000-000000000002")).toBe(false);
    expect(isOwnImagePath(`${org}/${product}/../x.png`, org, product)).toBe(false);
    expect(isOwnImagePath(`${org}/${product}/foto.png`, org, product)).toBe(false);
  });

  it("imageUrl devuelve null sin ruta", () => {
    expect(imageUrl(null)).toBeNull();
    expect(imageUrl("")).toBeNull();
  });
});

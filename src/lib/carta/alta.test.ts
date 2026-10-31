import { describe, expect, it } from "vitest";
import { parseAltaExtras } from "./alta";
import { BRANCH_PRICE_FIELD, parsePending } from "./alta-campos";
import { MAX_IMAGE_BYTES } from "./images";
import { MAX_GROUPS_PER_PRODUCT, MAX_OPTIONS_PER_GROUP } from "./options-rules";

const BRANCH = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const form = (fields: Record<string, string | File>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const group = (overrides: Record<string, unknown> = {}) => ({ name: "Tamaño", min: "1", max: "1", options: [{ name: "Grande", delta: "300" }], ...overrides });
const parse = (fields: Record<string, string | File>, shown: string[] = [BRANCH]) => parseAltaExtras(form(fields), new Set(shown));

describe("alta unificada: validación previa a crear el plato", () => {
  it("sin foto, grupos ni precios no hay nada accesorio", async () => {
    expect(await parse({})).toEqual({ ok: true, data: { photo: null, groups: [], branchPrices: [] } });
    expect(await parse({ groups: "[]", photo: new File([], "vacio.png") })).toMatchObject({ ok: true, data: { photo: null, groups: [] } });
  });

  it("acepta una foto por sus bytes y rechaza la que no es imagen o pesa demasiado", async () => {
    const good = await parse({ photo: new File([PNG], "foto.png", { type: "image/png" }) });
    expect(good).toMatchObject({ ok: true });
    expect(await parse({ photo: new File(["<svg/>"], "foto.png", { type: "image/png" }) })).toEqual({ ok: false, error: "image_type" });
    expect(await parse({ photo: new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], "grande.png") })).toEqual({ ok: false, error: "image_big" });
  });

  it("acepta grupos con sus opciones y conserva el orden", async () => {
    const groups = [group(), group({ name: "Extras", min: "0", max: "3", options: [{ name: "Queso", delta: "" }, { name: "Huevo", delta: "1.250,50" }] })];
    const result = await parse({ groups: JSON.stringify(groups) });
    expect(result).toMatchObject({ ok: true, data: { groups } });
  });

  it("rechaza grupos u opciones inválidos antes de crear nada", async () => {
    expect(await parse({ groups: JSON.stringify([group({ name: "  " })]) })).toEqual({ ok: false, error: "name_blank" });
    expect(await parse({ groups: JSON.stringify([group({ min: "2", max: "1" })]) })).toEqual({ ok: false, error: "choices_min_over_max" });
    expect(await parse({ groups: JSON.stringify([group({ options: [{ name: "", delta: "" }] })]) })).toEqual({ ok: false, error: "name_blank" });
    expect(await parse({ groups: JSON.stringify([group({ options: [{ name: "X", delta: "abc" }] })]) })).toEqual({ ok: false, error: "price_invalid" });
  });

  it("falla cerrado ante una forma inesperada o más grupos y opciones que los topes", async () => {
    for (const raw of ["no es json", "{}", "[1]", JSON.stringify([{ name: "x" }]), JSON.stringify([group({ options: [{ name: 1, delta: "" }] })])]) {
      expect(await parse({ groups: raw })).toEqual({ ok: false, error: "unexpected" });
    }
    expect(await parse({ groups: JSON.stringify(Array.from({ length: MAX_GROUPS_PER_PRODUCT + 1 }, () => group())) })).toEqual({ ok: false, error: "group_cap" });
    const options = Array.from({ length: MAX_OPTIONS_PER_GROUP + 1 }, () => ({ name: "o", delta: "" }));
    expect(await parse({ groups: JSON.stringify([group({ options })]) })).toEqual({ ok: false, error: "option_cap" });
  });

  it("toma el precio propio solo de las sucursales donde se muestra y valida el formato", async () => {
    const result = await parse({ [`${BRANCH_PRICE_FIELD}${BRANCH}`]: "2.800,50", [`${BRANCH_PRICE_FIELD}${OTHER}`]: "100", [`${BRANCH_PRICE_FIELD}no-es-uuid`]: "5" });
    expect(result).toMatchObject({ ok: true, data: { branchPrices: [{ branchId: BRANCH, cents: 280050 }] } });
    // En blanco = precio general; el cero es un precio.
    expect(await parse({ [`${BRANCH_PRICE_FIELD}${BRANCH}`]: "  " })).toMatchObject({ ok: true, data: { branchPrices: [] } });
    expect(await parse({ [`${BRANCH_PRICE_FIELD}${BRANCH}`]: "0" })).toMatchObject({ ok: true, data: { branchPrices: [{ branchId: BRANCH, cents: 0 }] } });
    expect(await parse({ [`${BRANCH_PRICE_FIELD}${BRANCH}`]: "mucho" })).toEqual({ ok: false, error: "price_invalid" });
  });
});

describe("alta unificada: lo pendiente que informa el editor", () => {
  it("solo reconoce las piezas conocidas, sin repetir y en orden", () => {
    expect(parsePending("precios,foto,foto,otra")).toEqual(["foto", "precios"]);
    expect(parsePending(["opciones", "foto"])).toEqual(["foto", "opciones"]);
    expect(parsePending(undefined)).toEqual([]);
    expect(parsePending("")).toEqual([]);
  });
});

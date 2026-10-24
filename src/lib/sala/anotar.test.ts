import { describe, expect, it } from "vitest";
import {
  checkGroups,
  chosenIds,
  failureFromDb,
  fold,
  filterSections,
  groupHint,
  isStaleFailure,
  isUnfulfillable,
  noteProblem,
  normalizeNote,
  optionsCents,
  parseAddItemInput,
  previewCents,
  type AnotarGroup,
  type AnotarSection,
} from "./anotar";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const punto: AnotarGroup = {
  id: U(1),
  name: "Punto",
  min: 1,
  max: 1,
  options: [
    { id: U(11), name: "Jugoso", deltaCents: 0 },
    { id: U(12), name: "A punto", deltaCents: 0 },
  ],
};
const extras: AnotarGroup = {
  id: U(2),
  name: "Extras",
  min: 0,
  max: 2,
  options: [
    { id: U(21), name: "Bacon", deltaCents: 150_00 },
    { id: U(22), name: "Huevo", deltaCents: 100_00 },
    { id: U(23), name: "Queso", deltaCents: 120_00 },
  ],
};

describe("reglas de elección", () => {
  it("un grupo obligatorio sin elegir pide elegir; con una elegida está bien; con más del máximo se excede", () => {
    const sin = checkGroups([punto, extras], new Set());
    expect(sin.map((c) => c.problem)).toEqual(["required", null]);
    const una = checkGroups([punto, extras], new Set([U(11)]));
    expect(una.map((c) => c.problem)).toEqual([null, null]);
    const dos = checkGroups([punto], new Set([U(11), U(12)]));
    expect(dos[0]).toMatchObject({ chosen: 2, problem: "exceeded" });
    const tres = checkGroups([extras], new Set([U(21), U(22), U(23)]));
    expect(tres[0].problem).toBe("exceeded");
  });

  it("un mínimo mayor a las opciones que hay no se puede cumplir", () => {
    expect(isUnfulfillable({ min: 1, options: [] })).toBe(true);
    expect(isUnfulfillable({ min: 3, options: punto.options })).toBe(true);
    expect(isUnfulfillable(punto)).toBe(false);
    expect(isUnfulfillable({ min: 0, options: [] })).toBe(false);
  });

  it("solo viajan los ids elegidos que son de este plato, en el orden de la carta", () => {
    expect(chosenIds([punto, extras], new Set([U(22), U(12), U(99)]))).toEqual([U(12), U(22)]);
  });

  it("la vista previa es cantidad por (precio efectivo + diferencias de las opciones elegidas)", () => {
    const product = { priceCents: 1000_00, groups: [punto, extras] };
    expect(optionsCents(product.groups, new Set([U(11), U(21), U(22)]))).toBe(250_00);
    expect(previewCents(product, 2, new Set([U(11), U(21), U(22)]))).toBe(2 * (1000_00 + 250_00));
    expect(previewCents(product, 3, new Set())).toBe(3000_00);
    // Una diferencia negativa resta.
    const descuento: AnotarGroup = { id: U(3), name: "Tamaño", min: 1, max: 1, options: [{ id: U(31), name: "Chico", deltaCents: -200_00 }] };
    expect(previewCents({ priceCents: 1000_00, groups: [descuento] }, 1, new Set([U(31)]))).toBe(800_00);
  });

  it("describe lo que pide cada grupo", () => {
    expect(groupHint({ min: 1, max: 1 })).toBe("Elegí 1");
    expect(groupHint({ min: 2, max: 2 })).toBe("Elegí 2");
    expect(groupHint({ min: 0, max: 1 })).toBe("Opcional · hasta 1");
    expect(groupHint({ min: 0, max: 3 })).toBe("Opcional · hasta 3");
    expect(groupHint({ min: 1, max: 3 })).toBe("Elegí de 1 a 3");
  });
});

describe("observación", () => {
  it("se recorta y vacía es sin nota", () => {
    expect(normalizeNote("  sin cebolla  ")).toBe("sin cebolla");
    expect(normalizeNote("   ")).toBeNull();
  });

  it("rechaza más de 200 caracteres y caracteres de control, como la base", () => {
    expect(noteProblem("a".repeat(200))).toBeNull();
    expect(noteProblem("a".repeat(201))).toBe("too_long");
    expect(noteProblem("uno\ndos")).toBe("control");
    expect(noteProblem("tab\tulado")).toBe("control");
    expect(noteProblem("  espacios en los bordes  ")).toBeNull();
    expect(noteProblem("ñandú con tilde")).toBeNull();
  });
});

describe("entrada de la acción", () => {
  const valid = { tableId: U(1), productId: U(2), quantity: 2, optionIds: [U(11), U(21)], note: "  sin sal ", clientKey: U(9) };

  it("acepta una entrada válida y normaliza la nota", () => {
    expect(parseAddItemInput(valid)).toEqual({ ...valid, note: "sin sal" });
    expect(parseAddItemInput({ ...valid, note: null, optionIds: [] })).toMatchObject({ note: null, optionIds: [] });
    expect(parseAddItemInput({ ...valid, note: "   " })).toMatchObject({ note: null });
  });

  it("descarta lo que no tiene forma de pedido", () => {
    for (const bad of [null, "x", 3, [], {}, { ...valid, tableId: "no" }, { ...valid, productId: 7 }, { ...valid, clientKey: undefined }]) {
      expect(parseAddItemInput(bad)).toBe("invalid");
    }
  });

  it("rechaza cantidades fuera de 1 a 99 o no enteras", () => {
    for (const quantity of [0, -1, 100, 1.5, Number.NaN, "2", null]) expect(parseAddItemInput({ ...valid, quantity })).toBe("invalid");
    expect(parseAddItemInput({ ...valid, quantity: 99 })).not.toBe("invalid");
    expect(parseAddItemInput({ ...valid, quantity: 1 })).not.toBe("invalid");
  });

  it("rechaza opciones repetidas, no uuid, que no sean lista o más de 50", () => {
    expect(parseAddItemInput({ ...valid, optionIds: [U(11), U(11)] })).toBe("invalid");
    expect(parseAddItemInput({ ...valid, optionIds: [U(11), "x"] })).toBe("invalid");
    expect(parseAddItemInput({ ...valid, optionIds: "x" })).toBe("invalid");
    expect(parseAddItemInput({ ...valid, optionIds: Array.from({ length: 51 }, (_, i) => U(100 + i)) })).toBe("invalid");
    expect(parseAddItemInput({ ...valid, optionIds: Array.from({ length: 50 }, (_, i) => U(100 + i)) })).not.toBe("invalid");
  });

  it("rechaza una nota que la base no aceptaría", () => {
    expect(parseAddItemInput({ ...valid, note: "a".repeat(201) })).toBe("invalid");
    expect(parseAddItemInput({ ...valid, note: "a\nb" })).toBe("invalid");
    expect(parseAddItemInput({ ...valid, note: 5 })).toBe("invalid");
  });
});

describe("errores de la base", () => {
  it("cada excepción conocida tiene su motivo y lo desconocido nunca se toma por éxito", () => {
    expect(failureFromDb("orders_not_allowed")).toBe("not_allowed");
    expect(failureFromDb("branch_not_found")).toBe("table_gone");
    expect(failureFromDb("table_not_found")).toBe("table_gone");
    expect(failureFromDb("product_unavailable")).toBe("product_unavailable");
    expect(failureFromDb("options_required")).toBe("options_required");
    expect(failureFromDb("options_exceeded")).toBe("options_exceeded");
    expect(failureFromDb("invalid_options")).toBe("options_changed");
    expect(failureFromDb("invalid_note")).toBe("note");
    expect(failureFromDb("invalid_quantity")).toBe("quantity");
    expect(failureFromDb("client_key_reused")).toBe("key_reused");
    expect(failureFromDb("order_full")).toBe("order_full");
    expect(failureFromDb("order_conflict")).toBe("busy");
    expect(failureFromDb("TypeError: fetch failed")).toBe("unexpected");
    expect(failureFromDb(undefined)).toBe("unexpected");
  });

  it("los fallos que vienen de una carta que cambió piden recargar", () => {
    expect(isStaleFailure("product_unavailable")).toBe(true);
    expect(isStaleFailure("options_changed")).toBe(true);
    expect(isStaleFailure("not_allowed")).toBe(false);
    expect(isStaleFailure("unexpected")).toBe(false);
  });
});

describe("búsqueda", () => {
  const sections: AnotarSection[] = [
    {
      categoryId: "c1",
      name: "Carnes",
      products: [
        { id: "p1", name: "Bife de chorizo", description: null, priceCents: 1, listCents: null, promotionName: null, groups: [], block: null },
        { id: "p2", name: "Milanesa napolitana", description: null, priceCents: 1, listCents: null, promotionName: null, groups: [], block: null },
      ],
    },
    {
      categoryId: "c2",
      name: "Postres",
      products: [{ id: "p3", name: "Ñoquis de ricota", description: null, priceCents: 1, listCents: null, promotionName: null, groups: [], block: null }],
    },
  ];

  it("ignora tildes y mayúsculas", () => {
    expect(fold("Ñoquis ÁÉÍ")).toBe("noquis aei");
    expect(filterSections(sections, "NOQUIS").map((s) => s.name)).toEqual(["Postres"]);
    expect(filterSections(sections, "milanesa")[0].products.map((p) => p.id)).toEqual(["p2"]);
  });

  it("buscar por categoría muestra todos sus platos; sin texto, la carta entera; sin coincidencias, nada", () => {
    expect(filterSections(sections, "carnes")[0].products).toHaveLength(2);
    expect(filterSections(sections, "  ")).toHaveLength(2);
    expect(filterSections(sections, "pizza")).toEqual([]);
  });
});

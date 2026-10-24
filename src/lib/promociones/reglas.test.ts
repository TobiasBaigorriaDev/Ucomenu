import { describe, expect, it } from "vitest";
import { promocionesBlockNotice, promocionesErrorMessage, promocionesWriteBlock, type PromocionesError } from "./mensajes";
import {
  PROMOTION_NAME_MAX,
  datesLabel,
  daysLabel,
  daysOf,
  discountLabel,
  findOverlaps,
  formatClock,
  maskOf,
  parseClock,
  parseDate,
  parsePromotionForm,
  promotionsOverlap,
  windowLabel,
  windowsOverlap,
  type OverlapSubject,
  type PromotionFormFields,
  type PromotionProblem,
} from "./reglas";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const B1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const form = (over: Partial<PromotionFormFields> = {}): PromotionFormFields => ({
  name: "Happy hour",
  type: "percent",
  value: "25",
  days: ["1", "2", "3", "4", "5"],
  allDay: null,
  from: "18:00",
  to: "20:00",
  startsOn: "",
  endsOn: "",
  allBranches: "true",
  branches: [],
  products: [P1],
  categories: [],
  active: "true",
  ...over,
});

const problemOf = (over: Partial<PromotionFormFields>): PromotionProblem | "ok" => {
  const r = parsePromotionForm(form(over));
  return r.ok ? "ok" : r.problem;
};

describe("parsePromotionForm", () => {
  it("un formulario completo da la promoción lista para guardar", () => {
    const r = parsePromotionForm(form({ name: "  Happy hour  ", startsOn: "2026-12-18", endsOn: "2026-12-24" }));
    expect(r).toEqual({
      ok: true,
      value: {
        name: "Happy hour",
        discountType: "percent",
        discountValue: 25,
        weekdaysMask: 31,
        startMinute: 1080,
        endMinute: 1200,
        startsOn: "2026-12-18",
        endsOn: "2026-12-24",
        allBranches: true,
        branchIds: [],
        productIds: [P1],
        categoryIds: [],
        isActive: true,
      },
    });
  });

  it("el nombre: obligatorio y de hasta 80 caracteres", () => {
    expect(problemOf({ name: "   " })).toBe("name_blank");
    expect(problemOf({ name: undefined })).toBe("name_blank");
    expect(problemOf({ name: "x".repeat(PROMOTION_NAME_MAX + 1) })).toBe("name_too_long");
    expect(problemOf({ name: "x".repeat(PROMOTION_NAME_MAX) })).toBe("ok");
  });

  it("el tipo y el valor: porcentaje entero de 1 a 100; importes en pesos con el formato de la carta", () => {
    expect(problemOf({ type: "rebaja" })).toBe("type_invalid");
    expect(problemOf({ value: "" })).toBe("value_blank");
    for (const bad of ["0", "101", "999"]) expect(problemOf({ value: bad }), bad).toBe("percent_range");
    for (const bad of ["12,5", "abc", "-5", "1.5", "1000"]) expect(problemOf({ value: bad }), bad).toBe("value_invalid");
    expect(problemOf({ value: "100" })).toBe("ok");

    const amount = parsePromotionForm(form({ type: "amount", value: "1.500,50" }));
    expect(amount.ok && amount.value.discountValue).toBe(150050);
    expect(problemOf({ type: "amount", value: "0" })).toBe("amount_zero");
    expect(problemOf({ type: "amount", value: "x" })).toBe("value_invalid");
    // El precio fijo puede ser cero (gratis).
    const free = parsePromotionForm(form({ type: "fixed_price", value: "0" }));
    expect(free.ok && free.value.discountValue).toBe(0);
    expect(problemOf({ type: "fixed_price", value: "2800" })).toBe("ok");
  });

  it("los días: al menos uno y solo del 1 al 7", () => {
    expect(problemOf({ days: [] })).toBe("days_empty");
    expect(problemOf({ days: ["8"] })).toBe("days_empty");
    expect(problemOf({ days: ["0"] })).toBe("days_empty");
    expect(problemOf({ days: ["x"] })).toBe("days_empty");
    const r = parsePromotionForm(form({ days: ["7", "7", "6"] }));
    expect(r.ok && r.value.weekdaysMask).toBe(96);
  });

  it("el horario: una franja que cruza la medianoche vale; inicio igual al fin no; «todo el día» tiene su casilla", () => {
    const night = parsePromotionForm(form({ from: "22:00", to: "02:00" }));
    expect(night.ok && [night.value.startMinute, night.value.endMinute]).toEqual([1320, 120]);
    const midnight = parsePromotionForm(form({ from: "18:00", to: "00:00" }));
    expect(midnight.ok && [midnight.value.startMinute, midnight.value.endMinute]).toEqual([1080, 1440]);
    const midnight24 = parsePromotionForm(form({ from: "18:00", to: "24:00" }));
    expect(midnight24.ok && midnight24.value.endMinute).toBe(1440);
    expect(problemOf({ from: "18:00", to: "18:00" })).toBe("window_empty");
    expect(problemOf({ from: "00:00", to: "00:00" })).toBe("window_empty");
    expect(problemOf({ from: "25:00" })).toBe("time_invalid");
    expect(problemOf({ from: "18:60" })).toBe("time_invalid");
    expect(problemOf({ from: "", to: "" })).toBe("time_invalid");
    const day = parsePromotionForm(form({ allDay: "on", from: "", to: "" }));
    expect(day.ok && [day.value.startMinute, day.value.endMinute]).toEqual([0, 1440]);
  });

  it("las fechas: reales y en orden; vacías = sin límite", () => {
    expect(problemOf({ startsOn: "2026-02-30" })).toBe("dates_invalid");
    expect(problemOf({ endsOn: "mañana" })).toBe("dates_invalid");
    expect(problemOf({ startsOn: "2026-12-24", endsOn: "2026-12-18" })).toBe("dates_order");
    expect(problemOf({ startsOn: "2026-12-18", endsOn: "2026-12-18" })).toBe("ok");
    const open = parsePromotionForm(form({ startsOn: "", endsOn: "" }));
    expect(open.ok && [open.value.startsOn, open.value.endsOn]).toEqual([null, null]);
  });

  it("platos, categorías y sucursales: al menos un objetivo, y una sucursal si no son todas; ids válidos", () => {
    expect(problemOf({ products: [], categories: [] })).toBe("targets_empty");
    expect(problemOf({ products: [], categories: [P2] })).toBe("ok");
    expect(problemOf({ products: ["no-es-un-id"] })).toBe("ids_invalid");
    expect(problemOf({ allBranches: "false", branches: [] })).toBe("branches_empty");
    const some = parsePromotionForm(form({ allBranches: "false", branches: [B1, B1] }));
    expect(some.ok && [some.value.allBranches, some.value.branchIds]).toEqual([false, [B1]]);
    // Con «todas», las sucursales tildadas se ignoran.
    const all = parsePromotionForm(form({ allBranches: "true", branches: [B1] }));
    expect(all.ok && all.value.branchIds).toEqual([]);
  });

  it("pausada si la casilla «activa» no viene", () => {
    const r = parsePromotionForm(form({ active: "false" }));
    expect(r.ok && r.value.isActive).toBe(false);
  });
});

const plain = (text: string) => text.replace(/ /g, " ");

describe("piezas", () => {
  it("horas, fechas y días", () => {
    expect(parseClock("09:05")).toBe(545);
    expect(parseClock("24:00")).toBeNull();
    expect(parseDate("2028-02-29")).toBe("2028-02-29");
    expect(parseDate("2026-02-29")).toBeNull();
    expect(formatClock(1440)).toBe("00:00");
    expect(formatClock(75)).toBe("01:15");
    expect(daysOf(maskOf([1, 3, 7]))).toEqual([1, 3, 7]);
  });

  it("las descripciones en palabras", () => {
    expect(discountLabel("percent", 25)).toBe("25 % de descuento");
    expect(plain(discountLabel("amount", 50000))).toBe("$ 500 de descuento");
    expect(plain(discountLabel("fixed_price", 280050))).toBe("Precio $ 2.800,50");
    expect(daysLabel(127)).toBe("Todos los días");
    expect(daysLabel(31)).toBe("Lunes a viernes");
    expect(daysLabel(96)).toBe("Sábados y domingos");
    expect(daysLabel(maskOf([6]))).toBe("Los sábados");
    expect(daysLabel(maskOf([1, 3, 5]))).toBe("Lunes, miércoles y viernes");
    expect(windowLabel(0, 1440)).toBe("Todo el día");
    expect(windowLabel(1080, 1200)).toBe("De 18:00 a 20:00");
    expect(windowLabel(1320, 120)).toBe("De 22:00 a 02:00 (sigue al día siguiente)");
    expect(windowLabel(1080, 1440)).toBe("De 18:00 a medianoche");
    expect(datesLabel(null, null)).toBeNull();
    expect(datesLabel("2026-12-18", "2026-12-24")).toBe("Del 18/12/2026 al 24/12/2026");
    expect(datesLabel("2026-12-18", "2026-12-18")).toBe("Solo el 18/12/2026");
    expect(datesLabel("2026-12-18", null)).toBe("Desde el 18/12/2026");
    expect(datesLabel(null, "2026-12-24")).toBe("Hasta el 24/12/2026");
  });
});

describe("superposiciones", () => {
  const subject = (over: Partial<OverlapSubject> & { id: string }): OverlapSubject => ({
    name: over.id,
    isActive: true,
    weekdaysMask: 31,
    startMinute: 1080,
    endMinute: 1200,
    startsOn: null,
    endsOn: null,
    allBranches: true,
    branchIds: new Set(),
    productIds: new Set([P1]),
    ...over,
  });

  it("franjas: se tocan solo si comparten algún momento (el fin no cuenta)", () => {
    const a = { weekdaysMask: 31, startMinute: 1080, endMinute: 1200 };
    expect(windowsOverlap(a, { weekdaysMask: 31, startMinute: 1140, endMinute: 1260 })).toBe(true);
    expect(windowsOverlap(a, { weekdaysMask: 31, startMinute: 1200, endMinute: 1260 })).toBe(false);
    expect(windowsOverlap(a, { weekdaysMask: 96, startMinute: 1080, endMinute: 1200 })).toBe(false);
  });

  it("una franja que cruza la medianoche invade el día siguiente", () => {
    const friNight = { weekdaysMask: maskOf([5]), startMinute: 1320, endMinute: 120 };
    expect(windowsOverlap(friNight, { weekdaysMask: maskOf([6]), startMinute: 60, endMinute: 180 })).toBe(true); // sáb 01:00–03:00
    expect(windowsOverlap(friNight, { weekdaysMask: maskOf([6]), startMinute: 120, endMinute: 180 })).toBe(false);
    // El domingo por la noche llega al lunes (la semana es circular).
    const sunNight = { weekdaysMask: maskOf([7]), startMinute: 1380, endMinute: 60 };
    expect(windowsOverlap(sunNight, { weekdaysMask: maskOf([1]), startMinute: 0, endMinute: 30 })).toBe(true);
  });

  it("dos promociones se superponen si comparten plato, sucursal, momento y fechas", () => {
    expect(promotionsOverlap(subject({ id: "a" }), subject({ id: "b" }))).toBe(true);
    expect(promotionsOverlap(subject({ id: "a" }), subject({ id: "b", productIds: new Set([P2]) }))).toBe(false);
    expect(promotionsOverlap(subject({ id: "a" }), subject({ id: "b", isActive: false }))).toBe(false); // una pausada no pisa a nadie
    expect(promotionsOverlap(subject({ id: "a" }), subject({ id: "a" }))).toBe(false);
    expect(promotionsOverlap(subject({ id: "a", endsOn: "2026-12-10" }), subject({ id: "b", startsOn: "2026-12-11" }))).toBe(false);
    expect(promotionsOverlap(subject({ id: "a", endsOn: "2026-12-11" }), subject({ id: "b", startsOn: "2026-12-11" }))).toBe(true);
  });

  it("sucursales: «todas» choca con cualquiera que tenga alguna; dos listas, solo si comparten una", () => {
    const all = subject({ id: "a" });
    const some = subject({ id: "b", allBranches: false, branchIds: new Set([B1]) });
    const none = subject({ id: "c", allBranches: false, branchIds: new Set() });
    const other = subject({ id: "d", allBranches: false, branchIds: new Set(["otra"]) });
    expect(promotionsOverlap(all, some)).toBe(true);
    expect(promotionsOverlap(all, none)).toBe(false);
    expect(promotionsOverlap(some, other)).toBe(false);
    expect(promotionsOverlap(some, subject({ id: "e", allBranches: false, branchIds: new Set([B1, "otra"]) }))).toBe(true);
  });

  it("findOverlaps avisa a las dos partes", () => {
    const result = findOverlaps([subject({ id: "a" }), subject({ id: "b" }), subject({ id: "c", productIds: new Set([P2]) })]);
    expect([...result.keys()].sort()).toEqual(["a", "b"]);
    expect(result.get("a")?.map((o) => o.id)).toEqual(["b"]);
  });
});

describe("mensajes", () => {
  const all: PromocionesError[] = [
    "name_blank", "name_too_long", "type_invalid", "value_blank", "value_invalid", "percent_range", "amount_zero", "days_empty", "time_invalid",
    "window_empty", "dates_invalid", "dates_order", "targets_empty", "branches_empty", "ids_invalid", "plan_missing", "values_rejected",
    "foreign_object", "blocked_read_only", "blocked_suspended", "forbidden", "not_found", "unexpected",
  ];
  it("todos los errores tienen mensaje propio", () => {
    for (const error of all) expect(promocionesErrorMessage(error).length, error).toBeGreaterThan(10);
  });

  const ent = (over: Record<string, unknown> = {}) =>
    ({ state: "active", canWrite: true, features: ["promotions"], limits: {}, usage: {}, ...over }) as Parameters<typeof promocionesWriteBlock>[0];

  it("el bloqueo: la mora manda, después el plan; sin dato de la cuenta falla cerrado", () => {
    expect(promocionesWriteBlock(ent())).toBeNull();
    expect(promocionesBlockNotice(ent())).toBeNull();
    expect(promocionesWriteBlock(ent({ state: "read_only", canWrite: false }))).toBe("blocked_read_only");
    expect(promocionesWriteBlock(ent({ state: "suspended", canWrite: false }))).toBe("blocked_suspended");
    expect(promocionesWriteBlock(ent({ features: [] }))).toBe("plan_missing");
    expect(promocionesWriteBlock(null)).toBe("unexpected");
    expect(promocionesBlockNotice(ent({ features: [] }))).toContain("no incluye");
    expect(promocionesBlockNotice(ent({ state: "read_only", canWrite: false }))).toContain("siguen aplicándose");
    expect(promocionesBlockNotice(null)).toContain("edición está desactivada");
  });
});

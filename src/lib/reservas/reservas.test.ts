import { describe, expect, it } from "vitest";
import { dayTitle, errorMessage, freeTables, GENERIC_ERROR, groupByDay, isActive, localDate, parseDate, parseNewReservation, parseReservation, parseView, RESERVATION_MINUTES, shiftDate, sortForDay, startOfDay, tablesKnown, timeLabel, todayIn, type Reservation, type ReservationTable } from "./reservas";

const reserva = (over: Partial<Reservation> = {}): Reservation => ({
  id: "r1",
  branchId: "b1",
  tableId: null,
  tableLabel: null,
  source: "manual",
  status: "requested",
  guestName: "Ana",
  guestPhone: "123456",
  guestEmail: null,
  partySize: 2,
  startsAt: "2026-11-01T22:00:00Z",
  endsAt: "2026-11-01T23:30:00Z",
  notes: null,
  ...over,
});

describe("parseReservation", () => {
  const fila = { id: "x", branch_id: "b", table_id: null, table_label: null, source: "manual", status: "confirmed", guest_name: "Ana", guest_phone: "123456", guest_email: null, party_size: 2, starts_at: "2026-11-01T22:00:00Z", ends_at: "2026-11-01T23:30:00Z", notes: null };
  it("lee una fila completa", () => {
    expect(parseReservation(fila)).toMatchObject({ id: "x", status: "confirmed", partySize: 2, tableId: null });
  });
  it("una forma inesperada o un estado desconocido es null", () => {
    expect(parseReservation(null)).toBeNull();
    expect(parseReservation({ ...fila, status: "otro" })).toBeNull();
    expect(parseReservation({ ...fila, party_size: "2" })).toBeNull();
    expect(parseReservation({ ...fila, starts_at: "mañana" })).toBeNull();
  });
});

describe("sortForDay", () => {
  it("lo que sigue vivo primero y por hora; lo terminado al final", () => {
    const orden = sortForDay([
      reserva({ id: "a", status: "cancelled", startsAt: "2026-11-01T19:00:00Z" }),
      reserva({ id: "b", status: "confirmed", startsAt: "2026-11-01T23:00:00Z" }),
      reserva({ id: "c", status: "requested", startsAt: "2026-11-01T20:00:00Z" }),
      reserva({ id: "d", status: "seated", startsAt: "2026-11-01T18:00:00Z" }),
    ]);
    expect(orden.map((r) => r.id)).toEqual(["c", "b", "d", "a"]);
  });
  it("isActive: por confirmar, falta email y confirmada", () => {
    expect(["requested", "confirmed", "pending_email"].every((s) => isActive(s as Reservation["status"]))).toBe(true);
    expect(["seated", "cancelled", "rejected", "no_show"].some((s) => isActive(s as Reservation["status"]))).toBe(false);
  });
});

describe("freeTables", () => {
  const mesas: ReservationTable[] = [
    { id: "t1", label: "Mesa 1", branchId: "b1" },
    { id: "t2", label: "Mesa 2", branchId: "b1" },
    { id: "t3", label: "Mesa 3", branchId: "b2" },
  ];
  const objetivo = reserva({ id: "obj" });

  it("no ofrece las mesas con otra reserva confirmada o sentada que se pise; ofrece las demás de la sucursal", () => {
    const otras = [reserva({ id: "o1", status: "confirmed", tableId: "t1", startsAt: "2026-11-01T22:30:00Z", endsAt: "2026-11-02T00:00:00Z" })];
    expect(freeTables(objetivo, mesas, [objetivo, ...otras]).map((t) => t.id)).toEqual(["t2"]);
  });
  it("una reserva pegada (termina justo cuando empieza esta) no ocupa la mesa", () => {
    const pegada = reserva({ id: "o1", status: "seated", tableId: "t1", startsAt: "2026-11-01T20:30:00Z", endsAt: "2026-11-01T22:00:00Z" });
    expect(freeTables(objetivo, mesas, [pegada]).map((t) => t.id)).toEqual(["t1", "t2"]);
  });
  it("las canceladas y las pendientes no ocupan mesa, y la propia reserva no se cuenta a sí misma", () => {
    const propia = reserva({ id: "obj", status: "confirmed", tableId: "t1" });
    const cancelada = reserva({ id: "o2", status: "cancelled", tableId: "t2" });
    expect(freeTables(propia, mesas, [propia, cancelada]).map((t) => t.id)).toEqual(["t1", "t2"]);
  });
});

describe("fechas y zonas", () => {
  it("parseDate acepta solo fechas reales del calendario", () => {
    expect(parseDate("2026-11-01")).toBe("2026-11-01");
    expect(parseDate("2026-02-30")).toBeNull();
    expect(parseDate("01/11/2026")).toBeNull();
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate(["2026-11-01", "x"])).toBe("2026-11-01");
  });
  it("shiftDate cruza meses y años", () => {
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("todayIn usa la zona de la sucursal", () => {
    const instante = new Date("2026-11-01T02:30:00Z"); // 23:30 del 31/10 en Buenos Aires; 03:30 del 1/11 en Madrid
    expect(todayIn("America/Argentina/Buenos_Aires", instante)).toBe("2026-10-31");
    expect(todayIn("Europe/Madrid", instante)).toBe("2026-11-01");
  });
  it("startOfDay da la medianoche local, también con cambio de hora", () => {
    expect(startOfDay("2026-11-01", "America/Argentina/Buenos_Aires").toISOString()).toBe("2026-11-01T03:00:00.000Z");
    expect(startOfDay("2026-07-15", "Europe/Madrid").toISOString()).toBe("2026-07-14T22:00:00.000Z"); // verano: UTC+2
    expect(startOfDay("2026-12-15", "Europe/Madrid").toISOString()).toBe("2026-12-14T23:00:00.000Z"); // invierno: UTC+1
    expect(startOfDay("2026-10-25", "Europe/Madrid").toISOString()).toBe("2026-10-24T22:00:00.000Z"); // el día del cambio empieza aún en verano
  });
  it("dayTitle y timeLabel", () => {
    expect(dayTitle("2026-10-31", new Date("2026-06-01T00:00:00Z"))).toBe("Sábado, 31 de octubre");
    expect(dayTitle("2027-01-02", new Date("2026-06-01T00:00:00Z"))).toContain("2027");
    expect(timeLabel("2026-11-01T22:30:00Z", "America/Argentina/Buenos_Aires")).toBe("19:30");
  });
});

describe("parseNewReservation", () => {
  const uuid = "3f2b8c1e-0a4d-4b6e-9c2a-1d5e7f8a9b0c";
  const form = (over: Record<string, string> = {}) => {
    const data = new FormData();
    for (const [key, value] of Object.entries({ branch: uuid, clientKey: uuid, name: " Ana ", phone: "123456", email: "", party: "4", date: "2026-11-05", time: "21:00", duration: "90", notes: "", table: "", ...over })) data.set(key, value);
    return data;
  };
  it("lee el formulario y recorta los textos", () => {
    expect(parseNewReservation(form())).toMatchObject({ name: "Ana", party: 4, date: "2026-11-05", time: "21:00", table: null });
    // La duración no es un dato del formulario: un valor que llegue igual no cambia nada.
    expect(parseNewReservation(form({ duration: "999" }))).not.toHaveProperty("duration");
  });
  it("una mesa elegida viaja; una malformada o una fecha rota lo invalidan", () => {
    expect(parseNewReservation(form({ table: uuid }))!.table).toBe(uuid);
    expect(parseNewReservation(form({ table: "mesa-1" }))).toBeNull();
    expect(parseNewReservation(form({ date: "2026-13-40" }))).toBeNull();
    expect(parseNewReservation(form({ time: "9" }))).toBeNull();
    expect(parseNewReservation(form({ branch: "x" }))).toBeNull();
    expect(parseNewReservation(form({ party: "dos" }))).toBeNull();
  });
});

describe("errorMessage", () => {
  it("traduce los códigos de la base y cae en un mensaje genérico con los desconocidos", () => {
    expect(errorMessage("table_busy")).toContain("otra reserva");
    expect(errorMessage("algo_raro")).toBe(GENERIC_ERROR);
    expect(errorMessage(undefined)).toBe(GENERIC_ERROR);
  });
});

describe("la vista «Próximas»", () => {
  const BA = "America/Argentina/Buenos_Aires";
  it("parseView: solo «proximas» activa la vista; cualquier otra cosa es por día", () => {
    expect(parseView("proximas")).toBe("proximas");
    expect(parseView(["proximas", "x"])).toBe("proximas");
    expect(parseView(undefined)).toBe("dia");
    expect(parseView("otra")).toBe("dia");
  });

  it("la duración es un bloque fijo de 90 minutos", () => {
    expect(RESERVATION_MINUTES).toBe(90);
  });

  it("localDate usa la zona de la sucursal: las 01:00 UTC todavía son el día anterior en Buenos Aires", () => {
    expect(localDate("2026-11-02T01:00:00Z", BA)).toBe("2026-11-01");
    expect(localDate("2026-11-02T01:00:00Z", "Europe/Madrid")).toBe("2026-11-02");
  });

  it("groupByDay agrupa por día de la sucursal, sin reordenar, y una reserva de madrugada va al día local que le toca", () => {
    const lista = [
      reserva({ id: "a", startsAt: "2026-11-01T23:00:00Z" }), // 20:00 del 1/11 en BA
      reserva({ id: "b", startsAt: "2026-11-02T02:00:00Z" }), // 23:00 del 1/11 en BA
      reserva({ id: "c", startsAt: "2026-11-02T04:00:00Z" }), // 01:00 del 2/11 en BA
      reserva({ id: "d", startsAt: "2026-11-05T22:00:00Z" }),
    ];
    const grupos = groupByDay(lista, BA);
    expect(grupos.map((g) => [g.date, g.items.map((r) => r.id)])).toEqual([
      ["2026-11-01", ["a", "b"]],
      ["2026-11-02", ["c"]],
      ["2026-11-05", ["d"]],
    ]);
    expect(groupByDay([], BA)).toEqual([]);
  });

  it("tablesKnown: con la lectura completa siempre; cortada, solo si la reserva termina antes de lo que quedó afuera", () => {
    const r = reserva({ endsAt: "2026-11-01T23:30:00Z" });
    expect(tablesKnown(r, false, null)).toBe(true);
    expect(tablesKnown(r, true, null)).toBe(false);
    expect(tablesKnown(r, true, "2026-11-01T23:00:00Z")).toBe(false); // lo que quedó afuera empieza antes de que esta termine: podría pisarse
    expect(tablesKnown(r, true, "2026-11-01T23:30:00Z")).toBe(true); // empieza justo cuando esta termina: no se pisan
    expect(tablesKnown(r, true, "2026-11-02T10:00:00Z")).toBe(true);
  });
});

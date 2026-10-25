import { describe, expect, it } from "vitest";
import { parseQrResetTimes } from "./qr-schedule";

describe("horarios diarios de reinicio de QR", () => {
  it("ordena horarios y permite desactivar", () => {
    expect(parseQrResetTimes(["17:30", "05:00", "00:00", "23:59"])).toEqual(["00:00", "05:00", "17:30", "23:59"]);
    expect(parseQrResetTimes([])).toEqual([]);
  });
  it("rechaza duplicados, segundos, formatos inválidos y más de 24", () => {
    for (const bad of [null, "05:00", ["05:00", "05:00"], ["24:00"], ["5:00"], ["05:60"], ["05:00:00"], [null], Array(25).fill("05:00")]) {
      expect(parseQrResetTimes(bad)).toBeNull();
    }
  });
});

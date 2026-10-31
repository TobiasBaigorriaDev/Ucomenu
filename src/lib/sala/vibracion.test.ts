import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCallPayload } from "@/lib/push/payload";
import { DEFAULT_VIBRATION, isVibrationLevel, MAX_PATTERN_MS, patternDuration, vibrationOrDefault, vibrationPattern, VIBRATION_LEVELS, type VibrationEvent } from "./vibracion";

const EVENTS: VibrationEvent[] = ["waiter", "bill", "ready"];
const ACTIVE = VIBRATION_LEVELS.filter((level) => level.id !== "ninguna");

describe("vibración de los avisos", () => {
  it("«ninguna» no vibra y cada nivel activo da un patrón válido: pares impares de vibración y pausa, dentro del tope", () => {
    for (const event of EVENTS) expect(vibrationPattern("ninguna", event)).toEqual([]);
    for (const level of ACTIVE) {
      for (const event of EVENTS) {
        const pattern = vibrationPattern(level.id, event);
        expect(pattern.length % 2, `${level.id}/${event}`).toBe(1); // termina vibrando, no en una pausa
        expect(pattern.every((ms) => Number.isInteger(ms) && ms >= 1 && ms <= 3000)).toBe(true);
        expect(patternDuration(pattern)).toBeLessThanOrEqual(MAX_PATTERN_MS);
      }
    }
  });

  it("la intensidad sube de verdad: cada nivel vibra más tiempo que el anterior en todos los avisos", () => {
    for (const event of EVENTS) {
      const [suave, fuerte, muyFuerte] = ACTIVE.map((level) => patternDuration(vibrationPattern(level.id, event)));
      expect(suave, event).toBeLessThan(fuerte);
      expect(fuerte, event).toBeLessThan(muyFuerte);
    }
  });

  it("la cuenta se distingue del llamado al mozo y del pedido listo en todos los niveles", () => {
    for (const level of ACTIVE) {
      const [waiter, bill, ready] = EVENTS.map((event) => JSON.stringify(vibrationPattern(level.id, event)));
      expect(new Set([waiter, bill, ready]).size, level.id).toBe(3);
    }
  });

  it("devuelve una copia: nadie puede alterar el patrón de los demás", () => {
    vibrationPattern("fuerte", "waiter")[0] = 1;
    expect(vibrationPattern("fuerte", "waiter")[0]).toBe(500);
  });

  it("solo acepta niveles del catálogo y cae al de siempre ante cualquier otra cosa", () => {
    expect(isVibrationLevel("muy_fuerte")).toBe(true);
    for (const bad of ["", "Fuerte", "extrema", null, undefined, 2]) expect(isVibrationLevel(bad)).toBe(false);
    expect(vibrationOrDefault("???")).toBe(DEFAULT_VIBRATION);
    expect(vibrationOrDefault("suave")).toBe("suave");
  });

  it("la lista de la base (CHECK de organizations.vibration) y el valor por defecto coinciden con el catálogo", () => {
    const migration = readFileSync(join(process.cwd(), "supabase/migrations/20261214100000_vibracion_de_aviso.sql"), "utf8");
    const match = migration.match(/check \(vibration in \(([^)]*)\)\)/);
    const ids = [...match![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(ids.sort()).toEqual(VIBRATION_LEVELS.map((level) => level.id).sort());
    expect(migration).toContain(`default '${DEFAULT_VIBRATION}'`);
  });

  it("el aviso push lleva el patrón del tipo de llamado, y nada si la vibración está apagada o no se indicó", () => {
    const base = { slug: "cafe", tableLabel: "Mesa 4", tableKey: "0123456789ab", branchName: "Centro", multiBranch: false };
    expect(buildCallPayload({ ...base, kind: "waiter", vibration: "muy_fuerte" }).vibrate).toEqual(vibrationPattern("muy_fuerte", "waiter"));
    expect(buildCallPayload({ ...base, kind: "bill", vibration: "fuerte" }).vibrate).toEqual(vibrationPattern("fuerte", "bill"));
    expect("vibrate" in buildCallPayload({ ...base, kind: "bill", vibration: "ninguna" })).toBe(false);
    expect("vibrate" in buildCallPayload({ ...base, kind: "bill" })).toBe(false);
  });
});

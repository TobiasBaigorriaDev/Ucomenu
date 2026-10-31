import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_TONES, isToneId, TONES, toneById, toneOrDefault } from "./tonos";

describe("catálogo de tonos de aviso", () => {
  it("los ids son únicos y los de archivo existen en public", () => {
    const ids = TONES.map((tone) => tone.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const tone of TONES) {
      if ("file" in tone) expect(existsSync(join(process.cwd(), "public", tone.file)), tone.file).toBe(true);
    }
  });

  it("cada nota sintetizada tiene valores audibles y seguros", () => {
    for (const tone of TONES) {
      if (!("notes" in tone)) continue;
      expect(tone.notes.length).toBeGreaterThan(0);
      for (const note of tone.notes) {
        expect(note.hz).toBeGreaterThan(100);
        expect(note.hz).toBeLessThan(6000);
        expect(note.length).toBeGreaterThan(0.05);
        expect(note.at).toBeGreaterThanOrEqual(0);
        expect(note.gain).toBeGreaterThan(0);
        expect(note.gain).toBeLessThanOrEqual(0.7);
      }
      expect(Math.max(...tone.notes.map((note) => note.at + note.length)), tone.id).toBeLessThan(3);
    }
  });

  it("solo acepta ids del catálogo y cae al tono de siempre ante cualquier otra cosa", () => {
    expect(isToneId("campana")).toBe(true);
    for (const bad of ["", "Campana", "/notificacion.mp3", null, undefined, 3]) expect(isToneId(bad)).toBe(false);
    expect(toneOrDefault("zzz", "call")).toBe(DEFAULT_TONES.call);
    expect(toneOrDefault(undefined, "ready")).toBe(DEFAULT_TONES.ready);
    expect(toneOrDefault("timbre", "ready")).toBe("timbre");
    expect(toneById("alerta").label).toBe("Alerta");
  });

  it("la lista de la base (CHECK de organizations) coincide con el catálogo", () => {
    const migration = readFileSync(join(process.cwd(), "supabase/migrations/20261213100000_tonos_de_aviso.sql"), "utf8");
    for (const column of ["call_tone", "ready_tone"]) {
      const match = migration.match(new RegExp(String.raw`check \(${column} in \(([^)]*)\)\)`));
      expect(match, column).not.toBeNull();
      const ids = [...match![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
      expect(ids.sort()).toEqual(TONES.map((tone) => tone.id).sort());
    }
  });
});

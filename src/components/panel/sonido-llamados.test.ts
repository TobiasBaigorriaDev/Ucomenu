import { beforeEach, describe, expect, it, vi } from "vitest";

const beeps: string[] = [];
const fake = { unlock: vi.fn(async () => true), beep: vi.fn((id: string) => { beeps.push(id); }), stop: vi.fn(), close: vi.fn() };
vi.mock("@/lib/sala/beep", () => ({ createBeeper: () => fake }));

beforeEach(() => {
  beeps.length = 0;
  fake.unlock.mockResolvedValue(true);
  vi.resetModules();
  vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem: () => {} } });
});

describe("tonos en los avisos de la pantalla", () => {
  it("sin elección suenan los MP3 de siempre: llamado para llamados y plato nuevo, plato-listo para pedidos listos", async () => {
    const sound = await import("./sonido-llamados");
    await sound.activateSound(false);
    sound.beepIfOn();
    sound.beepIfOn("ready");
    expect(beeps).toEqual(["llamado", "plato-listo"]);
  });

  it("cada aviso usa el tono que fijó el Dueño, también la confirmación al activar", async () => {
    const sound = await import("./sonido-llamados");
    sound.setAlertTones({ call: "campana", ready: "marimba" });
    await sound.activateSound();
    sound.beepIfOn();
    sound.beepIfOn("notification");
    sound.beepIfOn("ready");
    expect(beeps).toEqual(["campana", "campana", "campana", "marimba"]);
  });

  it("con el sonido apagado no suena ningún aviso", async () => {
    const sound = await import("./sonido-llamados");
    sound.setAlertTones({ call: "alerta", ready: "alerta" });
    sound.beepIfOn();
    sound.beepIfOn("ready");
    await sound.activateSound(false);
    sound.silenceSound();
    sound.beepIfOn();
    expect(beeps).toEqual([]);
  });

  it("escuchar un tono no activa los avisos ni los recuerda, y avisa si el navegador no lo deja", async () => {
    const sound = await import("./sonido-llamados");
    expect(await sound.previewTone("timbre")).toBe(true);
    expect(beeps).toEqual(["timbre"]);
    sound.beepIfOn();
    expect(beeps).toEqual(["timbre"]); // el sonido sigue apagado
    fake.unlock.mockResolvedValue(false);
    expect(await sound.previewTone("timbre")).toBe(false);
    expect(beeps).toEqual(["timbre"]);
  });

  describe("vibración", () => {
    const vibrations: number[][] = [];
    beforeEach(() => {
      vibrations.length = 0;
      vi.stubGlobal("navigator", { vibrate: vi.fn((pattern: number[]) => { vibrations.push(pattern); return true; }) });
    });

    it("con las alertas activadas cada aviso vibra con el patrón de su tipo y el nivel por defecto", async () => {
      const sound = await import("./sonido-llamados");
      await sound.activateSound(false);
      sound.beepIfOn("notification", "waiter");
      sound.beepIfOn("notification", "bill");
      sound.beepIfOn("ready");
      expect(vibrations).toEqual([[500, 200, 500, 200, 500], [1200, 300, 1200], [500, 200, 500]]);
    });

    it("usa el nivel que fijó el Dueño, y «ninguna» no vibra pero sí suena", async () => {
      const sound = await import("./sonido-llamados");
      await sound.activateSound(false);
      sound.setAlertVibration("muy_fuerte");
      sound.beepIfOn("notification", "bill");
      expect(vibrations).toEqual([[1500, 300, 1500, 300, 1500]]);
      sound.setAlertVibration("ninguna");
      sound.beepIfOn();
      expect(vibrations).toHaveLength(1);
      expect(beeps.at(-1)).toBe("llamado");
    });

    it("con las alertas apagadas o silenciadas no vibra", async () => {
      const sound = await import("./sonido-llamados");
      sound.beepIfOn();
      await sound.activateSound(false);
      sound.silenceSound();
      sound.beepIfOn("ready");
      expect(vibrations).toEqual([]);
    });

    it("sin soporte del navegador (iPhone, escritorio) no rompe y la prueba lo informa", async () => {
      vi.stubGlobal("navigator", {});
      const sound = await import("./sonido-llamados");
      await sound.activateSound(false);
      expect(() => sound.beepIfOn()).not.toThrow();
      expect(sound.previewVibration("fuerte")).toBe(false);
    });

    it("probar un nivel vibra con el patrón del llamado al mozo, sin activar las alertas", async () => {
      const sound = await import("./sonido-llamados");
      expect(sound.previewVibration("suave")).toBe(true);
      expect(vibrations).toEqual([[300, 150, 300]]);
      expect(sound.previewVibration("ninguna")).toBe(false);
      sound.beepIfOn();
      expect(vibrations).toHaveLength(1);
    });
  });
});

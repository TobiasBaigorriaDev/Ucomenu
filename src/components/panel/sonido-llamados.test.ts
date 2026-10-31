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
});

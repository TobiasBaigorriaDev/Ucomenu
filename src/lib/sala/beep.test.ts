import { afterEach, describe, expect, it, vi } from "vitest";
import { createBeeper } from "./beep";

function audioDouble() {
  const sources: { buffer: unknown; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; onended: (() => void) | null }[] = [];
  const resume = vi.fn(async () => { context.state = "running"; });
  const context = {
    state: "suspended", destination: {}, resume, close: vi.fn(async () => {}),
    decodeAudioData: vi.fn(async (bytes: ArrayBuffer) => ({ marker: new Uint8Array(bytes)[0] })),
    createBufferSource: vi.fn(() => {
      const source = { buffer: null as unknown, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null };
      sources.push(source);
      return source;
    }),
  };
  vi.stubGlobal("window", { AudioContext: class { constructor() { return context; } } });
  const fetchAudio = vi.fn(async (url: string) => ({ ok: true, arrayBuffer: async () => new Uint8Array([url.includes("plato-listo") ? 2 : 1]).buffer }));
  vi.stubGlobal("fetch", fetchAudio);
  return { context, sources, fetchAudio };
}
afterEach(() => vi.unstubAllGlobals());

/** Doble con osciladores y ganancias para los tonos sintetizados. */
function synthDouble() {
  const base = audioDouble();
  const oscillators: { type: string; frequency: { setValueAtTime: ReturnType<typeof vi.fn> }; connect: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; onended: (() => void) | null }[] = [];
  const masters: { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
  const gainNode = () => ({ gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() });
  Object.assign(base.context, {
    currentTime: 10,
    createOscillator: vi.fn(() => {
      const oscillator = { type: "", frequency: { setValueAtTime: vi.fn() }, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null };
      oscillators.push(oscillator);
      return oscillator;
    }),
    createGain: vi.fn(() => {
      const node = gainNode();
      masters.push(node);
      return node;
    }),
  });
  return { ...base, oscillators, masters };
}

describe("audios de avisos", () => {
  it("desbloquea por gesto, carga ambos MP3 una vez y elige el buffer correcto", async () => {
    const { context, sources, fetchAudio } = audioDouble();
    const player = createBeeper();
    player.beep("llamado");
    expect(sources).toHaveLength(0);
    expect(await player.unlock()).toBe(true);
    expect(context.resume).toHaveBeenCalledOnce();
    expect(fetchAudio.mock.calls.map(([url]) => url)).toEqual(["/notificacion.mp3", "/notificacion-plato-listo.mp3"]);
    player.beep("llamado");
    player.beep("plato-listo");
    expect(sources.map((s) => s.buffer)).toEqual([{ marker: 1 }, { marker: 2 }]);
    expect(sources[0].stop).toHaveBeenCalledOnce();
    expect(sources[1].start).toHaveBeenCalledOnce();
    expect(await player.unlock()).toBe(true);
    expect(fetchAudio).toHaveBeenCalledTimes(2);
    player.stop();
    expect(sources[1].stop).toHaveBeenCalledOnce();
    player.close();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("un fallo de carga no rompe la pantalla y permite reintentar", async () => {
    const { fetchAudio, sources } = audioDouble();
    fetchAudio.mockRejectedValueOnce(new Error("sin red"));
    const player = createBeeper();
    expect(await player.unlock()).toBe(false);
    player.beep("llamado");
    expect(sources).toHaveLength(0);
    expect(await player.unlock()).toBe(true);
    player.beep("plato-listo");
    expect(sources[0].buffer).toEqual({ marker: 2 });
  });

  it("sin soporte o con el contexto suspendido no reproduce", async () => {
    vi.stubGlobal("window", {});
    expect(await createBeeper().unlock()).toBe(false);
    const { context, sources } = audioDouble();
    const player = createBeeper();
    await player.unlock();
    context.state = "suspended";
    player.beep("llamado");
    expect(sources).toHaveLength(0);
  });

  it("un tono sintetizado programa sus notas desde el reloj del contexto, sin usar un MP3", async () => {
    const { oscillators, sources } = synthDouble();
    const player = createBeeper();
    await player.unlock();
    player.beep("marimba");
    expect(sources).toHaveLength(0);
    expect(oscillators.map((o) => o.frequency.setValueAtTime.mock.calls[0])).toEqual([[523, 10], [659, 10.16], [784, 10.32]]);
    expect(oscillators.map((o) => o.type)).toEqual(["triangle", "triangle", "triangle"]);
    for (const oscillator of oscillators) expect(oscillator.start).toHaveBeenCalledOnce();
  });

  it("un tono nuevo reemplaza al anterior y silenciar corta el sintetizado", async () => {
    const { oscillators, sources, masters } = synthDouble();
    const player = createBeeper();
    await player.unlock();
    player.beep("digital");
    const first = [...oscillators];
    player.beep("llamado");
    for (const oscillator of first) expect(oscillator.stop).toHaveBeenCalledTimes(2);
    expect(sources).toHaveLength(1);
    player.beep("alerta");
    expect(sources[0].stop).toHaveBeenCalledOnce();
    const alertOscillators = oscillators.slice(first.length);
    player.stop();
    for (const oscillator of alertOscillators) expect(oscillator.stop).toHaveBeenCalledTimes(2);
    expect(masters[0].disconnect).toHaveBeenCalled();
  });

  it("el tono con notas solapadas se cierra con la que termina última, no con la última de la lista", async () => {
    const { oscillators, masters } = synthDouble();
    const player = createBeeper();
    await player.unlock();
    player.beep("campana");
    // Campana: fundamental 659, armónico 659*2.76, fundamental 880 (la más larga), armónico 880*2.76.
    expect(oscillators).toHaveLength(4);
    expect(oscillators[3].onended).toBeNull();
    expect(oscillators[2].onended).toBeTypeOf("function");
    expect(masters[0].disconnect).not.toHaveBeenCalled();
    oscillators[2].onended?.();
    expect(masters[0].disconnect).toHaveBeenCalled();
  });
});

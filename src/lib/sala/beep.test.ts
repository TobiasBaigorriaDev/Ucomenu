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

describe("audios de avisos", () => {
  it("desbloquea por gesto, carga ambos MP3 una vez y elige el buffer correcto", async () => {
    const { context, sources, fetchAudio } = audioDouble();
    const player = createBeeper();
    player.beep();
    expect(sources).toHaveLength(0);
    expect(await player.unlock()).toBe(true);
    expect(context.resume).toHaveBeenCalledOnce();
    expect(fetchAudio.mock.calls.map(([url]) => url)).toEqual(["/notificacion.mp3", "/notificacion-plato-listo.mp3"]);
    player.beep();
    player.beep("ready");
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
    player.beep();
    expect(sources).toHaveLength(0);
    expect(await player.unlock()).toBe(true);
    player.beep("ready");
    expect(sources[0].buffer).toEqual({ marker: 2 });
  });

  it("sin soporte o con el contexto suspendido no reproduce", async () => {
    vi.stubGlobal("window", {});
    expect(await createBeeper().unlock()).toBe(false);
    const { context, sources } = audioDouble();
    const player = createBeeper();
    await player.unlock();
    context.state = "suspended";
    player.beep();
    expect(sources).toHaveLength(0);
  });
});

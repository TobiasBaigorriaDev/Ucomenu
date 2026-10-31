import type { BrowserContext, Page } from "@playwright/test";

/** Sustituye Web Audio y Wake Lock por dobles que cuentan: el sonido real no se puede oír en una prueba. */
export async function conDobles(context: BrowserContext) {
  await context.route("**/notificacion*.mp3", (route) => route.fulfill({
    contentType: "audio/mpeg", body: Buffer.from([route.request().url().includes("plato-listo") ? 2 : 1]),
  }));
  await context.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__audios = [];
    w.__synth = [];
    w.__wake = 0;
    class FakeContext {
      state = "running";
      currentTime = 0;
      destination = {};
      resume() {
        return Promise.resolve();
      }
      close() {
        return Promise.resolve();
      }
      async decodeAudioData(bytes: ArrayBuffer) {
        return { sound: new Uint8Array(bytes)[0] === 2 ? "ready" : "notification" };
      }
      /** Los tonos sintetizados no son un MP3: se registra la frecuencia de cada nota en `__synth`. */
      createGain() {
        return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} };
      }
      createOscillator() {
        let hz = 0;
        return {
          type: "sine",
          frequency: { setValueAtTime(value: number) { hz = value; } },
          onended: null,
          connect() {},
          start() {
            (window as unknown as { __synth: number[] }).__synth.push(hz);
          },
          stop() {},
        };
      }
      createBufferSource() {
        const source = {
          buffer: null as { sound: string } | null,
          connect() {},
          disconnect() {},
          onended: null,
          start() {
            (window as unknown as { __audios: string[] }).__audios.push(source.buffer!.sound);
          },
          stop() {},
        };
        return source;
      }
    }
    w.AudioContext = FakeContext;
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        request: async () => {
          (window as unknown as { __wake: number }).__wake += 1;
          return { release: async () => {} };
        },
      },
    });
  });
}

export const sonidos = (page: Page) => page.evaluate(() => (window as unknown as { __audios: string[] }).__audios);
/** Frecuencias (Hz) de las notas sintetizadas que sonaron, en orden. */
export const sintetizados = (page: Page) => page.evaluate(() => (window as unknown as { __synth: number[] }).__synth);
/** Cantidad de avisos, conservando el nombre usado por las pruebas de sala y panel. */
export const pitidos = async (page: Page) => (await sonidos(page)).length;
export const wakeLocks = (page: Page) => page.evaluate(() => (window as unknown as { __wake: number }).__wake);

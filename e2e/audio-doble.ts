import type { BrowserContext, Page } from "@playwright/test";

/** Sustituye Web Audio y Wake Lock por dobles que cuentan: el sonido real no se puede oír en una prueba. */
export async function conDobles(context: BrowserContext) {
  await context.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__osciladores = 0;
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
      createGain() {
        return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (n: unknown) => n };
      }
      createOscillator() {
        return {
          frequency: { value: 0 },
          type: "",
          connect: (n: unknown) => n,
          start() {
            (window as unknown as { __osciladores: number }).__osciladores += 1;
          },
          stop() {},
        };
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

/** Cada pitido son dos osciladores. */
export const pitidos = async (page: Page) => (await page.evaluate(() => (window as unknown as { __osciladores: number }).__osciladores)) / 2;
export const wakeLocks = (page: Page) => page.evaluate(() => (window as unknown as { __wake: number }).__wake);

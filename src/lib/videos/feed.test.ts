import { describe, expect, it } from "vitest";
import { TEXTOS } from "@/lib/idiomas/textos";
import { hasPublishedVideos, hlsUrl, loadPublishedVideos, neighbor, posterUrl, slidesToPrepare, videosHref } from "./feed";

type Respuesta = { data: unknown[] | null; error: { message: string } | null };

/** Un cliente de mentira que responde lo mismo a cualquier consulta encadenada y anota los pasos. */
function fakeDb(respuesta: Respuesta | Error) {
  const pasos: string[] = [];
  const q: Record<string, unknown> = {};
  for (const metodo of ["select", "eq", "order", "limit"]) {
    q[metodo] = (...args: unknown[]) => (pasos.push(`${metodo}:${args.join(",")}`), q);
  }
  q.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    (respuesta instanceof Error ? Promise.reject(respuesta) : Promise.resolve(respuesta)).then(resolve, reject);
  return { db: { from: (tabla: string) => (pasos.push(`from:${tabla}`), q) } as never, pasos };
}

describe("qué videos se preparan", () => {
  it("el visible y el siguiente; el último solo; fuera de rango, ninguno", () => {
    expect(slidesToPrepare(0, 4)).toEqual([0, 1]);
    expect(slidesToPrepare(2, 4)).toEqual([2, 3]);
    expect(slidesToPrepare(3, 4)).toEqual([3]);
    expect(slidesToPrepare(0, 1)).toEqual([0]);
    for (const [activo, total] of [[0, 0], [-1, 3], [3, 3], [1.5, 3], [Number.NaN, 3]] as const) expect(slidesToPrepare(activo, total), `${activo}/${total}`).toEqual([]);
  });

  it("las flechas no pasan de los extremos", () => {
    expect(neighbor(0, 3, -1)).toBe(0);
    expect(neighbor(0, 3, 1)).toBe(1);
    expect(neighbor(2, 3, 1)).toBe(2);
    expect(neighbor(2, 3, -1)).toBe(1);
    expect(neighbor(0, 0, 1)).toBe(0);
  });
});

describe("URLs", () => {
  it("el stream y el póster salen de Mux con el playback codificado", () => {
    expect(hlsUrl("abc123")).toBe("https://stream.mux.com/abc123.m3u8");
    expect(posterUrl("abc123")).toBe("https://image.mux.com/abc123/thumbnail.jpg?width=720&time=1");
    expect(posterUrl("abc123", 360)).toContain("width=360");
    expect(hlsUrl("a/b?c")).toBe("https://stream.mux.com/a%2Fb%3Fc.m3u8");
    expect(posterUrl("a/b?c")).toContain("/a%2Fb%3Fc/thumbnail.jpg");
  });

  it("el feed de una sucursal vive bajo su carta", () => {
    expect(videosHref("mi-local", "centro")).toBe("/m/mi-local/centro/videos");
  });
});

describe("lectura pública", () => {
  it("pide solo columnas públicas, de la organización, en el orden del feed y con tope", async () => {
    const { db, pasos } = fakeDb({ data: [], error: null });
    await loadPublishedVideos(db, "org-1");
    expect(pasos).toEqual([
      "from:menu_videos",
      "select:id, product_id, title, mux_playback_id, duration_seconds, like_count, comment_count",
      "eq:organization_id,org-1",
      "order:sort_order",
      "order:created_at",
      "order:id",
      "limit:50",
    ]);
  });

  it("devuelve los videos y descarta una fila sin playback (no puede pasar con la política, pero no se confía)", async () => {
    const { db } = fakeDb({
      data: [
        { id: "1", product_id: null, title: "uno", mux_playback_id: "pb1", duration_seconds: 5, like_count: 3, comment_count: 2 },
        { id: "2", product_id: null, title: "sin playback", mux_playback_id: null, duration_seconds: null, like_count: 0, comment_count: 0 },
      ],
      error: null,
    });
    expect((await loadPublishedVideos(db, "org")).map((v) => v.id)).toEqual(["1"]);
  });

  it("si la base falla, cargar el feed lanza (la ruta muestra su error)", async () => {
    await expect(loadPublishedVideos(fakeDb({ data: null, error: { message: "caída" } }).db, "org")).rejects.toThrow(/caída/);
  });

  it("«¿hay videos?» nunca rompe la carta: ante cualquier fallo es falso", async () => {
    expect(await hasPublishedVideos(fakeDb({ data: [{ id: "1" }], error: null }).db, "org")).toBe(true);
    expect(await hasPublishedVideos(fakeDb({ data: [], error: null }).db, "org")).toBe(false);
    expect(await hasPublishedVideos(fakeDb({ data: null, error: { message: "x" } }).db, "org")).toBe(false);
    expect(await hasPublishedVideos(fakeDb(new Error("red caída")).db, "org")).toBe(false);
  });
});

describe("textos del feed", () => {
  it("los tres idiomas tienen cada texto, con los números en su lugar", () => {
    for (const lang of ["es", "en", "pt"] as const) {
      const t = TEXTOS[lang].feed;
      for (const [clave, valor] of Object.entries(t)) {
        if (typeof valor === "string") expect(valor.length, `${lang}.${clave}`).toBeGreaterThan(1);
      }
      expect(t.position(2, 5)).toMatch(/2.*5/);
      expect(t.pageTitle("Mi local")).toContain("Mi local");
      expect(t.likeCount(1)).toMatch(/1/);
      expect(t.likeCount(7)).toMatch(/7/);
    }
  });
});

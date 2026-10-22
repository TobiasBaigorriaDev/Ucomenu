import { describe, expect, it } from "vitest";
import { durationProblem, validateVideoFile } from "./archivo";
import { MAX_UPLOAD_BYTES } from "./estado";

describe("validateVideoFile", () => {
  const archivo = (name: string, type: string, size = 1000) => ({ name, type, size });

  it("acepta un video por su tipo, o por su extensión cuando el teléfono no informa el tipo", () => {
    expect(validateVideoFile(archivo("a.mp4", "video/mp4"))).toBeNull();
    expect(validateVideoFile(archivo("IMG_0001.MOV", "video/quicktime"))).toBeNull();
    expect(validateVideoFile(archivo("a.webm", "video/webm"))).toBeNull();
    expect(validateVideoFile(archivo("IMG_0002.MOV", ""))).toBeNull();
    expect(validateVideoFile(archivo("clip.m4v", ""))).toBeNull();
  });

  it("rechaza lo que no es un video", () => {
    expect(validateVideoFile(archivo("notas.txt", "text/plain"))).toBe("type");
    expect(validateVideoFile(archivo("foto.jpg", "image/jpeg"))).toBe("type");
    expect(validateVideoFile(archivo("sin-extension", ""))).toBe("type");
    expect(validateVideoFile(archivo("trampa.mp4.exe", ""))).toBe("type");
    expect(validateVideoFile(archivo("video", "application/octet-stream"))).toBe("type");
  });

  it("rechaza el archivo vacío y el que pasa de 50 MB (el borde exacto entra)", () => {
    expect(validateVideoFile(archivo("a.mp4", "video/mp4", 0))).toBe("empty");
    expect(validateVideoFile(archivo("a.mp4", "video/mp4", MAX_UPLOAD_BYTES))).toBeNull();
    expect(validateVideoFile(archivo("a.mp4", "video/mp4", MAX_UPLOAD_BYTES + 1))).toBe("size");
  });
});

describe("durationProblem", () => {
  it("más de 30,5 s es demasiado largo; si el navegador no pudo leerla, decide el servidor", () => {
    expect(durationProblem(30)).toBeNull();
    expect(durationProblem(30.5)).toBeNull();
    expect(durationProblem(30.51)).toBe("too_long");
    expect(durationProblem(120)).toBe("too_long");
    expect(durationProblem(null)).toBeNull();
    expect(durationProblem(Number.NaN)).toBeNull();
    expect(durationProblem(Infinity)).toBeNull();
  });
});

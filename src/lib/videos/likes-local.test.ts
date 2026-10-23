import { describe, expect, it } from "vitest";
import { EMPTY_LIKES, newDeviceCode, parseStoredLikes, withLike } from "./likes-local";

const A = "11111111-2222-4333-8444-555555555555";
const B = "66666666-7777-4888-9999-000000000000";
const CODIGO = "0123456789abcdef0123456789abcdef";

describe("lo que se guarda en el dispositivo", () => {
  it("lee lo guardado y descarta lo que no tiene la forma esperada", () => {
    expect(parseStoredLikes(JSON.stringify({ device: CODIGO, liked: [A, B] }))).toEqual({ device: CODIGO, liked: [A, B] });
    expect(parseStoredLikes(JSON.stringify({ device: "malo", liked: [A, 5, "no-uuid", B] }))).toEqual({ device: null, liked: [A, B] });
    expect(parseStoredLikes(JSON.stringify({ device: CODIGO.toUpperCase(), liked: "no" }))).toEqual({ device: null, liked: [] });
  });

  it("nunca lanza: vacío, JSON roto o de otra forma es «nada guardado»", () => {
    for (const raro of [null, "", "{", "null", "5", "[]", '"texto"', "[1,2]"]) expect(parseStoredLikes(raro), String(raro)).toEqual(EMPTY_LIKES);
  });

  it("recuerda a lo sumo 100 videos, los últimos", () => {
    const muchos = Array.from({ length: 150 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const leidos = parseStoredLikes(JSON.stringify({ device: CODIGO, liked: muchos }));
    expect(leidos.liked).toHaveLength(100);
    expect(leidos.liked[99]).toBe(muchos[149]);
    expect(withLike(leidos, A, true).liked).toHaveLength(100);
  });

  it("marcar agrega sin repetir y desmarcar quita; el código no cambia", () => {
    const base = { device: CODIGO, liked: [A] };
    expect(withLike(base, A, true)).toEqual({ device: CODIGO, liked: [A] });
    expect(withLike(base, B, true)).toEqual({ device: CODIGO, liked: [A, B] });
    expect(withLike(base, A, false)).toEqual({ device: CODIGO, liked: [] });
    expect(withLike(base, B, false)).toEqual(base);
  });

  it("el código nuevo tiene 128 bits en 32 hex y sale de bytes aleatorios", () => {
    expect(newDeviceCode()).toMatch(/^[0-9a-f]{32}$/);
    expect(newDeviceCode()).not.toBe(newDeviceCode());
    expect(newDeviceCode((bytes) => bytes.fill(0xab))).toBe("ab".repeat(16));
    expect(newDeviceCode((bytes) => bytes.fill(0x01))).toBe("01".repeat(16));
  });
});

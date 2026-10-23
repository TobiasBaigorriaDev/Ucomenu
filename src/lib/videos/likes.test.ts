import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientKeyFromIp } from "@/lib/llamados/client-key";
import type { Database } from "@/lib/supabase/database.types";
import { DEVICE_CODE, deviceKeyFrom, isDeviceCode, parseLikeResult, rateKeyFrom, setVideoLike } from "./likes";

const cabeceras = (valores: Record<string, string>) => ({ get: (nombre: string) => valores[nombre.toLowerCase()] ?? null });
const TOKEN = "c0ffee01000000000000000000000000";
const VIDEO = "1a1a1a1a-2b2b-4c3c-8d4d-5e5e5e5e5e5e";
const CODIGO = "0123456789abcdef0123456789abcdef";
const SECRETO = "un-secreto-de-prueba-largo";
const CLAVE = /^[0-9a-f]{32}$/;

describe("claves del like", () => {
  it("el código del navegador tiene 32 hex en minúsculas; cualquier otra cosa no sirve", () => {
    expect(isDeviceCode(CODIGO)).toBe(true);
    for (const malo of ["", "corto", CODIGO.toUpperCase(), `${CODIGO}0`, "g".repeat(32), null, undefined, 5, {}]) expect(isDeviceCode(malo), String(malo)).toBe(false);
    expect(DEVICE_CODE.test(CODIGO)).toBe(true);
  });

  it("device_key es un HMAC de 32 hex: determinista, depende del código y del secreto, y no contiene el código", () => {
    const a = deviceKeyFrom(CODIGO, SECRETO);
    expect(a).toMatch(CLAVE);
    expect(deviceKeyFrom(CODIGO, SECRETO)).toBe(a);
    expect(deviceKeyFrom("f".repeat(32), SECRETO)).not.toBe(a);
    expect(deviceKeyFrom(CODIGO, "otro-secreto-de-prueba-largo")).not.toBe(a);
    expect(a).not.toBe(CODIGO);
    expect(a).not.toContain(CODIGO.slice(0, 8));
  });

  it("un código imposible no produce clave (no llega a la base)", () => {
    expect(deviceKeyFrom("no-es-un-codigo", SECRETO)).toBeNull();
    expect(deviceKeyFrom(undefined, SECRETO)).toBeNull();
  });

  it("rate_key sale de la IP del pedido, no la contiene y no se puede cruzar con el client_key del llamado", () => {
    const ip = "203.0.113.9";
    const clave = rateKeyFrom(cabeceras({ "x-forwarded-for": `${ip}, 10.0.0.1` }), SECRETO);
    expect(clave).toMatch(CLAVE);
    expect(clave).not.toContain("203");
    expect(clave).not.toBe(clientKeyFromIp(ip, SECRETO));
    expect(rateKeyFrom(cabeceras({ "x-forwarded-for": "203.0.113.10" }), SECRETO)).not.toBe(clave);
    expect(rateKeyFrom(cabeceras({ "x-real-ip": ip }), SECRETO)).toBe(clave);
  });

  it("sin una IP utilizable no hay rate_key (y por lo tanto no hay límite por conexión)", () => {
    expect(rateKeyFrom(cabeceras({}), SECRETO)).toBeNull();
    expect(rateKeyFrom(cabeceras({ "x-forwarded-for": "no-es-ip" }), SECRETO)).toBeNull();
  });

  it("device_key y rate_key de un mismo valor no coinciden (prefijos distintos)", () => {
    expect(deviceKeyFrom("203.0.113.9", SECRETO)).toBeNull(); // una IP no es un código: ni siquiera se acepta
    const hex = "ab".repeat(16);
    expect(deviceKeyFrom(hex, SECRETO)).not.toBe(rateKeyFrom(cabeceras({ "x-real-ip": "203.0.113.9" }), SECRETO));
  });
});

describe("respuesta de la función", () => {
  it("lee cada estado", () => {
    expect(parseLikeResult({ status: "ok", liked: true, count: 4 })).toEqual({ status: "ok", liked: true, count: 4 });
    expect(parseLikeResult({ status: "ok", liked: false, count: 0 })).toEqual({ status: "ok", liked: false, count: 0 });
    expect(parseLikeResult({ status: "session_closed" })).toEqual({ status: "session_closed" });
    expect(parseLikeResult({ status: "unavailable" })).toEqual({ status: "unavailable" });
    expect(parseLikeResult({ status: "not_found" })).toEqual({ status: "not_found" });
    expect(parseLikeResult({ status: "rate_limited", retry_after_seconds: 12.2 })).toEqual({ status: "rate_limited", retryAfterSeconds: 13 });
  });

  it("cualquier forma inesperada es «no disponible» (falla cerrado)", () => {
    const raros = [null, undefined, "ok", 5, [], {}, { status: "otro" }, { status: "ok" }, { status: "ok", liked: "si", count: 1 }, { status: "ok", liked: true, count: -1 }, { status: "ok", liked: true, count: 1.5 }, { status: "rate_limited" }, { status: "rate_limited", retry_after_seconds: 0 }, { status: "rate_limited", retry_after_seconds: "5" }];
    for (const raro of raros) expect(parseLikeResult(raro), JSON.stringify(raro)).toEqual({ status: "unavailable" });
  });
});

describe("setVideoLike", () => {
  const clave = "a".repeat(32);
  const dbCon = (rpc: ReturnType<typeof vi.fn>) => ({ rpc }) as unknown as SupabaseClient<Database>;

  it("llama a set_video_like con lo justo y solo manda lo que existe", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: "ok", liked: true, count: 2 }, error: null });
    const visita = new Date("2026-10-22T20:00:00.000Z");
    expect(await setVideoLike(dbCon(rpc), TOKEN, VIDEO, true, clave, "b".repeat(32), visita)).toEqual({ status: "ok", liked: true, count: 2 });
    expect(rpc).toHaveBeenCalledWith("set_video_like", { p_token: TOKEN, p_video: VIDEO, p_liked: true, p_device: clave, p_rate: "b".repeat(32), p_visit_started_at: "2026-10-22T20:00:00.000Z" });

    rpc.mockClear();
    await setVideoLike(dbCon(rpc), TOKEN, VIDEO, false, clave, null);
    expect(rpc).toHaveBeenCalledWith("set_video_like", { p_token: TOKEN, p_video: VIDEO, p_liked: false, p_device: clave });
  });

  it("un token, un video o una clave imposibles no llegan a la base", async () => {
    const rpc = vi.fn();
    expect(await setVideoLike(dbCon(rpc), "no-es-token", VIDEO, true, clave, null)).toEqual({ status: "not_found" });
    expect(await setVideoLike(dbCon(rpc), TOKEN, "no-es-uuid", true, clave, null)).toEqual({ status: "not_found" });
    expect(await setVideoLike(dbCon(rpc), TOKEN, VIDEO.toUpperCase(), true, clave, null)).toEqual({ status: "not_found" });
    expect(await setVideoLike(dbCon(rpc), TOKEN, VIDEO, true, null, null)).toEqual({ status: "not_found" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("un error de la base o de la red es «no disponible» y no se registra ninguna clave ni el token", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const conError = vi.fn().mockResolvedValue({ data: null, error: { code: "XX000", message: "caída" } });
      expect(await setVideoLike(dbCon(conError), TOKEN, VIDEO, true, clave, "b".repeat(32))).toEqual({ status: "unavailable" });
      const lanza = vi.fn().mockRejectedValue(new Error("red caída"));
      expect(await setVideoLike(dbCon(lanza), TOKEN, VIDEO, true, clave, "b".repeat(32))).toEqual({ status: "unavailable" });
      const registrado = log.mock.calls.flat().join(" ");
      expect(registrado).toContain("set_video_like");
      for (const secreto of [TOKEN, clave, "b".repeat(32), VIDEO]) expect(registrado).not.toContain(secreto);
    } finally {
      log.mockRestore();
    }
  });
});

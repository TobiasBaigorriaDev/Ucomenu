import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { CLIENT_KEY_PATTERN, clientIpFrom, clientKeyFromIp, clientKeyFrom, clientSecret } from "./client-key";
import { placeCall } from "./place-call";
import { callMessage, isCallKind, parseCallResult, UNAVAILABLE_MESSAGE, type CallResult } from "./result";

const cabeceras = (valores: Record<string, string>) => ({ get: (nombre: string) => valores[nombre.toLowerCase()] ?? null });
const TOKEN = "c0ffee01000000000000000000000000";

describe("identificador de cliente", () => {
  it("es el HMAC-SHA256 de la IP con el secreto, truncado a 32 hex (vectores fijos)", () => {
    expect(clientKeyFromIp("203.0.113.9", "0123456789abcdef-secret")).toBe("fbffa73588d3892d8ed01659221c13cd");
    expect(clientKeyFromIp("2001:db8::1", "0123456789abcdef-secret")).toBe("1f6bc1ae803764be54fab87faac73f60");
  });

  it("tiene el formato que exige la base, es determinista y depende de la IP y del secreto", () => {
    const a = clientKeyFromIp("198.51.100.7", "secreto-de-prueba-123");
    expect(a).toMatch(CLIENT_KEY_PATTERN);
    expect(clientKeyFromIp("198.51.100.7", "secreto-de-prueba-123")).toBe(a);
    expect(clientKeyFromIp("198.51.100.8", "secreto-de-prueba-123")).not.toBe(a);
    expect(clientKeyFromIp("198.51.100.7", "otro-secreto-de-prueba")).not.toBe(a);
  });

  it("no contiene la IP ni sus partes", () => {
    const ip = "203.0.113.9";
    const key = clientKeyFromIp(ip, "secreto-de-prueba-123");
    expect(key).not.toContain(ip);
    expect(key).not.toContain("203");
    expect(key).not.toMatch(/\./);
  });

  it("sin secreto configurado usa uno efímero estable dentro del proceso; uno corto se ignora", () => {
    const efimero = clientSecret({});
    expect(efimero.length).toBeGreaterThanOrEqual(32);
    expect(clientSecret({})).toBe(efimero);
    expect(clientSecret({ WAITER_CALL_CLIENT_SECRET: "corto" })).toBe(efimero);
    expect(clientSecret({ WAITER_CALL_CLIENT_SECRET: "   " })).toBe(efimero);
    expect(clientSecret({ WAITER_CALL_CLIENT_SECRET: "un-secreto-configurado-largo" })).toBe("un-secreto-configurado-largo");
  });
});

describe("IP del pedido", () => {
  it("toma la primera de x-forwarded-for y cae en x-real-ip", () => {
    expect(clientIpFrom(cabeceras({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientIpFrom(cabeceras({ "x-forwarded-for": "  2001:db8::1 " }))).toBe("2001:db8::1");
    expect(clientIpFrom(cabeceras({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIpFrom(cabeceras({ "x-forwarded-for": "203.0.113.9", "x-real-ip": "198.51.100.4" }))).toBe("203.0.113.9");
  });

  it("solo acepta IP válidas: cualquier otra cosa es null (sin límite por cliente)", () => {
    for (const malo of ["", "unknown", "999.1.1.1", "203.0.113", "' or 1=1 --", "<script>", "203.0.113.9:8080", "evil.test", "1.2.3.4/32"]) {
      expect(clientIpFrom(cabeceras({ "x-forwarded-for": malo })), malo).toBeNull();
    }
    expect(clientIpFrom(cabeceras({}))).toBeNull();
    expect(clientKeyFrom(cabeceras({}))).toBeNull();
  });

  it("clientKeyFrom arma el identificador solo con una IP válida", () => {
    const key = clientKeyFrom(cabeceras({ "x-forwarded-for": "203.0.113.9" }), "0123456789abcdef-secret");
    expect(key).toBe("fbffa73588d3892d8ed01659221c13cd");
  });
});

describe("resultado de la función", () => {
  it("lee cada estado conocido", () => {
    expect(parseCallResult({ status: "created" })).toEqual({ status: "created" });
    expect(parseCallResult({ status: "already_pending" })).toEqual({ status: "already_pending" });
    expect(parseCallResult({ status: "unavailable" })).toEqual({ status: "unavailable" });
    expect(parseCallResult({ status: "not_found" })).toEqual({ status: "not_found" });
    expect(parseCallResult({ status: "cooldown", retry_after_seconds: 12 })).toEqual({ status: "cooldown", retryAfterSeconds: 12 });
    expect(parseCallResult({ status: "rate_limited", retry_after_seconds: 30.2 })).toEqual({ status: "rate_limited", retryAfterSeconds: 31 });
  });

  it("cualquier forma inesperada es «no disponible» (falla cerrado)", () => {
    for (const raro of [null, undefined, "created", 5, [], [{ status: "created" }], {}, { status: "otro" }, { status: "Created" }]) {
      expect(parseCallResult(raro), String(raro)).toEqual({ status: "unavailable" });
    }
    for (const retry of [undefined, 0, -3, "5", Number.NaN, Number.POSITIVE_INFINITY, null]) {
      expect(parseCallResult({ status: "cooldown", retry_after_seconds: retry }), String(retry)).toEqual({ status: "unavailable" });
    }
  });

  it("reconoce los dos tipos de llamado", () => {
    expect(isCallKind("waiter")).toBe(true);
    expect(isCallKind("bill")).toBe(true);
    for (const malo of ["Waiter", "cuenta", "", null, undefined, 1, ["waiter"]]) expect(isCallKind(malo), String(malo)).toBe(false);
  });
});

describe("mensajes al comensal", () => {
  it("cada resultado tiene su mensaje y tono; no disponible y no encontrado dicen lo mismo", () => {
    expect(callMessage("waiter", { status: "created" })).toMatchObject({ tone: "ok", text: expect.stringContaining("Avisamos al personal") });
    expect(callMessage("bill", { status: "created" })).toMatchObject({ tone: "ok", text: expect.stringContaining("Pedimos tu cuenta") });
    expect(callMessage("waiter", { status: "already_pending" })).toMatchObject({ tone: "info", text: expect.stringContaining("Ya avisamos") });
    expect(callMessage("bill", { status: "already_pending" })).toMatchObject({ tone: "info", text: expect.stringContaining("Ya pedimos tu cuenta") });
    expect(callMessage("waiter", { status: "cooldown", retryAfterSeconds: 1 }).text).toContain("en 1 segundo.");
    expect(callMessage("waiter", { status: "cooldown", retryAfterSeconds: 42 }).text).toContain("en 42 segundos.");
    expect(callMessage("waiter", { status: "rate_limited", retryAfterSeconds: 90 }).text).toContain("en 2 minutos.");
    expect(callMessage("waiter", { status: "rate_limited", retryAfterSeconds: 5 }).text).toContain("en 1 minuto.");

    const nada: CallResult[] = [{ status: "unavailable" }, { status: "not_found" }];
    const textos = nada.flatMap((r) => (["waiter", "bill"] as const).map((k) => callMessage(k, r)));
    for (const m of textos) {
      expect(m).toEqual({ tone: "error", text: UNAVAILABLE_MESSAGE });
    }
  });

  it("el mensaje de «no disponible» no revela plan, mora, silencio ni mesa inactiva", () => {
    expect(UNAVAILABLE_MESSAGE).not.toMatch(/plan|pago|mora|silenci|inactiv|suscrip|b[aá]sico|pro\b/i);
  });
});

describe("placeCall", () => {
  const dbCon = (rpc: ReturnType<typeof vi.fn>) => ({ rpc }) as unknown as SupabaseClient<Database>;
  afterEach(() => vi.restoreAllMocks());

  it("un token o un tipo imposibles no llegan a la base", async () => {
    const rpc = vi.fn();
    for (const [token, kind] of [["abc", "waiter"], [TOKEN.toUpperCase(), "waiter"], [TOKEN, "cuenta"], [null, "bill"], [TOKEN, null], ["' or 1=1", "waiter"]] as const) {
      expect(await placeCall(dbCon(rpc), token, kind, null)).toEqual({ status: "not_found" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("manda el identificador de cliente solo si lo hay y lee la respuesta", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: "created" }, error: null });
    expect(await placeCall(dbCon(rpc), TOKEN, "waiter", "a".repeat(32))).toEqual({ status: "created" });
    expect(rpc).toHaveBeenLastCalledWith("create_waiter_call", { p_token: TOKEN, p_kind: "waiter", p_client: "a".repeat(32) });

    await placeCall(dbCon(rpc), TOKEN, "bill", null);
    expect(rpc).toHaveBeenLastCalledWith("create_waiter_call", { p_token: TOKEN, p_kind: "bill" });
  });

  it("manda cuándo abrió la carta (informativo) solo si se conoce", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: "created" }, error: null });
    await placeCall(dbCon(rpc), TOKEN, "waiter", null, new Date("2026-10-14T12:00:00.000Z"));
    expect(rpc).toHaveBeenLastCalledWith("create_waiter_call", { p_token: TOKEN, p_kind: "waiter", p_visit_started_at: "2026-10-14T12:00:00.000Z" });
    await placeCall(dbCon(rpc), TOKEN, "waiter", null, null);
    expect(rpc).toHaveBeenLastCalledWith("create_waiter_call", { p_token: TOKEN, p_kind: "waiter" });
  });

  it("un error de la base o una excepción es «no disponible» y el registro no lleva token ni identificador", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const clave = "f".repeat(32);

    const conError = vi.fn().mockResolvedValue({ data: null, error: { code: "57P01", message: "terminating connection" } });
    expect(await placeCall(dbCon(conError), TOKEN, "waiter", clave)).toEqual({ status: "unavailable" });

    const lanza = vi.fn().mockRejectedValue(new Error("fetch failed"));
    expect(await placeCall(dbCon(lanza), TOKEN, "waiter", clave)).toEqual({ status: "unavailable" });

    expect(log).toHaveBeenCalledTimes(2);
    const registrado = log.mock.calls.flat().join(" ");
    expect(registrado).not.toContain(TOKEN);
    expect(registrado).not.toContain(clave);
  });

  it("una respuesta con forma inesperada es «no disponible»", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "ok", error: null });
    expect(await placeCall(dbCon(rpc), TOKEN, "waiter", null)).toEqual({ status: "unavailable" });
  });
});

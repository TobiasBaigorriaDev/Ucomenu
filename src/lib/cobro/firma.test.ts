import { describe, expect, it } from "vitest";
import { SIGNATURE_TOLERANCE_MS, signatureManifest, signMercadoPagoNotification, verifyMercadoPagoSignature } from "./firma";

const SECRET = "secreto-de-prueba-del-webhook";
const NOW = 1_800_000_000_000;

const sign = (dataId: string | null = "123456", requestId: string | null = "req-1", ts = NOW) => signMercadoPagoNotification({ dataId, requestId, ts }, SECRET);
const check = (header: string | null, extra: Partial<Parameters<typeof verifyMercadoPagoSignature>[0]> = {}) =>
  verifyMercadoPagoSignature({ header, requestId: "req-1", dataId: "123456", secret: SECRET, nowMs: NOW, ...extra });

describe("firma de los avisos de Mercado Pago", () => {
  it("el texto firmado sigue el formato de Mercado Pago, con el data.id en minúsculas y sin los datos que faltan", () => {
    expect(signatureManifest({ dataId: "ABC123", requestId: "r", ts: "9" })).toBe("id:abc123;request-id:r;ts:9;");
    expect(signatureManifest({ dataId: null, requestId: "r", ts: "9" })).toBe("request-id:r;ts:9;");
    expect(signatureManifest({ dataId: "1", requestId: null, ts: "9" })).toBe("id:1;ts:9;");
  });

  it("acepta una firma válida (incluidos los datos que faltan) y rechaza todo lo demás", () => {
    expect(check(sign())).toEqual({ ok: true });
    expect(check(sign(null, "req-1"), { dataId: null })).toEqual({ ok: true });
    expect(check(sign("123456", null), { requestId: null })).toEqual({ ok: true });

    expect(check(null)).toEqual({ ok: false, reason: "missing" });
    expect(check("   ")).toEqual({ ok: false, reason: "missing" });
    expect(check("basura")).toEqual({ ok: false, reason: "malformed" });
    expect(check(`ts=${NOW}`)).toEqual({ ok: false, reason: "malformed" });
    expect(check(`ts=${NOW},v1=zz`)).toEqual({ ok: false, reason: "malformed" });
  });

  it("rechaza un aviso que cambió el pago, el pedido, el momento o el secreto (comparación exacta)", () => {
    const header = sign();
    expect(check(header, { dataId: "999999" })).toEqual({ ok: false, reason: "mismatch" });
    expect(check(header, { requestId: "otro" })).toEqual({ ok: false, reason: "mismatch" });
    expect(check(header, { secret: "otro-secreto" })).toEqual({ ok: false, reason: "mismatch" });
    expect(check(header.replace(`ts=${NOW}`, `ts=${NOW + 1}`))).toEqual({ ok: false, reason: "mismatch" });
    const digest = header.split("v1=")[1];
    expect(check(`ts=${NOW},v1=${digest.replace(/.$/, digest.endsWith("0") ? "1" : "0")}`)).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rechaza lo muy viejo o del futuro lejano, pero acepta un reintento atrasado dentro de la ventana", () => {
    expect(check(sign("123456", "req-1", NOW - 60 * 60 * 1000))).toEqual({ ok: true });
    expect(check(sign("123456", "req-1", NOW - SIGNATURE_TOLERANCE_MS - 1))).toEqual({ ok: false, reason: "stale" });
    expect(check(sign("123456", "req-1", NOW + SIGNATURE_TOLERANCE_MS + 1))).toEqual({ ok: false, reason: "stale" });
  });
});

import { describe, expect, it, vi } from "vitest";
import { turnstileState, verifyTurnstile } from "@/lib/auth/turnstile";
import { canChoosePlan, optionProblem, parseQuote, type PaymentQuote } from "@/lib/cobro/cotizacion";
import { slugFromName, isValidSlug } from "@/lib/slug";
import { authMethods, cameFromEmailLink, hasEmailIdentity, mustChoosePassword, parseLinkType, parseTokenHash, selfRegisterErrorFrom } from "./registro";

describe("métodos de la sesión", () => {
  it("lee las dos formas de `amr` e ignora lo demás", () => {
    expect(authMethods([{ method: "otp", timestamp: 1 }, "password", 3, null])).toEqual(["otp", "password"]);
    expect(authMethods(undefined)).toEqual([]);
  });

  it("pide contraseña salvo con una sesión de contraseña o de Google", () => {
    expect(mustChoosePassword(["otp"])).toBe(true);
    expect(mustChoosePassword(["recovery"])).toBe(true);
    expect(mustChoosePassword([])).toBe(true);
    expect(mustChoosePassword(["desconocido"])).toBe(true);
    expect(mustChoosePassword(["password"])).toBe(false);
    expect(mustChoosePassword(["oauth"])).toBe(false);
  });

  it("solo un enlace por correo deja elegir contraseña sin la actual", () => {
    expect(cameFromEmailLink(["otp"])).toBe(true);
    expect(cameFromEmailLink(["recovery"])).toBe(true);
    expect(cameFromEmailLink(["password"])).toBe(false);
    expect(cameFromEmailLink(["oauth"])).toBe(false);
    expect(cameFromEmailLink([])).toBe(false);
  });

  it("una cuenta solo de Google no tiene contraseña", () => {
    expect(hasEmailIdentity([{ provider: "google" }])).toBe(false);
    expect(hasEmailIdentity([{ provider: "google" }, { provider: "email" }])).toBe(true);
    expect(hasEmailIdentity(undefined)).toBe(true);
  });
});

describe("enlaces por correo", () => {
  it("acepta solo los tipos de las plantillas", () => {
    expect(parseLinkType("email")).toBe("email");
    expect(parseLinkType("recovery")).toBe("recovery");
    for (const otro of ["signup", "invite", "email_change", "", null, ["email"]]) expect(parseLinkType(otro)).toBeNull();
  });

  it("rechaza tokens con otra forma", () => {
    expect(parseTokenHash("a".repeat(56))).toBe("a".repeat(56));
    expect(parseTokenHash("pkce_0123456789abcdef0123")).toBe("pkce_0123456789abcdef0123");
    for (const otro of ["corto", "a".repeat(129), "con espacios y mas de veinte", "../../etc/passwd/aaaaaaaaaaa", null]) expect(parseTokenHash(otro)).toBeNull();
  });
});

describe("errores del alta", () => {
  it("traduce las excepciones de la base", () => {
    expect(selfRegisterErrorFrom({ code: "55000", message: "trial_already_used" })).toBe("trial_already_used");
    expect(selfRegisterErrorFrom({ code: "42501", message: "email_not_confirmed" })).toBe("email_not_confirmed");
    expect(selfRegisterErrorFrom({ code: "23505", message: "duplicate key" })).toBe("slug_taken");
    expect(selfRegisterErrorFrom({ code: "23514", message: "check" })).toBe("invalid_slug");
    expect(selfRegisterErrorFrom({ message: "fetch failed" })).toBe("unexpected");
  });
});

describe("dirección a partir del nombre", () => {
  it.each([
    ["Café del Centro", "cafe-del-centro"],
    ["  La Ñata & Cía.  ", "la-nata-cia"],
    ["123", "123"],
    ["¡¡¡", ""],
  ])("%s → %s", (nombre, esperado) => {
    expect(slugFromName(nombre)).toBe(esperado);
    if (esperado) expect(isValidSlug(esperado)).toBe(true);
  });

  it("no termina en guion al cortar", () => {
    const slug = slugFromName(`${"a".repeat(63)} b`);
    expect(slug).toBe("a".repeat(63));
    expect(isValidSlug(slug)).toBe(true);
  });
});

describe("Turnstile", () => {
  it("sin claves está apagado y con una sola falla cerrado", () => {
    expect(turnstileState({})).toEqual({ status: "off" });
    expect(turnstileState({ TURNSTILE_SITE_KEY: "a" })).toEqual({ status: "misconfigured" });
    expect(turnstileState({ TURNSTILE_SECRET_KEY: "b" })).toEqual({ status: "misconfigured" });
    expect(turnstileState({ TURNSTILE_SITE_KEY: "a", TURNSTILE_SECRET_KEY: "b" })).toEqual({ status: "on", siteKey: "a", secret: "b" });
  });

  const responde = (cuerpo: unknown, ok = true) => vi.fn(async () => new Response(JSON.stringify(cuerpo), { status: ok ? 200 : 500 })) as unknown as typeof fetch;

  it("acepta solo un `success: true` explícito", async () => {
    expect(await verifyTurnstile("t", "s", "1.1.1.1", responde({ success: true }))).toBe(true);
    expect(await verifyTurnstile("t", "s", null, responde({ success: false }))).toBe(false);
    expect(await verifyTurnstile("t", "s", null, responde({ success: "true" }))).toBe(false);
    expect(await verifyTurnstile("t", "s", null, responde({ success: true }, false))).toBe(false);
    expect(await verifyTurnstile("t", "s", null, (async () => { throw new Error("caído"); }) as typeof fetch)).toBe(false);
  });

  it("sin token no consulta a Cloudflare", async () => {
    const fetcher = responde({ success: true });
    expect(await verifyTurnstile(null, "s", null, fetcher)).toBe(false);
    expect(await verifyTurnstile("", "s", null, fetcher)).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("elegir plan", () => {
  const base = { plan_code: "pro", billing_cycle: "monthly", currency: "ARS", plan_price_cents: 2900000, amount_cents: 2900000, available: true };
  const opcion = (plan: string, cycle: string, available = true) => ({ plan_code: plan, billing_cycle: cycle, available, amount_cents: available ? 100 : null, currency: "ARS", reason: available ? null : "over_plan_limit", limit: available ? null : "branches" });
  const leer = (raw: unknown) => parseQuote(raw) as PaymentQuote;

  it("ofrece elegir con más de una opción posible", () => {
    expect(canChoosePlan(leer({ ...base, options: [opcion("pro", "monthly"), opcion("basic", "monthly")] }))).toBe(true);
  });

  it("no ofrece elegir con una sola opción igual a la suscripción, ni sin opciones", () => {
    expect(canChoosePlan(leer({ ...base, options: [opcion("pro", "monthly")] }))).toBe(false);
    expect(canChoosePlan(leer({ ...base, options: [] }))).toBe(false);
    expect(canChoosePlan(leer(base))).toBe(false);
  });

  it("explica por qué un plan no entra", () => {
    const quote = leer({ ...base, options: [opcion("basic", "monthly", false)] });
    const [option] = quote.options;
    if (option.available) throw new Error("debía estar no disponible");
    expect(optionProblem(option)).toContain("sucursales");
    expect(optionProblem({ ...option, reason: "paid_period_active" })).toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { vapidConfig, vapidPublicKey } from "./config";
import { dispatchCallPush, parseTargets, PUSH_TTL_SECONDS, type PushSend } from "./dispatch";
import { isAllowedPushEndpoint } from "./endpoint";
import { buildCallPayload } from "./payload";
import { parseSubscription } from "./subscription";

const P256DH = "B".repeat(87);
const AUTH = "a".repeat(22);
const FCM = "https://fcm.googleapis.com/fcm/send/abc:APA91bE-token_1";
const TOKEN = "c0ffee01000000000000000000000000";

describe("destinos de push permitidos (anti-SSRF)", () => {
  it.each([
    FCM,
    "https://fcm.googleapis.com/wp/xyz",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/abc",
  ])("acepta %s", (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    ["http plano", "http://fcm.googleapis.com/fcm/send/abc"],
    ["host propio", "https://ucomenu.example/fcm/send/abc"],
    ["servicio interno", "http://169.254.169.254/latest/meta-data"],
    ["localhost", "https://localhost/fcm/send/abc"],
    ["IP", "https://127.0.0.1/fcm/send/abc"],
    ["credenciales en la URL", "https://fcm.googleapis.com@evil.example/abc"],
    ["usuario y clave", "https://user:pass@fcm.googleapis.com/abc"],
    ["barra invertida", "https://fcm.googleapis.com\\@evil.example/abc"],
    ["puerto", "https://fcm.googleapis.com:8443/abc"],
    ["sufijo engañoso", "https://fcm.googleapis.com.evil.example/abc"],
    ["prefijo engañoso", "https://evilfcm.googleapis.com/abc"],
    ["sin ruta", "https://fcm.googleapis.com"],
    ["con espacio", "https://fcm.googleapis.com/ab c"],
    ["demasiado largo", `https://fcm.googleapis.com/${"a".repeat(1000)}`],
    ["no es texto", 42],
    ["vacío", ""],
  ])("rechaza %s", (_nombre, endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });
});

describe("suscripción que manda el navegador", () => {
  const valida = { endpoint: FCM, expirationTime: null, keys: { p256dh: P256DH, auth: AUTH } };

  it("acepta la forma de PushSubscription.toJSON()", () => {
    expect(parseSubscription(valida)).toEqual({ endpoint: FCM, p256dh: P256DH, auth: AUTH });
  });

  it.each([
    ["sin claves", { endpoint: FCM }],
    ["sin auth", { endpoint: FCM, keys: { p256dh: P256DH } }],
    ["p256dh corta", { endpoint: FCM, keys: { p256dh: "abc", auth: AUTH } }],
    ["auth con caracteres raros", { endpoint: FCM, keys: { p256dh: P256DH, auth: "a".repeat(21) + "!" } }],
    ["endpoint de otro host", { endpoint: "https://evil.example/x", keys: { p256dh: P256DH, auth: AUTH } }],
    ["no es objeto", "texto"],
    ["nulo", null],
    ["arreglo", []],
  ])("rechaza: %s", (_nombre, raw) => {
    expect(parseSubscription(raw)).toBeNull();
  });
});

describe("texto del aviso", () => {
  it("lleva tipo, mesa y la ruta de la sala; nunca ids", () => {
    const payload = buildCallPayload({ slug: "cafe", kind: "waiter", tableLabel: "Mesa 4", branchName: "Centro", multiBranch: false });
    expect(payload).toEqual({ title: "Llama al mozo", body: "Mesa 4", url: "/sala/cafe", tag: "llamado:cafe:waiter:Mesa 4" });
  });

  it("pide la cuenta con otro título y suma la sucursal solo si hay más de una", () => {
    const una = buildCallPayload({ slug: "cafe", kind: "bill", tableLabel: "Mesa 4", branchName: "Centro", multiBranch: false });
    const varias = buildCallPayload({ slug: "cafe", kind: "bill", tableLabel: "Mesa 4", branchName: "Centro", multiBranch: true });
    expect(una.title).toBe("Pide la cuenta");
    expect(una.body).toBe("Mesa 4");
    expect(varias.body).toBe("Mesa 4 · Centro");
  });

  it("recorta textos largos y no deja una mesa vacía", () => {
    const largo = buildCallPayload({ slug: "cafe", kind: "waiter", tableLabel: "x".repeat(300), branchName: "", multiBranch: true });
    expect(largo.body.length).toBeLessThanOrEqual(80);
    expect(buildCallPayload({ slug: "cafe", kind: "waiter", tableLabel: "  ", branchName: "", multiBranch: false }).body).toBe("Mesa");
  });
});

describe("claves VAPID", () => {
  const publica = "B".repeat(87);
  const privada = "p".repeat(43);

  it("sin las tres variables no hay envío, y la clave pública sola sirve para la pantalla", () => {
    expect(vapidConfig({})).toBeNull();
    expect(vapidConfig({ VAPID_PUBLIC_KEY: publica })).toBeNull();
    expect(vapidConfig({ VAPID_PUBLIC_KEY: publica, VAPID_PRIVATE_KEY: privada })).toBeNull(); // sin contacto
    expect(vapidPublicKey({ VAPID_PUBLIC_KEY: publica })).toBe(publica);
  });

  it("completa con contacto explícito, correo de contacto o sitio https", () => {
    const base = { VAPID_PUBLIC_KEY: publica, VAPID_PRIVATE_KEY: privada };
    expect(vapidConfig({ ...base, VAPID_SUBJECT: "mailto:a@b.com" })?.subject).toBe("mailto:a@b.com");
    expect(vapidConfig({ ...base, NEXT_PUBLIC_CONTACT_EMAIL: "hola@x.com" })?.subject).toBe("mailto:hola@x.com");
    expect(vapidConfig({ ...base, NEXT_PUBLIC_SITE_URL: "https://x.com" })?.subject).toBe("https://x.com");
    expect(vapidConfig({ ...base, NEXT_PUBLIC_SITE_URL: "http://localhost:3000" })).toBeNull();
  });

  it("rechaza claves con mal formato y un contacto explícito inválido", () => {
    expect(vapidPublicKey({ VAPID_PUBLIC_KEY: "corta" })).toBeNull();
    expect(vapidConfig({ VAPID_PUBLIC_KEY: publica, VAPID_PRIVATE_KEY: "corta", VAPID_SUBJECT: "mailto:a@b.com" })).toBeNull();
    expect(vapidConfig({ VAPID_PUBLIC_KEY: publica, VAPID_PRIVATE_KEY: privada, VAPID_SUBJECT: "ftp://x" })).toBeNull();
  });
});

describe("lectura de los destinos", () => {
  const valido = {
    slug: "cafe",
    table_label: "Mesa 4",
    branch_name: "Centro",
    multi_branch: false,
    subscriptions: [{ id: "s1", endpoint: FCM, p256dh: P256DH, auth: AUTH }],
  };

  it("lee una respuesta bien formada", () => {
    expect(parseTargets(valido)?.subscriptions).toEqual([{ id: "s1", endpoint: FCM, p256dh: P256DH, auth: AUTH }]);
  });

  it("descarta destinos fuera de la lista aunque la base los devolviera", () => {
    const sucia = { ...valido, subscriptions: [...valido.subscriptions, { id: "s2", endpoint: "http://10.0.0.5/x", p256dh: P256DH, auth: AUTH }] };
    expect(parseTargets(sucia)?.subscriptions.map((s) => s.id)).toEqual(["s1"]);
  });

  it.each([null, "x", { ...valido, slug: "../etc" }, { ...valido, multi_branch: "no" }, { ...valido, subscriptions: "x" }])(
    "una forma inesperada es «no avisar»",
    (raw) => {
      expect(parseTargets(raw)).toBeNull();
    },
  );
});

type Rpc = (name: string, args: unknown) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
const dbWith = (rpc: Rpc) => ({ rpc: vi.fn(rpc) }) as unknown as SupabaseClient<Database> & { rpc: ReturnType<typeof vi.fn> };

describe("envío del aviso", () => {
  afterEach(() => vi.restoreAllMocks());

  const destinos = (subscriptions: unknown[]) => ({
    slug: "cafe",
    table_label: "Mesa 4",
    branch_name: "Centro",
    multi_branch: false,
    subscriptions,
  });
  const sub = (id: string, host = "fcm.googleapis.com") => ({ id, endpoint: `https://${host}/fcm/send/${id}`, p256dh: P256DH, auth: AUTH });

  it("manda a cada dispositivo el texto del llamado con TTL corto y urgencia alta", async () => {
    const db = dbWith(async () => ({ data: destinos([sub("a"), sub("b")]), error: null }));
    const send = vi.fn<PushSend>(async () => ({}));

    const summary = await dispatchCallPush(db, send, TOKEN, "bill");

    expect(summary).toEqual({ sent: 2, failed: 0, dropped: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    const [subscription, payload, options] = send.mock.calls[0];
    expect(subscription).toEqual({ endpoint: "https://fcm.googleapis.com/fcm/send/a", keys: { p256dh: P256DH, auth: AUTH } });
    expect(JSON.parse(payload)).toEqual({ title: "Pide la cuenta", body: "Mesa 4", url: "/sala/cafe", tag: "llamado:cafe:bill:Mesa 4" });
    expect(options).toMatchObject({ TTL: PUSH_TTL_SECONDS, urgency: "high" });
    expect(db.rpc).toHaveBeenCalledWith("push_targets_for_call", { p_token: TOKEN, p_kind: "bill" });
  });

  it("borra las suscripciones que el servicio da por muertas (404 y 410), no las que fallan por otra causa", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = dbWith(async (name) => (name === "push_targets_for_call" ? { data: destinos([sub("a"), sub("b"), sub("c"), sub("d")]), error: null } : { data: 2, error: null }));
    const send = vi.fn<PushSend>(async (subscription) => {
      if (subscription.endpoint.endsWith("/a")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      if (subscription.endpoint.endsWith("/b")) throw Object.assign(new Error("not found"), { statusCode: 404 });
      if (subscription.endpoint.endsWith("/c")) throw Object.assign(new Error("server"), { statusCode: 500 });
      return {};
    });

    const summary = await dispatchCallPush(db, send, TOKEN, "waiter");

    expect(summary).toEqual({ sent: 1, failed: 3, dropped: 2 });
    expect(db.rpc).toHaveBeenCalledWith("drop_push_subscriptions", { p_ids: ["a", "b"] });
  });

  it("no manda a un destino fuera de la lista", async () => {
    const db = dbWith(async () => ({ data: destinos([sub("a", "evil.example")]), error: null }));
    const send = vi.fn<PushSend>(async () => ({}));
    expect(await dispatchCallPush(db, send, TOKEN, "waiter")).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it("sin destinatarios, o si la base no devuelve nada, no manda nada", async () => {
    const send = vi.fn<PushSend>(async () => ({}));
    expect(await dispatchCallPush(dbWith(async () => ({ data: destinos([]), error: null })), send, TOKEN, "waiter")).toBeNull();
    expect(await dispatchCallPush(dbWith(async () => ({ data: null, error: null })), send, TOKEN, "waiter")).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it("nunca lanza: un error de la base o del envío queda registrado y el llamado sigue", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await dispatchCallPush(dbWith(async () => ({ data: null, error: { code: "XX000", message: "caída" } })), vi.fn(), TOKEN, "waiter")).toBeNull();
    expect(await dispatchCallPush(dbWith(async () => { throw new Error("red"); }), vi.fn(), TOKEN, "waiter")).toBeNull();

    const db = dbWith(async () => ({ data: destinos([sub("a")]), error: null }));
    const rota = vi.fn<PushSend>(async () => {
      throw new Error("sin red");
    });
    expect(await dispatchCallPush(db, rota, TOKEN, "waiter")).toEqual({ sent: 0, failed: 1, dropped: 0 });
    expect(errors).toHaveBeenCalled();
  });

  it("no registra direcciones, tokens ni claves en los mensajes de error", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = dbWith(async () => ({ data: destinos([sub("a")]), error: null }));
    await dispatchCallPush(db, vi.fn<PushSend>(async () => { throw Object.assign(new Error("fcm.googleapis.com/fcm/send/a"), { statusCode: 500 }); }), TOKEN, "waiter");
    const registrado = errors.mock.calls.flat().join(" ");
    expect(registrado).not.toContain("fcm.googleapis.com");
    expect(registrado).not.toContain(TOKEN);
    expect(registrado).not.toContain(P256DH);
  });
});

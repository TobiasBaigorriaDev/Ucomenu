import { describe, expect, it } from "vitest";
import { uploadCorsOrigin } from "./cors";
import { signMuxPayload, verifyMuxSignature } from "./firma";
import { createMuxClient, MuxApiError, muxConfig, resolveApiBase, thumbnailUrl, webhookSecret, type MuxConfig } from "./mux";
import { hasPendingVideos, isUploadExpired, UPLOAD_EXPIRY_MS } from "./estado";
import { parseMuxEvent } from "./eventos";

const SECRET = "secreto-de-prueba-del-webhook";
const NOW = 1_800_000_000;
const BODY = JSON.stringify({ type: "video.asset.ready", data: { id: "as1" } });

describe("firma del webhook", () => {
  const firmar = (body = BODY, t = NOW) => signMuxPayload(body, SECRET, t);
  const verificar = (over: Partial<Parameters<typeof verifyMuxSignature>[0]> = {}) =>
    verifyMuxSignature({ body: BODY, header: firmar(), secret: SECRET, nowSeconds: NOW, ...over });

  it("acepta una firma válida y reciente", () => {
    expect(verificar()).toEqual({ ok: true });
  });

  it("el encabezado tiene el formato t=<segundos>,v1=<64 hex>", () => {
    expect(firmar()).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
  });

  it("rechaza un secreto equivocado y un cuerpo alterado, aunque el tiempo sea bueno", () => {
    expect(verificar({ secret: "otro-secreto" })).toEqual({ ok: false, reason: "mismatch" });
    expect(verificar({ body: BODY.replace("as1", "as2") })).toEqual({ ok: false, reason: "mismatch" });
    expect(verificar({ body: BODY + " " })).toEqual({ ok: false, reason: "mismatch" });
  });

  it("la firma de otro instante no sirve con este tiempo (se firma `t.cuerpo`)", () => {
    const [, v1] = firmar(BODY, NOW - 10).split(",");
    expect(verificar({ header: `t=${NOW},${v1}` })).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rechaza lo viejo y lo del futuro (tolerancia de 5 minutos, borde incluido)", () => {
    expect(verificar({ header: firmar(BODY, NOW - 300) })).toEqual({ ok: true });
    expect(verificar({ header: firmar(BODY, NOW + 300) })).toEqual({ ok: true });
    expect(verificar({ header: firmar(BODY, NOW - 301) })).toEqual({ ok: false, reason: "stale" });
    expect(verificar({ header: firmar(BODY, NOW + 301) })).toEqual({ ok: false, reason: "stale" });
  });

  it("sin encabezado o mal formado se rechaza", () => {
    for (const header of [undefined, null, "", "   "]) expect(verificar({ header }), String(header)).toEqual({ ok: false, reason: "missing" });
    for (const header of ["basura", "t=abc,v1=" + "a".repeat(64), `t=${NOW}`, `v1=${"a".repeat(64)}`, `t=${NOW},v1=zz`, `t=${NOW},v1=${"a".repeat(63)}`, `t=${NOW},v2=${"a".repeat(64)}`]) {
      expect(verificar({ header }), header).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("acepta varias firmas v1 si alguna coincide (rotación del secreto)", () => {
    const buena = firmar().split("v1=")[1];
    expect(verificar({ header: `t=${NOW},v1=${"0".repeat(64)},v1=${buena}` })).toEqual({ ok: true });
    expect(verificar({ header: `t=${NOW},v1=${"0".repeat(64)},v1=${"1".repeat(64)}` })).toEqual({ ok: false, reason: "mismatch" });
  });

  it("el secreto vacío no valida nada que se haya firmado con otro", () => {
    expect(verificar({ secret: "" })).toEqual({ ok: false, reason: "mismatch" });
  });
});

describe("parseMuxEvent", () => {
  it("lee type y data; todo lo demás es null", () => {
    expect(parseMuxEvent(BODY)).toEqual({ type: "video.asset.ready", data: { id: "as1" } });
    for (const malo of ["", "no es json", "[]", "null", '"x"', '{"type":3,"data":{}}', '{"type":"x"}', '{"type":"x","data":[]}']) {
      expect(parseMuxEvent(malo), malo).toBeNull();
    }
  });
});

describe("configuración de Mux", () => {
  it("sin las dos credenciales no hay cliente; con espacios o comillas de más, se recortan los espacios", () => {
    expect(muxConfig({})).toBeNull();
    expect(muxConfig({ MUX_TOKEN_ID: "id" })).toBeNull();
    expect(muxConfig({ MUX_TOKEN_ID: "id", MUX_TOKEN_SECRET: "  " })).toBeNull();
    expect(muxConfig({ MUX_TOKEN_ID: " id ", MUX_TOKEN_SECRET: " sec " })).toEqual({ tokenId: "id", tokenSecret: "sec", apiBase: "https://api.mux.com" });
  });

  it("MUX_API_URL solo se respeta si es de la propia máquina: las credenciales no pueden ir a otro host", () => {
    expect(resolveApiBase(undefined)).toBe("https://api.mux.com");
    expect(resolveApiBase("http://127.0.0.1:4010")).toBe("http://127.0.0.1:4010");
    expect(resolveApiBase("http://localhost:4010/x")).toBe("http://localhost:4010");
    for (const malo of ["https://evil.example.com", "http://127.0.0.1.evil.com", "http://evil.com:80@127.0.0.1", "ftp://localhost", "no es una url", "http://169.254.169.254"]) {
      expect(resolveApiBase(malo), malo).toBe(malo === "http://evil.com:80@127.0.0.1" ? "http://127.0.0.1" : "https://api.mux.com");
    }
  });

  it("el secreto del webhook falta si está vacío", () => {
    expect(webhookSecret({})).toBeNull();
    expect(webhookSecret({ MUX_WEBHOOK_SECRET: "  " })).toBeNull();
    expect(webhookSecret({ MUX_WEBHOOK_SECRET: "abc" })).toBe("abc");
  });

  it("la miniatura usa el playback público", () => {
    expect(thumbnailUrl("pb1")).toBe("https://image.mux.com/pb1/thumbnail.jpg?width=320&time=1");
    expect(thumbnailUrl("a/b c")).toContain("a%2Fb%20c");
  });
});

describe("cliente de Mux (con fetch de mentira)", () => {
  const config: MuxConfig = { tokenId: "tid", tokenSecret: "tsec", apiBase: "https://api.mux.test" };
  type Llamada = { url: string; init: RequestInit };

  function cliente(respuestas: Array<Response | Error>) {
    const llamadas: Llamada[] = [];
    const client = createMuxClient(config, async (url, init) => {
      llamadas.push({ url, init });
      const r = respuestas.shift();
      if (!r) throw new Error("sin respuesta preparada");
      if (r instanceof Error) throw r;
      return r;
    });
    return { client, llamadas };
  }
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("crear una subida: autenticación básica, cuerpo con passthrough, calidad básica y 1080p", async () => {
    const { client, llamadas } = cliente([json(201, { data: { id: "up1", url: "https://subir.example/up1" } })]);
    expect(await client.createDirectUpload({ corsOrigin: "https://sitio.test", passthrough: "vid-1" })).toEqual({ uploadId: "up1", url: "https://subir.example/up1" });
    const [{ url, init }] = llamadas;
    expect(url).toBe("https://api.mux.test/video/v1/uploads");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("tid:tsec").toString("base64")}`);
    expect(JSON.parse(String(init.body))).toEqual({
      cors_origin: "https://sitio.test",
      new_asset_settings: { playback_policies: ["public"], video_quality: "basic", max_resolution_tier: "1080p", passthrough: "vid-1" },
    });
  });

  it("crear una subida falla con un error claro ante un rechazo, una respuesta ilegible o la red caída", async () => {
    for (const r of [json(401, { error: "x" }), json(500, {}), json(201, { data: {} }), json(201, "texto"), new Error("ECONNRESET")]) {
      const { client } = cliente([r]);
      await expect(client.createDirectUpload({ corsOrigin: "https://s.test", passthrough: "v" })).rejects.toBeInstanceOf(MuxApiError);
    }
  });

  it("borrar un asset es idempotente: 204 y 404 están bien; el resto es un error", async () => {
    for (const status of [204, 200, 404]) {
      const { client, llamadas } = cliente([new Response(null, { status })]);
      await expect(client.deleteAsset("as/1")).resolves.toBeUndefined();
      expect(llamadas[0].url).toBe("https://api.mux.test/video/v1/assets/as%2F1");
      expect(llamadas[0].init.method).toBe("DELETE");
    }
    for (const status of [400, 401, 403, 429, 500]) {
      const { client } = cliente([new Response(null, { status })]);
      await expect(client.deleteAsset("as1"), String(status)).rejects.toMatchObject({ name: "MuxApiError", status });
    }
    const { client } = cliente([new Error("timeout")]);
    await expect(client.deleteAsset("as1")).rejects.toMatchObject({ status: 0 });
  });

  it("cancelar una subida: lo que ya no se puede cancelar no es un error; la autenticación o Mux caído, sí", async () => {
    for (const status of [200, 400, 404, 409, 422]) {
      const { client, llamadas } = cliente([new Response(null, { status })]);
      await expect(client.cancelUpload("up1"), String(status)).resolves.toBeUndefined();
      expect(llamadas[0].url).toBe("https://api.mux.test/video/v1/uploads/up1/cancel");
      expect(llamadas[0].init.method).toBe("PUT");
    }
    for (const status of [401, 403, 500, 503]) {
      const { client } = cliente([new Response(null, { status })]);
      await expect(client.cancelUpload("up1"), String(status)).rejects.toBeInstanceOf(MuxApiError);
    }
  });

  it("el mensaje de error no incluye las credenciales", async () => {
    const { client } = cliente([new Response(null, { status: 401 })]);
    const error = await client.deleteAsset("as1").catch((e: Error) => e);
    expect(String(error)).not.toContain("tsec");
    expect(String(error)).not.toContain("tid");
  });
});

describe("origen CORS de la subida", () => {
  const SITIO = "https://ucomenu-staging.fly.dev";

  it("usa el Origin del pedido si es del mismo sitio que el Host (con el puerto)", () => {
    expect(uploadCorsOrigin({ origin: SITIO, host: "ucomenu-staging.fly.dev", siteUrl: undefined })).toBe(SITIO);
    expect(uploadCorsOrigin({ origin: "http://localhost:3200", host: "localhost:3200", siteUrl: SITIO })).toBe("http://localhost:3200");
  });

  it("un Origin de otro sitio no se acepta: cae a NEXT_PUBLIC_SITE_URL", () => {
    expect(uploadCorsOrigin({ origin: "https://evil.example", host: "ucomenu-staging.fly.dev", siteUrl: `${SITIO}/panel` })).toBe(SITIO);
    expect(uploadCorsOrigin({ origin: "https://evil.example", host: "ucomenu-staging.fly.dev", siteUrl: undefined })).toBeNull();
    expect(uploadCorsOrigin({ origin: "http://ucomenu-staging.fly.dev:8080", host: "ucomenu-staging.fly.dev", siteUrl: undefined })).toBeNull();
  });

  it("sin Origin, o con basura, se usa el sitio configurado o nada", () => {
    expect(uploadCorsOrigin({ origin: null, host: "x.test", siteUrl: SITIO })).toBe(SITIO);
    expect(uploadCorsOrigin({ origin: "null", host: "x.test", siteUrl: undefined })).toBeNull();
    expect(uploadCorsOrigin({ origin: "javascript:alert(1)", host: "x.test", siteUrl: "ftp://x" })).toBeNull();
  });
});

describe("subidas sin completar", () => {
  const ahora = new Date("2026-10-22T12:00:00Z");
  const hace = (ms: number) => new Date(ahora.getTime() - ms).toISOString();

  it("una subida vence a la hora; la reciente, no", () => {
    expect(isUploadExpired({ mux_status: "awaiting_upload", status: "draft", created_at: hace(UPLOAD_EXPIRY_MS + 1000) }, ahora)).toBe(true);
    expect(isUploadExpired({ mux_status: "awaiting_upload", status: "draft", created_at: hace(UPLOAD_EXPIRY_MS - 1000) }, ahora)).toBe(false);
    expect(isUploadExpired({ mux_status: "processing", status: "draft", created_at: hace(UPLOAD_EXPIRY_MS * 5) }, ahora)).toBe(false);
    expect(isUploadExpired({ mux_status: "awaiting_upload", status: "deleting", created_at: hace(UPLOAD_EXPIRY_MS * 5) }, ahora)).toBe(false);
  });

  it("la pantalla se actualiza sola solo si algo está subiendo (no vencido) o procesando", () => {
    const fila = (mux_status: "awaiting_upload" | "processing" | "ready" | "errored", status: "draft" | "published" | "deleting" = "draft", ms = 1000) => ({ mux_status, status, created_at: hace(ms) });
    expect(hasPendingVideos([], ahora)).toBe(false);
    expect(hasPendingVideos([fila("ready"), fila("errored")], ahora)).toBe(false);
    expect(hasPendingVideos([fila("processing")], ahora)).toBe(true);
    expect(hasPendingVideos([fila("awaiting_upload")], ahora)).toBe(true);
    expect(hasPendingVideos([fila("awaiting_upload", "draft", UPLOAD_EXPIRY_MS * 2)], ahora)).toBe(false);
    expect(hasPendingVideos([fila("processing", "deleting")], ahora)).toBe(false);
  });
});

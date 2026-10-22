/**
 * Cliente de Mux Video (ADR 0031, ficha videos-mux-parte-b). Solo tres llamadas, con `fetch` y autenticación básica: no hay
 * dependencia nueva. Las credenciales (`MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`) viven solo en el servidor.
 */

export interface MuxClient {
  /** Crea una subida directa: la URL firmada es de un solo uso y vence en 1 hora. `passthrough` vuelve en los eventos del asset. */
  createDirectUpload(input: { corsOrigin: string; passthrough: string }): Promise<{ uploadId: string; url: string }>;
  /**
   * Cancela una subida que todavía espera el archivo. Si ya terminó o no existe no hay nada que cancelar y no es un error:
   * si el asset llega igual, el webhook lo trata como huérfano y lo borra.
   */
  cancelUpload(uploadId: string): Promise<void>;
  /**
   * Borra el asset en Mux. IDEMPOTENTE: si ya no existe (404) no es un error, porque el borrado de un video se reintenta
   * cuando una vuelta anterior falló a mitad.
   */
  deleteAsset(assetId: string): Promise<void>;
}

/** Un fallo de la API de Mux (o de la red, con `status` 0). */
export class MuxApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "MuxApiError";
  }
}

export type MuxConfig = { tokenId: string; tokenSecret: string; apiBase: string };

const DEFAULT_API_BASE = "https://api.mux.com";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Dónde está la API. Solo el valor por defecto, salvo que `MUX_API_URL` apunte a la PROPIA máquina (pruebas con un servidor de
 * mentira): así las credenciales no pueden enviarse a otro host por una variable mal puesta o manipulada.
 */
export function resolveApiBase(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) return DEFAULT_API_BASE;
  try {
    const url = new URL(value);
    if ((url.protocol === "http:" || url.protocol === "https:") && LOOPBACK_HOSTS.has(url.hostname)) return url.origin;
  } catch {
    // cae al valor por defecto
  }
  return DEFAULT_API_BASE;
}

/** La configuración de Mux del servidor, o `null` si faltan las credenciales. */
export function muxConfig(env: Record<string, string | undefined> = process.env): MuxConfig | null {
  const tokenId = env.MUX_TOKEN_ID?.trim();
  const tokenSecret = env.MUX_TOKEN_SECRET?.trim();
  if (!tokenId || !tokenSecret) return null;
  return { tokenId, tokenSecret, apiBase: resolveApiBase(env.MUX_API_URL) };
}

/** El secreto de firma del webhook, o `null` si falta (sin él no se procesa ningún aviso). */
export function webhookSecret(env: Record<string, string | undefined> = process.env): string | null {
  return env.MUX_WEBHOOK_SECRET?.trim() || null;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Un asset o una subida que ya no está / no se puede cancelar: nada que hacer. */
const NOTHING_TO_CANCEL = new Set([400, 404, 409, 422]);

export function createMuxClient(config: MuxConfig, fetchImpl: FetchLike = fetch): MuxClient {
  const authorization = `Basic ${Buffer.from(`${config.tokenId}:${config.tokenSecret}`).toString("base64")}`;

  async function call(method: string, path: string, body?: unknown): Promise<Response> {
    try {
      return await fetchImpl(`${config.apiBase}${path}`, {
        method,
        headers: { Authorization: authorization, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new MuxApiError(`Mux no respondió: ${error instanceof Error ? error.message : String(error)}`, 0);
    }
  }

  return {
    async createDirectUpload({ corsOrigin, passthrough }) {
      const response = await call("POST", "/video/v1/uploads", {
        cors_origin: corsOrigin,
        new_asset_settings: {
          playback_policies: ["public"],
          video_quality: "basic",
          max_resolution_tier: "1080p",
          passthrough,
        },
      });
      if (!response.ok) throw new MuxApiError(`Mux rechazó crear la subida (${response.status})`, response.status);
      const json: unknown = await response.json().catch(() => null);
      const data = typeof json === "object" && json !== null ? (json as { data?: { id?: unknown; url?: unknown } }).data : undefined;
      if (typeof data?.id !== "string" || typeof data.url !== "string") throw new MuxApiError("Mux devolvió una subida ilegible", response.status);
      return { uploadId: data.id, url: data.url };
    },

    async cancelUpload(uploadId) {
      const response = await call("PUT", `/video/v1/uploads/${encodeURIComponent(uploadId)}/cancel`);
      if (response.ok || NOTHING_TO_CANCEL.has(response.status)) return;
      throw new MuxApiError(`Mux rechazó cancelar la subida (${response.status})`, response.status);
    },

    async deleteAsset(assetId) {
      const response = await call("DELETE", `/video/v1/assets/${encodeURIComponent(assetId)}`);
      if (response.ok || response.status === 404) return;
      throw new MuxApiError(`Mux rechazó borrar el asset (${response.status})`, response.status);
    },
  };
}

/** El cliente de Mux del servidor, o `null` si no está configurado. */
export function getMuxClient(): MuxClient | null {
  const config = muxConfig();
  return config ? createMuxClient(config) : null;
}

/** Miniatura que Mux sirve para un playback público (la pantalla la usa en los videos listos). */
export function thumbnailUrl(playbackId: string, width = 320): string {
  return `https://image.mux.com/${encodeURIComponent(playbackId)}/thumbnail.jpg?width=${width}&time=1`;
}

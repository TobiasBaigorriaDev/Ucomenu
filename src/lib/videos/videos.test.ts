import { describe, expect, it } from "vitest";
import type { Entitlements } from "@/lib/entitlements";
import { canPublish, canUnpublish, formatDuration, MAX_TITLE_LENGTH, parseTitle, quotaText } from "./estado";
import { videoErrorFromDb, videoErrorMessage, writeBlock, type VideoError } from "./mensajes";

const ent = (over: Partial<Entitlements> = {}): Entitlements => ({ state: "active", canWrite: true, features: ["video_feed"], limits: {}, usage: {}, ...over });

describe("parseTitle", () => {
  it("recorta los bordes y acepta de 1 a 80 caracteres", () => {
    expect(parseTitle("  Mi video  ")).toEqual({ ok: true, title: "Mi video" });
    expect(parseTitle("x".repeat(MAX_TITLE_LENGTH))).toMatchObject({ ok: true });
    expect(parseTitle("ñ".repeat(MAX_TITLE_LENGTH))).toMatchObject({ ok: true });
  });

  it("rechaza vacío, solo espacios, lo que no es texto y lo demasiado largo", () => {
    for (const raw of ["", "   ", "\n\t", undefined, null, 3, {}]) expect(parseTitle(raw), String(raw)).toEqual({ ok: false, problem: "blank" });
    expect(parseTitle("x".repeat(MAX_TITLE_LENGTH + 1))).toEqual({ ok: false, problem: "too_long" });
  });
});

describe("qué se puede hacer con un video", () => {
  it("solo un borrador procesado se publica; solo uno publicado se despublica", () => {
    expect(canPublish({ status: "draft", mux_status: "ready" })).toBe(true);
    for (const mux_status of ["awaiting_upload", "processing", "errored"] as const) expect(canPublish({ status: "draft", mux_status })).toBe(false);
    expect(canPublish({ status: "published", mux_status: "ready" })).toBe(false);
    expect(canPublish({ status: "deleting", mux_status: "ready" })).toBe(false);
    expect(canUnpublish({ status: "published" })).toBe(true);
    expect(canUnpublish({ status: "draft" })).toBe(false);
    expect(canUnpublish({ status: "deleting" })).toBe(false);
  });
});

describe("formatDuration y quotaText", () => {
  it("duración en minutos y segundos; sin dato o inválida, nada", () => {
    expect(formatDuration(12.5)).toBe("0:13");
    expect(formatDuration(30)).toBe("0:30");
    expect(formatDuration(65)).toBe("1:05");
    for (const malo of [null, -1, Number.NaN, Infinity]) expect(formatDuration(malo), String(malo)).toBeNull();
  });

  it("cupo: «3 de 10», sin límite, o nada si no se conoce la cuenta", () => {
    expect(quotaText(3, 10)).toBe("3 de 10");
    expect(quotaText(0, 0)).toBe("0 de 0");
    expect(quotaText(3, null)).toBe("3 (sin límite)");
    expect(quotaText(undefined, 10)).toBeNull();
    expect(quotaText(3, undefined)).toBeNull();
  });
});

describe("videoErrorFromDb", () => {
  it("traduce los códigos de la base", () => {
    expect(videoErrorFromDb({ code: "53400", message: "limit_exceeded:videos_published" })).toBe("limit");
    expect(videoErrorFromDb({ code: "54000" })).toBe("cap");
    expect(videoErrorFromDb({ code: "42501", message: "feature_unavailable:video_feed" })).toBe("feature");
    expect(videoErrorFromDb({ code: "42501", message: "new row violates row-level security policy" })).toBe("forbidden");
    expect(videoErrorFromDb({ code: "55000", message: "video_deleting_is_final" })).toBe("deleting_final");
    expect(videoErrorFromDb({ code: "23503" })).toBe("product_invalid");
  });

  it("un CHECK significa «sin procesar» al publicar y «nombre inválido» al renombrar", () => {
    expect(videoErrorFromDb({ code: "23514" }, "publish")).toBe("not_ready");
    expect(videoErrorFromDb({ code: "23514" }, "title")).toBe("title_blank");
    expect(videoErrorFromDb({ code: "23514" })).toBe("unexpected");
  });

  it("sin código es la red: el resultado es incierto; con un código desconocido, inesperado", () => {
    expect(videoErrorFromDb({ message: "fetch failed" })).toBe("uncertain");
    expect(videoErrorFromDb({ code: "", message: "timeout" })).toBe("uncertain");
    expect(videoErrorFromDb({ code: "XX000" })).toBe("unexpected");
  });
});

describe("mensajes", () => {
  const errores: VideoError[] = [
    "title_blank", "title_too_long", "limit", "feature", "cap", "not_ready", "product_invalid", "deleting_final",
    "blocked_read_only", "blocked_suspended", "forbidden", "not_found", "mux_pending", "uncertain", "unexpected",
  ];

  it("todos los errores tienen un mensaje", () => {
    for (const error of errores) expect(videoErrorMessage(error, null).length, error).toBeGreaterThan(10);
  });

  it("el cupo sale de los entitlements, no del texto del error", () => {
    expect(videoErrorMessage("limit", ent({ limits: { videos_published: 10 } }))).toContain("10 videos publicados");
    expect(videoErrorMessage("limit", null)).not.toMatch(/\d/);
  });

  it("writeBlock falla cerrado y distingue solo lectura de suspendida", () => {
    expect(writeBlock(null)).toBe("unexpected");
    expect(writeBlock(ent())).toBeNull();
    expect(writeBlock(ent({ state: "read_only", canWrite: false }))).toBe("blocked_read_only");
    expect(writeBlock(ent({ state: "suspended", canWrite: false }))).toBe("blocked_suspended");
  });
});

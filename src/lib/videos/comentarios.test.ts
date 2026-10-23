import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientKeyFromIp } from "@/lib/llamados/client-key";
import type { Database } from "@/lib/supabase/database.types";
import { rateKeyFrom } from "./likes";
import {
  COMMENTS_PAGE_SIZE,
  commentRateKeyFrom,
  lengthOf,
  loadApprovedComments,
  MAX_ALIAS_LENGTH,
  MAX_COMMENT_LENGTH,
  normalizeText,
  parseComment,
  parseCommentResult,
  submitVideoComment,
} from "./comentarios";

const cabeceras = (valores: Record<string, string>) => ({ get: (nombre: string) => valores[nombre.toLowerCase()] ?? null });
const TOKEN = "c0ffee01000000000000000000000000";
const VIDEO = "1a1a1a1a-2b2b-4c3c-8d4d-5e5e5e5e5e5e";
const SECRETO = "un-secreto-de-prueba-largo";
const CLAVE = /^[0-9a-f]{32}$/;

describe("texto del comentario", () => {
  it("colapsa espacios, tabulaciones y saltos de línea en uno y recorta los bordes", () => {
    expect(normalizeText("  hola \n\n  mundo\t\tlindo  ")).toBe("hola mundo lindo");
    expect(normalizeText("\r\n")).toBe("");
    expect(normalizeText(null)).toBe("");
    expect(normalizeText(42)).toBe("");
  });

  it("quita los caracteres de control y los invisibles que cambian el sentido del texto", () => {
    expect(normalizeText(`a${String.fromCharCode(0)}b${String.fromCharCode(7)}c`)).toBe("a b c");
    expect(normalizeText(`a${String.fromCharCode(0x202e)}b`)).toBe("a b"); // inversión de lectura
    expect(normalizeText(`a${String.fromCharCode(0x200b)}b${String.fromCharCode(0xfeff)}c`)).toBe("a b c");
    expect(normalizeText("ñandú 🍕 ¡rico!")).toBe("ñandú 🍕 ¡rico!");
  });

  it("el largo cuenta caracteres, no unidades: un emoji vale uno (como en la base)", () => {
    expect(lengthOf("🍕")).toBe(1);
    expect(lengthOf("ñ")).toBe(1);
    expect(lengthOf("🍕".repeat(MAX_COMMENT_LENGTH))).toBe(MAX_COMMENT_LENGTH);
  });

  it("acepta hasta 280 caracteres y 30 de alias; el alias vacío es «sin alias»", () => {
    expect(parseComment("Muy rico", "  Ana  ")).toEqual({ ok: true, body: "Muy rico", alias: "Ana" });
    expect(parseComment("Muy rico", "")).toEqual({ ok: true, body: "Muy rico", alias: null });
    expect(parseComment("Muy rico", "   \n ")).toEqual({ ok: true, body: "Muy rico", alias: null });
    expect(parseComment("Muy rico", undefined)).toEqual({ ok: true, body: "Muy rico", alias: null });
    expect(parseComment("x".repeat(MAX_COMMENT_LENGTH), "y".repeat(MAX_ALIAS_LENGTH))).toMatchObject({ ok: true });
    expect(parseComment("🍕".repeat(MAX_COMMENT_LENGTH), "😀".repeat(MAX_ALIAS_LENGTH))).toMatchObject({ ok: true });
  });

  it("rechaza lo vacío, lo largo y los valores que no son texto", () => {
    expect(parseComment("", null)).toEqual({ ok: false, problem: "blank" });
    expect(parseComment("   \n\t ", null)).toEqual({ ok: false, problem: "blank" });
    expect(parseComment(undefined, null)).toEqual({ ok: false, problem: "blank" });
    expect(parseComment({ toString: () => "hola" }, null)).toEqual({ ok: false, problem: "blank" });
    expect(parseComment("x".repeat(MAX_COMMENT_LENGTH + 1), null)).toEqual({ ok: false, problem: "body_too_long" });
    expect(parseComment("hola", "y".repeat(MAX_ALIAS_LENGTH + 1))).toEqual({ ok: false, problem: "alias_too_long" });
  });

  it("el largo se mide después de normalizar: los saltos de línea no cuentan de más", () => {
    expect(parseComment(`${"x".repeat(MAX_COMMENT_LENGTH - 1)}\n\n\n\n`, null)).toMatchObject({ ok: true });
  });
});

describe("clave de conexión del comentario", () => {
  it("sale de la IP, no la contiene y no se cruza con la de los likes ni con la del llamado", () => {
    const ip = "203.0.113.9";
    const clave = commentRateKeyFrom(cabeceras({ "x-forwarded-for": `${ip}, 10.0.0.1` }), SECRETO);
    expect(clave).toMatch(CLAVE);
    expect(clave).not.toContain("203");
    expect(clave).not.toBe(rateKeyFrom(cabeceras({ "x-forwarded-for": ip }), SECRETO));
    expect(clave).not.toBe(clientKeyFromIp(ip, SECRETO));
    expect(commentRateKeyFrom(cabeceras({ "x-forwarded-for": "203.0.113.10" }), SECRETO)).not.toBe(clave);
    expect(commentRateKeyFrom(cabeceras({ "x-real-ip": ip }), SECRETO)).toBe(clave);
  });

  it("sin una IP utilizable no hay clave (y por lo tanto no hay límite por conexión)", () => {
    expect(commentRateKeyFrom(cabeceras({}), SECRETO)).toBeNull();
    expect(commentRateKeyFrom(cabeceras({ "x-forwarded-for": "no-es-ip" }), SECRETO)).toBeNull();
  });
});

describe("respuesta de la función", () => {
  it("lee cada estado", () => {
    for (const status of ["ok", "invalid", "queue_full", "session_closed", "unavailable", "not_found"] as const) {
      expect(parseCommentResult({ status })).toEqual({ status });
    }
    expect(parseCommentResult({ status: "rate_limited", retry_after_seconds: 12.2 })).toEqual({ status: "rate_limited", retryAfterSeconds: 13 });
  });

  it("cualquier forma inesperada es «no disponible» (falla cerrado)", () => {
    for (const raro of [null, undefined, "ok", 5, [], {}, { status: "otra" }, { status: "rate_limited" }, { status: "rate_limited", retry_after_seconds: 0 }, { status: "rate_limited", retry_after_seconds: "5" }]) {
      expect(parseCommentResult(raro), JSON.stringify(raro)).toEqual({ status: "unavailable" });
    }
  });
});

describe("enviar a la base", () => {
  const cliente = (rpc: ReturnType<typeof vi.fn>) => ({ rpc }) as unknown as SupabaseClient<Database>;
  const texto = { body: "Muy rico", alias: null };

  it("llama a submit_video_comment con el texto, sin alias ni clave si no hay, y devuelve el estado", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: "ok" }, error: null });
    expect(await submitVideoComment(cliente(rpc), TOKEN, VIDEO, texto, null)).toEqual({ status: "ok" });
    expect(rpc).toHaveBeenCalledWith("submit_video_comment", { p_token: TOKEN, p_video: VIDEO, p_body: "Muy rico" });
  });

  it("manda alias, clave de conexión y el ticket cuando los hay", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: "ok" }, error: null });
    const desde = new Date("2026-10-22T12:00:00.000Z");
    await submitVideoComment(cliente(rpc), TOKEN, VIDEO, { body: "Hola", alias: "Ana" }, "ab".repeat(16), desde);
    expect(rpc.mock.calls[0][1]).toEqual({ p_token: TOKEN, p_video: VIDEO, p_body: "Hola", p_alias: "Ana", p_rate: "ab".repeat(16), p_visit_started_at: "2026-10-22T12:00:00.000Z" });
  });

  it("un token o un video imposibles no llegan a la base", async () => {
    const rpc = vi.fn();
    expect(await submitVideoComment(cliente(rpc), "x", VIDEO, texto, null)).toEqual({ status: "not_found" });
    expect(await submitVideoComment(cliente(rpc), TOKEN, "no-uuid", texto, null)).toEqual({ status: "not_found" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("un error de la base o de la red es «no disponible» y el registro no lleva el texto", async () => {
    const registro = vi.spyOn(console, "error").mockImplementation(() => {});
    const conError = vi.fn().mockResolvedValue({ data: null, error: { code: "XX000", message: "caída" } });
    expect(await submitVideoComment(cliente(conError), TOKEN, VIDEO, { body: "secreto del comensal", alias: "Ana" }, "ab".repeat(16))).toEqual({ status: "unavailable" });
    const sinRed = vi.fn().mockRejectedValue(new Error("sin red"));
    expect(await submitVideoComment(cliente(sinRed), TOKEN, VIDEO, { body: "secreto del comensal", alias: "Ana" }, "ab".repeat(16))).toEqual({ status: "unavailable" });
    const escrito = registro.mock.calls.map((llamada) => llamada.join(" ")).join("\n");
    expect(escrito).not.toContain("secreto del comensal");
    expect(escrito).not.toContain("Ana");
    expect(escrito).not.toContain(TOKEN);
    registro.mockRestore();
  });
});

describe("leer los aprobados", () => {
  const fila = (n: number) => ({ id: `id-${n}`, alias: n % 2 ? "Ana" : null, body: `c${n}`, created_at: "2026-10-22T12:00:00+00:00" });
  const consulta = (rows: unknown[] | null, error: { message: string } | null = null) => {
    const range = vi.fn().mockResolvedValue({ data: rows, error });
    const order2 = vi.fn(() => ({ range }));
    const order1 = vi.fn(() => ({ order: order2 }));
    const eq = vi.fn(() => ({ order: order1 }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    return { db: { from } as unknown as SupabaseClient<Database>, from, select, eq, range };
  };

  it("pide una fila de más para saber si hay otra página, y no la devuelve", async () => {
    const q = consulta(Array.from({ length: COMMENTS_PAGE_SIZE + 1 }, (_, i) => fila(i)));
    const page = await loadApprovedComments(q.db, VIDEO, 0);
    expect(page.comments).toHaveLength(COMMENTS_PAGE_SIZE);
    expect(page.hasMore).toBe(true);
    expect(q.from).toHaveBeenCalledWith("video_comments");
    expect(q.select).toHaveBeenCalledWith("id, alias, body, created_at"); // nunca el estado ni la clave de conexión
    expect(q.eq).toHaveBeenCalledWith("video_id", VIDEO);
    expect(q.range).toHaveBeenCalledWith(0, COMMENTS_PAGE_SIZE);
  });

  it("la última página no ofrece más; sin filas, tampoco", async () => {
    expect(await loadApprovedComments(consulta([fila(1), fila(2)]).db, VIDEO, 0)).toMatchObject({ hasMore: false, comments: [{ id: "id-1" }, { id: "id-2" }] });
    expect(await loadApprovedComments(consulta([]).db, VIDEO, 0)).toEqual({ comments: [], hasMore: false });
    expect(await loadApprovedComments(consulta(null).db, VIDEO, 0)).toEqual({ comments: [], hasMore: false });
  });

  it("descarta filas con otra forma", async () => {
    const page = await loadApprovedComments(consulta([fila(1), { id: 5, body: "x" }, null, { id: "a", body: "b", created_at: "c", alias: 3 }]).db, VIDEO, 0);
    expect(page.comments.map((c) => c.id)).toEqual(["id-1"]);
  });

  it("un video imposible no llega a la base; el desplazamiento se acota", async () => {
    const q = consulta([]);
    expect(await loadApprovedComments(q.db, "no-uuid", 0)).toEqual({ comments: [], hasMore: false });
    expect(q.from).not.toHaveBeenCalled();
    await loadApprovedComments(q.db, VIDEO, -5);
    expect(q.range).toHaveBeenLastCalledWith(0, COMMENTS_PAGE_SIZE);
    await loadApprovedComments(q.db, VIDEO, "10");
    expect(q.range).toHaveBeenLastCalledWith(0, COMMENTS_PAGE_SIZE);
    await loadApprovedComments(q.db, VIDEO, 1_000_000);
    expect(q.range).toHaveBeenLastCalledWith(500, 500 + COMMENTS_PAGE_SIZE);
    await loadApprovedComments(q.db, VIDEO, 1.5);
    expect(q.range).toHaveBeenLastCalledWith(0, COMMENTS_PAGE_SIZE);
  });

  it("lanza si la base falla", async () => {
    await expect(loadApprovedComments(consulta(null, { message: "caída" }).db, VIDEO, 0)).rejects.toThrow(/caída/);
  });
});

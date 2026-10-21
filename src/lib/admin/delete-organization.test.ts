import { describe, expect, it, vi } from "vitest";
import { canDeleteNow, deleteOrganization, deletionAvailableAt, DELETION_WAIT_DAYS, removeOrganizationFiles } from "./delete-organization";
import type { AdminContext } from "./organizations";

const DIA_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-12-01T12:00:00Z");
const ORG = "10000000-0000-4000-8000-0000000000aa";

describe("plazo del borrado", () => {
  it("corre 30 días desde la baja auditada", () => {
    const baja = "2026-11-01T12:00:00Z";
    expect(DELETION_WAIT_DAYS).toBe(30);
    expect(deletionAvailableAt(baja)?.toISOString()).toBe("2026-12-01T12:00:00.000Z");
  });

  it("sin baja auditada (o fecha ilegible) no hay plazo y no se puede borrar", () => {
    expect(deletionAvailableAt(null)).toBeNull();
    expect(deletionAvailableAt("no es una fecha")).toBeNull();
    expect(canDeleteNow(null, NOW)).toBe(false);
    expect(canDeleteNow("no es una fecha", NOW)).toBe(false);
  });

  it("se puede borrar justo a los 30 días y no un minuto antes", () => {
    expect(canDeleteNow(new Date(NOW.getTime() - 30 * DIA_MS).toISOString(), NOW)).toBe(true);
    expect(canDeleteNow(new Date(NOW.getTime() - 30 * DIA_MS + 60_000).toISOString(), NOW)).toBe(false);
    expect(canDeleteNow(new Date(NOW.getTime() - 90 * DIA_MS).toISOString(), NOW)).toBe(true);
    expect(canDeleteNow(NOW.toISOString(), NOW)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Storage simulado: un árbol de carpetas por bucket
// ---------------------------------------------------------------------------

type Entry = { name: string; id: string | null };
type Tree = Record<string, Record<string, Entry[]>>; // bucket → carpeta → entradas

const file = (name: string): Entry => ({ name, id: `id-${name}` });
const folder = (name: string): Entry => ({ name, id: null });

function fakeStorage(tree: Tree, opciones: { listError?: string; removeError?: string; removeShort?: boolean } = {}) {
  const removed: Array<{ bucket: string; paths: string[] }> = [];
  const storage = {
    from: (bucket: string) => ({
      list: async (prefix: string, { limit, offset }: { limit: number; offset: number }) => {
        if (opciones.listError) return { data: null, error: { message: opciones.listError } };
        return { data: (tree[bucket]?.[prefix] ?? []).slice(offset, offset + limit), error: null };
      },
      remove: async (paths: string[]) => {
        if (opciones.removeError) return { data: null, error: { message: opciones.removeError } };
        removed.push({ bucket, paths });
        return { data: (opciones.removeShort ? paths.slice(1) : paths).map((name) => ({ name })), error: null };
      },
    }),
  };
  return { db: { storage } as never, removed };
}

describe("archivos de Storage de la organización", () => {
  it("recorre las carpetas de platos y borra solo lo de la organización, en los dos buckets", async () => {
    const { db, removed } = fakeStorage({
      "product-images": {
        [ORG]: [folder("plato-1"), folder("plato-2")],
        [`${ORG}/plato-1`]: [file("a.jpg"), file("b.webp")],
        [`${ORG}/plato-2`]: [file("c.png")],
      },
      "organization-logos": { [ORG]: [file("logo.png")] },
    });
    expect(await removeOrganizationFiles(db, ORG)).toEqual({ removed: 4, complete: true });
    expect(removed).toEqual([
      { bucket: "product-images", paths: [`${ORG}/plato-1/a.jpg`, `${ORG}/plato-1/b.webp`, `${ORG}/plato-2/c.png`] },
      { bucket: "organization-logos", paths: [`${ORG}/logo.png`] },
    ]);
  });

  it("pagina el listado y borra en tandas de 100", async () => {
    const muchos = Array.from({ length: 250 }, (_, i) => file(`f${String(i).padStart(3, "0")}.jpg`));
    const { db, removed } = fakeStorage({ "product-images": { [ORG]: muchos } });
    expect(await removeOrganizationFiles(db, ORG)).toEqual({ removed: 250, complete: true });
    expect(removed.map((r) => r.paths.length)).toEqual([100, 100, 50]);
  });

  it("una organización sin archivos devuelve 0 y completo", async () => {
    const { db, removed } = fakeStorage({});
    expect(await removeOrganizationFiles(db, ORG)).toEqual({ removed: 0, complete: true });
    expect(removed).toEqual([]);
  });

  it("si Storage falla al listar o al borrar, no lanza: queda incompleto y lo registra", async () => {
    const aviso = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const arbol: Tree = { "product-images": { [ORG]: [file("a.jpg")] }, "organization-logos": { [ORG]: [file("l.png")] } };
      expect(await removeOrganizationFiles(fakeStorage(arbol, { listError: "caído" }).db, ORG)).toEqual({ removed: 0, complete: false });
      expect(await removeOrganizationFiles(fakeStorage(arbol, { removeError: "caído" }).db, ORG)).toEqual({ removed: 0, complete: false });
      expect(aviso).toHaveBeenCalledWith(expect.stringContaining(ORG));
    } finally {
      aviso.mockRestore();
    }
  });

  it("si Storage borra menos de lo pedido, el resultado queda incompleto", async () => {
    const { db } = fakeStorage({ "product-images": { [ORG]: [file("a.jpg"), file("b.jpg")] } }, { removeShort: true });
    expect(await removeOrganizationFiles(db, ORG)).toEqual({ removed: 1, complete: false });
  });
});

// ---------------------------------------------------------------------------
// La acción: validación, traducción de errores y orden (primero la base, después Storage)
// ---------------------------------------------------------------------------

type RpcError = { code?: string; message?: string };

function fakeContext(opciones: { admin?: boolean; data?: unknown; error?: RpcError | null; tree?: Tree } = {}) {
  const eventos: string[] = [];
  const query = (data: unknown) => {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data, error: null }) };
    return q;
  };
  const session = { from: () => query(opciones.admin === false ? null : { user_id: "actor" }) };
  const storage = fakeStorage(opciones.tree ?? { "organization-logos": { [ORG]: [file("logo.png")] } });
  const admin = {
    from: () => query({ id: ORG }),
    rpc: async (nombre: string, args: Record<string, unknown>) => {
      eventos.push(`rpc:${nombre}:${JSON.stringify(args)}`);
      return { data: opciones.data ?? null, error: opciones.error ?? null };
    },
    storage: {
      from: (bucket: string) => {
        const base = (storage.db as { storage: { from: (b: string) => Record<string, (...a: never[]) => unknown> } }).storage.from(bucket);
        return {
          list: (...a: never[]) => (eventos.push(`storage:list:${bucket}`), base.list(...a)),
          remove: (...a: never[]) => (eventos.push(`storage:remove:${bucket}`), base.remove(...a)),
        };
      },
    },
  };
  return { ctx: { session, admin, actorId: "actor" } as unknown as AdminContext, eventos };
}

const valido = { slug: "local-1", confirmSlug: "local-1", reason: "Cerró el local" };

describe("deleteOrganization", () => {
  it("lo inválido se rechaza antes de llamar a la base ni a Storage", async () => {
    const { ctx, eventos } = fakeContext();
    expect(await deleteOrganization(ctx, { ...valido, confirmSlug: "" })).toEqual({ ok: false, error: "slug_mismatch" });
    expect(await deleteOrganization(ctx, { ...valido, confirmSlug: "otro-local" })).toEqual({ ok: false, error: "slug_mismatch" });
    expect(await deleteOrganization(ctx, { ...valido, confirmSlug: "LOCAL-1" })).toEqual({ ok: false, error: "slug_mismatch" });
    expect(await deleteOrganization(ctx, { ...valido, confirmSlug: undefined })).toEqual({ ok: false, error: "slug_mismatch" });
    expect(await deleteOrganization(ctx, { ...valido, reason: "   " })).toEqual({ ok: false, error: "invalid_reason" });
    expect(await deleteOrganization(ctx, { ...valido, slug: "Slug Raro!" })).toEqual({ ok: false, error: "org_not_found" });
    expect(eventos).toEqual([]);
  });

  it("quien no es SuperAdmin no llega a la base", async () => {
    const { ctx, eventos } = fakeContext({ admin: false });
    expect(await deleteOrganization(ctx, valido)).toEqual({ ok: false, error: "forbidden" });
    expect(eventos).toEqual([]);
  });

  it("los rechazos de la base se traducen y NO se tocan los archivos", async () => {
    const casos: Array<[RpcError, string]> = [
      [{ code: "55000", message: "organization_still_active" }, "organization_still_active"],
      [{ code: "55000", message: "deactivation_not_audited" }, "deactivation_not_audited"],
      [{ code: "55000", message: "deactivation_too_recent" }, "deactivation_too_recent"],
      [{ code: "22023", message: "slug_mismatch" }, "slug_mismatch"],
      [{ code: "42501", message: "not_platform_admin" }, "forbidden"],
      [{ code: "P0002", message: "organization_not_found" }, "org_not_found"],
    ];
    for (const [error, esperado] of casos) {
      const { ctx, eventos } = fakeContext({ error });
      expect(await deleteOrganization(ctx, valido), esperado).toEqual({ ok: false, error: esperado });
      expect(eventos.filter((e) => e.startsWith("storage:")), esperado).toEqual([]);
    }
  });

  it("sin SQLSTATE el resultado es incierto y tampoco se tocan los archivos", async () => {
    const { ctx, eventos } = fakeContext({ error: { message: "fetch failed" } });
    expect(await deleteOrganization(ctx, valido)).toEqual({ ok: false, error: "uncertain_change" });
    expect(eventos.filter((e) => e.startsWith("storage:"))).toEqual([]);
  });

  it("al salir bien: la base primero (con el slug escrito y el motivo), Storage después, y devuelve el resumen", async () => {
    const { ctx, eventos } = fakeContext({ data: { price_history_purged: 7, payments_kept: 3 } });
    const result = await deleteOrganization(ctx, valido);
    expect(result).toEqual({
      ok: true,
      data: { slug: "local-1", priceHistoryPurged: 7, paymentsKept: 3, files: { removed: 1, complete: true } },
    });
    expect(eventos[0]).toBe(`rpc:admin_delete_organization:${JSON.stringify({ p_actor: "actor", p_org: ORG, p_slug: "local-1", p_reason: "Cerró el local" })}`);
    expect(eventos.slice(1).every((e) => e.startsWith("storage:"))).toBe(true);
    expect(eventos.some((e) => e.startsWith("storage:remove:organization-logos"))).toBe(true);
  });

  it("acepta el identificador escrito con espacios alrededor; una respuesta ilegible de la base no inventa cifras", async () => {
    const { ctx } = fakeContext({ data: "raro" });
    const result = await deleteOrganization(ctx, { ...valido, confirmSlug: "  local-1 " });
    expect(result).toMatchObject({ ok: true, data: { priceHistoryPurged: 0, paymentsKept: 0 } });
  });
});

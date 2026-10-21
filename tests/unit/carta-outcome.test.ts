import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Invalidación de la caché de la carta pública (`outcome` de las server actions de la carta): tiene que reflejar TODO cambio
 * efectivamente confirmado y también el que pudo haberse confirmado (se perdió la respuesta de la base), y no moverse ante un
 * fallo que la base revirtió entera.
 */

const revalidatePath = vi.fn();
const updateTag = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath, updateTag }));
vi.mock("@/lib/auth/session", () => ({ getEntitlements: vi.fn(async () => null), requireMembership: vi.fn() }));
vi.mock("@/lib/public-menu", () => ({ cartaTag: (orgId: string) => `carta:${orgId}` }));
vi.mock("@/lib/supabase/server", () => ({ createSessionClient: vi.fn() }));

const { outcome } = await import("@/app/panel/[org]/carta/action-helpers");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("outcome: invalidación de la caché de la carta", () => {
  it("un cambio confirmado vence la caché de la organización y refresca el panel", async () => {
    const r = await outcome("cafe", "org-1", { ok: true, data: undefined }, "Subido.");

    expect(r).toEqual({ ok: true, message: "Subido." });
    expect(updateTag).toHaveBeenCalledWith("carta:org-1");
    expect(revalidatePath).toHaveBeenCalledWith("/panel/cafe", "layout");
  });

  it("«no sé si se guardó» (se perdió la respuesta) vence la caché igual: el cambio pudo haber quedado hecho", async () => {
    const r = await outcome("cafe", "org-1", { ok: false, error: "uncertain" }, "Subido.");

    expect(r.error).toMatch(/No pudimos confirmar/);
    expect(r.ok).toBeUndefined();
    expect(updateTag).toHaveBeenCalledWith("carta:org-1");
  });

  it.each(["order_changed", "forbidden", "not_found", "blocked_read_only", "unexpected", "image_failed"] as const)(
    "un fallo con respuesta de la base (%s) la revirtió entera: no hay nada que invalidar",
    async (error) => {
      const r = await outcome("cafe", "org-1", { ok: false, error }, "Subido.");

      expect(r.error).toBeTruthy();
      expect(updateTag).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("si el cambio quedó hecho pero el archivo anterior no se pudo borrar, lo dice sin presentarlo como limpio", async () => {
    const limpio = await outcome("cafe", "org-1", { ok: true, data: { filesComplete: true } }, "Foto guardada.");
    const sucio = await outcome("cafe", "org-1", { ok: true, data: { filesComplete: false } }, "Foto guardada.");

    expect(limpio.message).toBe("Foto guardada.");
    expect(sucio.ok).toBe(true);
    expect(sucio.message).toMatch(/^Foto guardada\. El archivo anterior no se pudo borrar/);
    expect(updateTag).toHaveBeenCalledTimes(2); // el cambio sí quedó hecho: la caché se vence en los dos casos
  });
});

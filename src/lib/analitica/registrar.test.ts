import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { isUuid, recordDishView } from "./registrar";

const BRANCH = "0b6f3d8c-0000-4000-8000-000000000001";
const PRODUCT = "0b6f3d8c-0000-4000-8000-000000000002";

const fakeDb = (rpc: ReturnType<typeof vi.fn>) => ({ rpc }) as unknown as SupabaseClient<Database>;

describe("registrar una vista", () => {
  it("llama a la función de base con los dos ids y devuelve lo que dijo la base", async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    expect(await recordDishView(fakeDb(rpc), BRANCH, PRODUCT)).toBe(true);
    expect(rpc).toHaveBeenCalledWith("record_dish_view", { p_branch: BRANCH, p_product: PRODUCT });

    const no = vi.fn(async () => ({ data: false, error: null }));
    expect(await recordDishView(fakeDb(no), BRANCH, PRODUCT)).toBe(false);
  });

  it.each([
    ["sin ids", undefined, undefined],
    ["ids que no son uuid", "abc", PRODUCT],
    ["un uuid con mayúsculas o relleno", BRANCH.toUpperCase(), PRODUCT],
    ["una inyección", `${BRANCH}'; drop table x; --`, PRODUCT],
    ["números", 1, 2],
    ["un objeto", { id: BRANCH }, PRODUCT],
  ])("%s: ni siquiera llega a la base", async (_nombre, branch, product) => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    expect(await recordDishView(fakeDb(rpc), branch, product)).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("un error de la base, una respuesta rara o una excepción son false y nunca lanzan", async () => {
    expect(await recordDishView(fakeDb(vi.fn(async () => ({ data: null, error: { message: "x" } }))), BRANCH, PRODUCT)).toBe(false);
    expect(await recordDishView(fakeDb(vi.fn(async () => ({ data: "true", error: null }))), BRANCH, PRODUCT)).toBe(false);
    expect(await recordDishView(fakeDb(vi.fn(async () => { throw new Error("sin red"); })), BRANCH, PRODUCT)).toBe(false);
  });

  it("isUuid solo acepta la forma en minúsculas", () => {
    expect(isUuid(BRANCH)).toBe(true);
    expect(isUuid("no")).toBe(false);
    expect(isUuid(BRANCH.toUpperCase())).toBe(false);
  });
});

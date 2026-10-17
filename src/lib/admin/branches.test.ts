import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { correctBranchSlug } from "./branches";

const ACTOR = "10000000-0000-4000-8000-000000000001";
const BRANCH = "20000000-0000-4000-8000-000000000001";
const ctx = () => ({ session: createClient<Database>("http://session.test", "key"), admin: createClient<Database>("http://service.test", "key"), actorId: ACTOR });
const input = { orgSlug: "local", branchId: BRANCH, expectedSlug: "centro", newSlug: "central" };
afterEach(() => vi.unstubAllGlobals());

describe("corrección de dirección con cliente de servicio", () => {
  it("no llega al servicio si la sesión no demuestra que es SuperAdmin", async () => {
    const requests = vi.fn(async (raw: RequestInfo | URL) => {
      const url = new URL(raw instanceof Request ? raw.url : raw);
      expect(url.host).toBe("session.test");
      expect(url.pathname).toContain("platform_admins");
      return Response.json([]);
    });
    vi.stubGlobal("fetch", requests);
    expect(await correctBranchSlug(ctx(), input)).toEqual({ ok: false, error: "forbidden" });
    expect(requests).toHaveBeenCalledTimes(1);
  });
  it("una respuesta perdida no afirma que la corrección se revirtió", async () => {
    vi.stubGlobal("fetch", vi.fn(async (raw: RequestInfo | URL) => {
      const url = new URL(raw instanceof Request ? raw.url : raw);
      if (url.pathname.endsWith("platform_admins")) return Response.json({ user_id: ACTOR });
      if (url.pathname.endsWith("organizations")) return Response.json({ id: ACTOR });
      expect(url.searchParams.get("organization_id")).toBe(`eq.${ACTOR}`);
      expect(url.searchParams.get("id")).toBe(`eq.${BRANCH}`);
      expect(url.searchParams.get("slug")).toBe("eq.centro");
      return Response.json({ code: "NETWORK", message: "respuesta perdida" }, { status: 400 });
    }));
    expect(await correctBranchSlug(ctx(), input)).toEqual({ ok: false, error: "uncertain_change" });
  });
});

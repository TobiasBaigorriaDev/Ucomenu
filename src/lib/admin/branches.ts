import { asUuid } from "@/lib/carta/validation";
import { readAllPages } from "@/lib/paginar";
import { validateBranchSlug } from "@/lib/sucursales/rules";
import { fail, isPlatformAdmin, ok, type AdminContext, type Result } from "./organizations";
import { parseSlug } from "./validation";

export type AdminBranch = { id: string; name: string; slug: string };

export async function listAdminBranches(ctx: AdminContext, orgId: string): Promise<Result<AdminBranch[]>> {
  if (!(await isPlatformAdmin(ctx))) return fail("forbidden");
  const rows = await readAllPages((from, to) => ctx.admin.from("branches").select("id, name, slug")
    .eq("organization_id", orgId).order("id").range(from, to));
  return rows.error ? fail("unexpected") : ok((rows.data ?? []).sort((a, b) => a.name.localeCompare(b.name, "es-AR")));
}

/** La clave de servicio solo se usa después de comprobar el actor con su propia sesión. */
export async function correctBranchSlug(ctx: AdminContext, input: {
  orgSlug: unknown; branchId: unknown; expectedSlug: unknown; newSlug: unknown;
}): Promise<Result<{ orgId: string; slug: string; previousSlug: string }>> {
  if (!(await isPlatformAdmin(ctx))) return fail("forbidden");
  const orgSlug = parseSlug(input.orgSlug);
  const branchId = asUuid(input.branchId);
  const expected = parseSlug(input.expectedSlug);
  const next = validateBranchSlug(input.newSlug);
  if (!next.ok) return fail("invalid_branch_slug");
  if (!orgSlug || !branchId || !expected) return fail("branch_not_found");

  const org = await ctx.admin.from("organizations").select("id").eq("slug", orgSlug).maybeSingle();
  if (org.error) return fail("unexpected");
  if (!org.data) return fail("org_not_found");
  const changed = await ctx.admin.from("branches").update({ slug: next.value })
    .eq("organization_id", org.data.id).eq("id", branchId).eq("slug", expected).select("slug");
  if (changed.error) {
    if (changed.error.code === "23505") return fail("branch_slug_taken");
    if (changed.error.code === "23514") return fail("invalid_branch_slug");
    return fail(/^[0-9A-Z]{5}$/.test(changed.error.code ?? "") ? "unexpected" : "uncertain_change");
  }
  if (changed.data.length !== 1 || changed.data[0].slug !== next.value) return fail("branch_changed");
  if (expected === next.value) return fail("branch_slug_unchanged");
  return ok({ orgId: org.data.id, slug: next.value, previousSlug: expected });
}

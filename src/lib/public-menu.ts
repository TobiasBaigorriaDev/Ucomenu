import { cache } from "react";
import { groupMenu, type MenuSection } from "@/lib/menu";
import { createPublicClient } from "@/lib/supabase/public-client";

export type PublicMenu = {
  organization: { id: string; name: string; slug: string };
  branch: { id: string; name: string; slug: string };
  sections: MenuSection[];
};

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Carta pública de una sucursal. Devuelve `null` si la organización o la sucursal no existen
 * o no son publicables (RLS las oculta). Está envuelta en `cache` para que `generateMetadata`
 * y la página compartan una sola consulta por pedido.
 */
export const getPublicMenu = cache(async (orgSlug: string, branchSlug: string): Promise<PublicMenu | null> => {
  // Descarta slugs imposibles sin ir a la base.
  if (orgSlug.length > 64 || branchSlug.length > 64 || !SLUG.test(orgSlug) || !SLUG.test(branchSlug)) {
    return null;
  }

  const supabase = createPublicClient();

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("id, name, slug, branches!inner(id, name, slug)")
    .eq("slug", orgSlug)
    .eq("branches.slug", branchSlug)
    .maybeSingle();

  if (orgError) throw new Error(`No se pudo leer la organización: ${orgError.message}`);
  const branch = org?.branches[0];
  if (!org || !branch) return null;

  const [categories, products] = await Promise.all([
    supabase.from("categories").select("id, name, sort_order").eq("organization_id", org.id),
    supabase
      .from("products")
      .select("id, category_id, name, description, price_cents, sort_order")
      .eq("organization_id", org.id),
  ]);

  if (categories.error) throw new Error(`No se pudieron leer las categorías: ${categories.error.message}`);
  if (products.error) throw new Error(`No se pudieron leer los platos: ${products.error.message}`);

  return {
    organization: { id: org.id, name: org.name, slug: org.slug },
    branch: { id: branch.id, name: branch.name, slug: branch.slug },
    sections: groupMenu(categories.data, products.data),
  };
});

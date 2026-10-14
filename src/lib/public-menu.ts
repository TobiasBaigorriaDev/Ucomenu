import { cache } from "react";
import { groupMenu, type MenuSection } from "@/lib/menu";
import { isValidSlug } from "@/lib/slug";
import { createPublicClient } from "@/lib/supabase/public-client";

export type PublicMenu = {
  organization: { id: string; name: string; slug: string };
  branch: { id: string; name: string; slug: string };
  sections: MenuSection[];
};

/**
 * Resultado de pedir una carta pública:
 *  - `menu`: la carta publicada;
 *  - `unavailable`: la organización existe pero su cuenta está suspendida por mora (se muestra
 *    «Carta temporalmente no disponible»; los datos siguen intactos);
 *  - `null`: no existe o no es publicable (RLS la oculta) -> 404.
 */
export type PublicMenuResult =
  | { kind: "menu"; menu: PublicMenu }
  | { kind: "unavailable"; organizationName: string }
  | null;

/**
 * Carta pública de una sucursal. Está envuelta en `cache` para que `generateMetadata`
 * y la página compartan una sola consulta por pedido.
 */
export const getPublicMenu = cache(async (orgSlug: string, branchSlug: string): Promise<PublicMenuResult> => {
  // Descarta slugs imposibles sin ir a la base.
  if (!isValidSlug(orgSlug) || !isValidSlug(branchSlug)) {
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
  if (!org || !branch) return unavailableOrNull(supabase, orgSlug);

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
    kind: "menu",
    menu: {
      organization: { id: org.id, name: org.name, slug: org.slug },
      branch: { id: branch.id, name: branch.name, slug: branch.slug },
      sections: groupMenu(categories.data, products.data),
    },
  };
});

/**
 * Una organización suspendida oculta sus sucursales (RLS), así que desde la consulta principal
 * se ve igual que una inexistente. Solo en ese camino se pregunta el estado público.
 */
async function unavailableOrNull(supabase: ReturnType<typeof createPublicClient>, orgSlug: string): Promise<PublicMenuResult> {
  const status = await supabase.rpc("public_menu_status", { p_slug: orgSlug });
  if (status.error) throw new Error(`No se pudo leer el estado de la carta: ${status.error.message}`);
  if (status.data !== "suspended") return null;

  const org = await supabase.from("organizations").select("name").eq("slug", orgSlug).maybeSingle();
  if (org.error) throw new Error(`No se pudo leer la organización: ${org.error.message}`);
  return org.data ? { kind: "unavailable", organizationName: org.data.name } : null;
}

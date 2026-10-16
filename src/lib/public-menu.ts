import { unstable_cache } from "next/cache";
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

/** Etiqueta de caché de las categorías y platos de una organización. Las acciones del panel la invalidan al guardar. */
export const cartaTag = (orgId: string) => `carta:${orgId}`;

/**
 * Tope de antigüedad de lo cacheado. La invalidación normal es por etiqueta (`cartaTag`); este tiempo acota lo que la
 * etiqueta no ve: un cambio hecho directo en la base y una lectura en vuelo que termina de guardarse justo después de
 * invalidar.
 */
export const CARTA_CACHE_SECONDS = 60;

type CartaRows = {
  categories: { id: string; name: string; sort_order: number }[];
  products: {
    id: string;
    category_id: string;
    name: string;
    description: string | null;
    price_cents: number;
    sort_order: number;
    image_path: string | null;
  }[];
};

async function loadRows(orgId: string): Promise<CartaRows> {
  const supabase = createPublicClient();
  const [categories, products] = await Promise.all([
    supabase.from("categories").select("id, name, sort_order").eq("organization_id", orgId),
    supabase
      .from("products")
      .select("id, category_id, name, description, price_cents, sort_order, image_path")
      .eq("organization_id", orgId),
  ]);

  if (categories.error) throw new Error(`No se pudieron leer las categorías: ${categories.error.message}`);
  if (products.error) throw new Error(`No se pudieron leer los platos: ${products.error.message}`);
  return { categories: categories.data, products: products.data };
}

/**
 * Categorías y platos publicados de una organización, con caché. Solo se cachea esto, que cambia únicamente cuando el
 * local edita su carta; todo lo que decide si la carta se puede mostrar (que la organización exista y esté activa, que la
 * cuenta no esté suspendida, que la sucursal exista) se consulta SIEMPRE en vivo en `getPublicMenu` antes de llegar acá.
 * Por eso una caché vieja nunca publica la carta de una cuenta suspendida ni de otra organización: la clave lleva el id
 * de la organización que ya resolvió la consulta en vivo.
 *
 * Se guarda TODO resultado, también el vacío: `unstable_cache` renueva en segundo plano al vencer y, si esa renovación
 * falla (p. ej. porque se negara a guardar un resultado vacío), conserva el valor anterior para siempre. Costo aceptado: si
 * la cuenta se suspende justo mientras se lee, la base devuelve filas vacías (RLS) y la carta de esa cuenta queda «sin
 * platos» hasta 60 s después de regularizarla. Otro límite aceptado: una lectura en vuelo mientras alguien edita puede
 * guardar los datos anteriores después de la invalidación; dura como máximo lo mismo (`CARTA_CACHE_SECONDS`).
 */
function readRows(orgId: string): Promise<CartaRows> {
  return unstable_cache(() => loadRows(orgId), ["carta-publica", orgId], {
    tags: [cartaTag(orgId)],
    revalidate: CARTA_CACHE_SECONDS,
  })();
}

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
  if (!org || !branch) return unavailableOrNull(supabase, orgSlug, branchSlug);

  const { categories, products } = await readRows(org.id);

  return {
    kind: "menu",
    menu: {
      organization: { id: org.id, name: org.name, slug: org.slug },
      branch: { id: branch.id, name: branch.name, slug: branch.slug },
      sections: groupMenu(categories, products),
    },
  };
});

/**
 * Una organización suspendida oculta sus sucursales (RLS), así que desde la consulta principal
 * se ve igual que una inexistente. Solo en ese camino se pregunta el estado público.
 */
async function unavailableOrNull(
  supabase: ReturnType<typeof createPublicClient>,
  orgSlug: string,
  branchSlug: string,
): Promise<PublicMenuResult> {
  // La función exige que la sucursal exista: una inventada sigue siendo 404 aunque la cuenta esté suspendida.
  const status = await supabase.rpc("public_menu_status", { p_org_slug: orgSlug, p_branch_slug: branchSlug });
  if (status.error) throw new Error(`No se pudo leer el estado de la carta: ${status.error.message}`);
  if (status.data !== "suspended") return null;

  const org = await supabase.from("organizations").select("name").eq("slug", orgSlug).maybeSingle();
  if (org.error) throw new Error(`No se pudo leer la organización: ${org.error.message}`);
  return org.data ? { kind: "unavailable", organizationName: org.data.name } : null;
}

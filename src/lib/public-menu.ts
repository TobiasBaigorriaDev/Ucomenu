import { unstable_cache } from "next/cache";
import { cache } from "react";
import { attachOptions, groupMenu, type MenuSection } from "@/lib/menu";
import { isPalette, type Palette } from "@/lib/identidad/palettes";
import type { Lang } from "@/lib/idiomas/idiomas";
import { offeredLanguages } from "@/lib/idiomas/localizar";
import { parseTranslations, type Translations } from "@/lib/idiomas/traducciones";
import { readAllPages } from "@/lib/paginar";
import { isValidSlug } from "@/lib/slug";
import { loadSoldOutProducts } from "@/lib/carta/availability";
import { createPublicClient } from "@/lib/supabase/public-client";

export type PublicMenu = {
  organization: { id: string; name: string; slug: string; menu_palette: Palette; logo_path?: string | null };
  branch: { id: string; name: string; slug: string };
  /** Textos originales (en español) con sus traducciones; la página los resuelve al idioma elegido con `localizeSections`. */
  sections: MenuSection[];
  /** Idiomas que ofrece el local: el español y los que tengan al menos un texto traducido. */
  languages: Lang[];
};

/**
 * Resultado de pedir una carta pública:
 *  - `menu`: la carta publicada;
 *  - `unavailable`: la organización existe pero su cuenta está suspendida por mora (`reason: "suspended"`) o la sucursal
 *    está desactivada (`reason: "branch_inactive"`): se muestra «no disponible» y los datos siguen intactos;
 *  - `null`: no existe o no es publicable (RLS la oculta) -> 404.
 */
export type UnavailableReason = "suspended" | "branch_inactive";

export type PublicMenuResult =
  | { kind: "menu"; menu: PublicMenu }
  | { kind: "unavailable"; organizationName: string; reason: UnavailableReason }
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
  categories: { id: string; name: string; sort_order: number; translations: Translations }[];
  products: {
    id: string;
    category_id: string;
    name: string;
    description: string | null;
    price_cents: number;
    sort_order: number;
    image_path: string | null;
    dietary_tags: string[];
    translations: Translations;
  }[];
  /** Variantes y adicionales publicados (la base solo entrega lo activo de platos visibles). */
  optionGroups: {
    id: string;
    product_id: string;
    name: string;
    min_choices: number;
    max_choices: number;
    sort_order: number;
    translations: Translations;
  }[];
  options: { id: string; group_id: string; name: string; price_delta_cents: number; sort_order: number; translations: Translations }[];
};

/**
 * Lee todas las filas de la organización PÁGINA POR PÁGINA (`readAllPages`, orden estable por id): PostgREST corta cada
 * lectura en `max_rows` (1000) sin avisar. Exportada para probar la lectura sin pasar por la caché.
 */
export async function loadRows(orgId: string): Promise<CartaRows> {
  const supabase = createPublicClient();
  const [categories, products, optionGroups, options] = await Promise.all([
    readAllPages((from, to) =>
      supabase
        .from("categories")
        .select("id, name, sort_order, translations")
        .eq("organization_id", orgId)
        .order("id")
        .range(from, to),
    ),
    readAllPages((from, to) =>
      supabase
        .from("products")
        .select("id, category_id, name, description, price_cents, sort_order, image_path, dietary_tags, translations")
        .eq("organization_id", orgId)
        .order("id")
        .range(from, to),
    ),
    readAllPages((from, to) =>
      supabase
        .from("option_groups")
        .select("id, product_id, name, min_choices, max_choices, sort_order, translations")
        .eq("organization_id", orgId)
        .order("id")
        .range(from, to),
    ),
    readAllPages((from, to) =>
      supabase
        .from("options")
        .select("id, group_id, name, price_delta_cents, sort_order, translations")
        .eq("organization_id", orgId)
        .order("id")
        .range(from, to),
    ),
  ]);

  if (categories.error) throw new Error(`No se pudieron leer las categorías: ${categories.error.message}`);
  if (products.error) throw new Error(`No se pudieron leer los platos: ${products.error.message}`);
  if (optionGroups.error) throw new Error(`No se pudieron leer los grupos de opciones: ${optionGroups.error.message}`);
  if (options.error) throw new Error(`No se pudieron leer las opciones: ${options.error.message}`);
  // La base garantiza la forma de `translations` (CHECK), pero la carta pública no confía en ella: se lee con tolerancia.
  const withTranslations = <T extends { translations: unknown }>(rows: T[] | null) =>
    (rows ?? []).map((row) => ({ ...row, translations: parseTranslations(row.translations) }));
  return {
    categories: withTranslations(categories.data),
    products: withTranslations(products.data),
    optionGroups: withTranslations(optionGroups.data),
    options: withTranslations(options.data),
  };
}

/**
 * Categorías, platos y sus variantes/adicionales publicados de una organización, con caché (la clave lleva la versión de
 * la forma de lo cacheado: `v4` agrega las traducciones (`v3`, las etiquetas dietarias), para no leer entradas con la forma anterior). Solo se cachea esto, que cambia únicamente cuando el
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
  return unstable_cache(() => loadRows(orgId), ["carta-publica-v4", orgId], {
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
    .select("id, name, slug, menu_palette, logo_path, branches!inner(id, name, slug)")
    .eq("slug", orgSlug)
    .or(`slug.eq.${branchSlug},slug_aliases.cs.{${branchSlug}}`, { referencedTable: "branches" })
    .maybeSingle();

  if (orgError) throw new Error(`No se pudo leer la organización: ${orgError.message}`);
  const branch = org?.branches[0];
  if (!org || !branch) return unavailableOrNull(supabase, orgSlug, branchSlug);

  const [{ categories, products, optionGroups, options }, soldOut] = await Promise.all([
    readRows(org.id),
    loadSoldOutProducts(supabase, org.id, branch.id),
  ]);

  const sections = groupMenu(categories, attachOptions(products.map((product) => ({ ...product, is_available: !soldOut.has(product.id) })), optionGroups, options));
  return {
    kind: "menu",
    menu: {
      organization: {
        id: org.id, name: org.name, slug: org.slug,
        menu_palette: isPalette(org.menu_palette) ? org.menu_palette : "oliva",
        logo_path: org.logo_path,
      },
      branch: { id: branch.id, name: branch.name, slug: branch.slug },
      sections,
      languages: offeredLanguages(sections),
    },
  };
});

/**
 * Una organización suspendida y una sucursal desactivada quedan ocultas (RLS), así que desde la consulta principal
 * se ven igual que una inexistente. Solo en ese camino se pregunta el estado público.
 */
async function unavailableOrNull(
  supabase: ReturnType<typeof createPublicClient>,
  orgSlug: string,
  branchSlug: string,
): Promise<PublicMenuResult> {
  // La función exige que la sucursal exista: una inventada sigue siendo 404 aunque la cuenta esté suspendida.
  const status = await supabase.rpc("public_menu_status", { p_org_slug: orgSlug, p_branch_slug: branchSlug });
  if (status.error) throw new Error(`No se pudo leer el estado de la carta: ${status.error.message}`);
  const reason: UnavailableReason | null =
    status.data === "suspended" ? "suspended" : status.data === "inactive" ? "branch_inactive" : null;
  if (!reason) return null;

  const org = await supabase.from("organizations").select("name").eq("slug", orgSlug).maybeSingle();
  if (org.error) throw new Error(`No se pudo leer la organización: ${org.error.message}`);
  return org.data ? { kind: "unavailable", organizationName: org.data.name, reason } : null;
}

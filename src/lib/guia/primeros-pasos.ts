import type { SupabaseClient } from "@supabase/supabase-js";
import type { Entitlements, Role } from "@/lib/entitlements";
import { readAllByKey } from "@/lib/paginar";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Guía de primeros pasos del Resumen (ficha alta-guiada-del-dueno). No guarda estado: el avance se DEDUCE de los datos
 * reales del local (categorías, platos, mesas), leídos con la sesión de la persona (RLS) y filtrados por su organización.
 * `buildGuide` es una función pura: se prueba en `primeros-pasos.test.ts`.
 */

type Db = SupabaseClient<Database>;

export type GuideCounts = {
  categories: number;
  /** Platos que el público ve hoy: activos y dentro de una categoría activa. */
  visibleProducts: number;
  visibleWithoutPhoto: number;
  tables: number;
  activeTables: number;
  /** Sucursales con al menos una mesa activa (la hoja de QR es por sucursal). */
  branchIdsWithActiveTables: string[];
  /** Mesas activas por sucursal (solo las sucursales activas con alguna mesa activa). */
  activeTablesByBranch: Record<string, number>;
};

/** Una sucursal activa del local, para el resumen por sucursal. */
export type GuideBranch = { id: string; name: string };

export type GuideStepId = "carta" | "mesas" | "qr";
/**
 * `done`: hecho según los datos. `todo`: falta y se puede hacer ahora. `waiting`: depende de un paso anterior.
 * `paused`: falta, pero la cuenta no deja escribir hoy. Nunca solo color: cada estado tiene su texto.
 */
export type GuideStepStatus = "done" | "todo" | "waiting" | "paused";

export type GuideStep = {
  id: GuideStepId;
  title: string;
  detail: string;
  status: GuideStepStatus;
  /** Enlace de la acción (ausente si no se puede hacer hoy). */
  href?: string;
  cta?: string;
};

export type GuideLink = { href: string; label: string };

export type Guide =
  | {
      kind: "steps";
      /** Qué impide escribir hoy, si algo lo impide (se muestra una sola vez sobre la lista). */
      blockedNotice: string | null;
      steps: GuideStep[];
    }
  | {
      kind: "ready";
      summary: string;
      /** Sugerencias opcionales que no impiden dar la guía por completa. */
      hints: string[];
      links: GuideLink[];
    };

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/**
 * Con varias sucursales, cuántas mesas activas tiene cada una («Centro: 4 mesas · Norte: sin mesas activas»). Con una sola no
 * hace falta. Las mesas son por sucursal (la carta es central, ADR 0035), así que el avance de cada una se ve acá.
 */
function branchSummary(branches: readonly GuideBranch[], counts: GuideCounts): string | null {
  if (branches.length < 2) return null;
  const parts = branches.map((branch) => {
    const n = counts.activeTablesByBranch[branch.id] ?? 0;
    return `${branch.name}: ${n === 0 ? "sin mesas activas" : plural(n, "mesa activa", "mesas activas")}`;
  });
  return `Por sucursal: ${parts.join(" · ")}.`;
}

/** Por qué la guía no ofrece acciones de escritura (o `null`). Sin dato del plan falla cerrado. El Staff nunca recibe plan ni fechas. */
function blockedNotice(ent: Entitlements | null, role: Role): string | null {
  if (!ent) return "No pudimos comprobar el estado de la cuenta, así que por ahora no podemos ofrecerte acciones.";
  if (ent.canWrite) return null;
  const estado = ent.state === "suspended" ? "suspendida" : "en solo lectura";
  const quien = role === "owner" ? "Regularizá el pago desde Suscripción para seguir." : "Avisale al dueño para regularizar el pago.";
  return `La cuenta está ${estado}: por ahora no se puede cargar la carta ni agregar mesas. ${quien}`;
}

/**
 * Arma la guía. Devuelve `null` si el local no tiene sucursales (no hay dónde poner mesas: el Resumen ya lo avisa).
 * La hoja de QR es por sucursal: con una sola sucursal con mesas se enlaza directo; si no, a la pantalla de mesas.
 */
export function buildGuide(input: {
  counts: GuideCounts;
  branchCount: number;
  /** Las sucursales activas con su nombre; con más de una, la guía muestra el avance de cada una. */
  branches?: readonly GuideBranch[];
  ent: Entitlements | null;
  role: Role;
  slug: string;
}): Guide | null {
  const { counts, branchCount, ent, role, slug } = input;
  const branches = input.branches ?? [];
  const perBranch = branchSummary(branches, counts);
  if (branchCount === 0) return null;

  const base = `/panel/${slug}`;
  const canWrite = ent?.canWrite === true;
  const cartaDone = counts.visibleProducts > 0;
  const mesasDone = counts.activeTables > 0;

  const printHref =
    counts.branchIdsWithActiveTables.length === 1 ? `${base}/mesas/imprimir/${counts.branchIdsWithActiveTables[0]}` : `${base}/mesas`;

  if (cartaDone && mesasDone) {
    const hints: string[] = [];
    if (counts.visibleWithoutPhoto > 0) {
      hints.push(
        `${plural(counts.visibleWithoutPhoto, "plato sin foto", "platos sin foto")}: una foto ayuda a elegir. Sumala desde la carta.`,
      );
    }
    // Con varias sucursales, avisa de las que todavía no tienen mesas (sin QR, sus clientes no pueden llamar ni ver el feed).
    if (branches.length > 1) {
      for (const branch of branches) {
        if ((counts.activeTablesByBranch[branch.id] ?? 0) === 0) hints.push(`La sucursal «${branch.name}» todavía no tiene mesas activas, así que no tiene QR.`);
      }
    }
    const links: GuideLink[] = [
      { href: printHref, label: "Imprimir los QR" },
      { href: `${base}/carta`, label: "Ver la carta en el panel" },
    ];
    // El llamado al mozo es de los planes que lo incluyen (Básico no) y la sala solo funciona con la cuenta al día: la guía no lo ofrece donde no aplica.
    if (canWrite && ent?.features.includes("waiter_call")) links.push({ href: `/sala/${slug}/mesas`, label: "Atender llamados en Sala en vivo" });
    return {
      kind: "ready",
      summary: `Tu local está listo: ${plural(counts.visibleProducts, "plato", "platos")} en la carta y ${plural(counts.activeTables, "mesa activa", "mesas activas")} con su QR.${perBranch ? ` ${perBranch}` : ""}`,
      hints,
      links,
    };
  }

  const pending: GuideStepStatus = canWrite ? "todo" : "paused";
  const action = (href: string, cta: string) => (canWrite ? { href, cta } : {});

  const carta: GuideStep = cartaDone
    ? {
        id: "carta",
        title: "Cargá tu carta",
        detail: `${plural(counts.visibleProducts, "plato se ve", "platos se ven")} en tu carta.`,
        status: "done",
        href: `${base}/carta`,
        cta: "Ver la carta",
      }
    : {
        id: "carta",
        title: "Cargá tu carta",
        detail:
          counts.categories === 0
            ? "Creá una categoría (por ejemplo, Entradas) y agregale tus platos con su precio."
            : `Ya tenés ${plural(counts.categories, "categoría", "categorías")}, pero ningún plato visible. Agregá platos activos en una categoría activa.`,
        status: pending,
        ...action(`${base}/carta`, counts.categories === 0 ? "Crear la primera categoría" : "Agregar platos"),
      };

  const mesas: GuideStep = mesasDone
    ? {
        id: "mesas",
        title: "Agregá tus mesas",
        detail: `${plural(counts.activeTables, "mesa activa", "mesas activas")}, cada una con su propio QR.${perBranch ? ` ${perBranch}` : ""}`,
        status: "done",
        href: `${base}/mesas`,
        cta: "Ver las mesas",
      }
    : {
        id: "mesas",
        title: "Agregá tus mesas",
        detail:
          counts.tables === 0
            ? `Cada mesa tiene su propio QR. Agregá una por cada mesa de tu salón${branches.length > 1 ? " (cada sucursal tiene las suyas)" : ""}.`
            : "Tus mesas están todas inactivas. Activá al menos una para que tenga QR.",
        status: pending,
        ...action(`${base}/mesas`, counts.tables === 0 ? "Agregar la primera mesa" : "Activar mesas"),
      };

  // Imprimir se puede aun con la cuenta en solo lectura o suspendida (ficha mesas-y-qr): no depende de `canWrite`.
  const qr: GuideStep = mesasDone
    ? {
        id: "qr",
        title: "Imprimí los QR",
        detail: "Imprimí la hoja con una tarjeta por mesa y pegala en cada una. Probá un QR con tu teléfono.",
        status: "todo",
        href: printHref,
        cta: "Imprimir los QR",
      }
    : {
        id: "qr",
        title: "Imprimí los QR",
        detail: "Se habilita cuando tengas al menos una mesa activa.",
        status: "waiting",
      };

  return { kind: "steps", blockedNotice: blockedNotice(ent, role), steps: [carta, mesas, qr] };
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/**
 * Cuenta lo que el local ya cargó. Todas las consultas filtran por `organization_id` además de RLS: así la guía de un
 * local nunca suma datos de otro, ni siquiera para una persona que pertenece a dos (prueba E2E «dos locales»).
 */
export async function loadGuideCounts(db: Db, orgId: string): Promise<GuideCounts> {
  const visible = () =>
    db
      .from("products")
      .select("id, categories!inner(is_active)", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .eq("categories.is_active", true);

  const [categories, products, withoutPhoto, tables, branches] = await Promise.all([
    db.from("categories").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
    visible(),
    visible().is("image_path", null),
    // Las mesas inactivas no tienen tope: se leen por páginas (PostgREST corta en 1000 sin avisar).
    readAllByKey((after, limit) => {
      const query = db.from("tables").select("id, branch_id, is_active").eq("organization_id", orgId);
      return (after ? query.gt("id", after) : query).order("id").limit(limit);
    }),
    readAllByKey((after, limit) => {
      const query = db.from("branches").select("id").eq("organization_id", orgId).eq("is_active", true);
      return (after ? query.gt("id", after) : query).order("id").limit(limit);
    }),
  ]);
  if (categories.error) throw new Error(`No se pudo leer el avance del local: ${categories.error.message}`);
  if (products.error) throw new Error(`No se pudo leer el avance del local: ${products.error.message}`);
  if (withoutPhoto.error) throw new Error(`No se pudo leer el avance del local: ${withoutPhoto.error.message}`);
  if (tables.error) throw new Error(`No se pudo leer el avance del local: ${tables.error.message}`);
  if (branches.error) throw new Error(`No se pudo leer el avance del local: ${branches.error.message}`);

  // Las mesas de una sucursal desactivada no cuentan para la guía: su carta no está publicada.
  const activeBranchIds = new Set((branches.data ?? []).map((branch) => branch.id));
  const ofActiveBranches = (tables.data ?? []).filter((table) => activeBranchIds.has(table.branch_id));
  const active = ofActiveBranches.filter((table) => table.is_active);
  return {
    categories: categories.count ?? 0,
    visibleProducts: products.count ?? 0,
    visibleWithoutPhoto: withoutPhoto.count ?? 0,
    tables: ofActiveBranches.length,
    activeTables: active.length,
    branchIdsWithActiveTables: [...new Set(active.map((table) => table.branch_id))],
    activeTablesByBranch: active.reduce<Record<string, number>>((byBranch, table) => {
      byBranch[table.branch_id] = (byBranch[table.branch_id] ?? 0) + 1;
      return byBranch;
    }, {}),
  };
}

// ---------------------------------------------------------------------------
// Ocultar la guía (preferencia de cada persona; ficha guia-descartable)
// ---------------------------------------------------------------------------

/**
 * ¿Ocultó quien llama la guía de este local? Es una preferencia: ante un error de la base se muestra la guía (falla abierto, no
 * esconde ayuda por una falla pasajera).
 */
export async function readGuideDismissed(db: Db, orgId: string): Promise<boolean> {
  const { data, error } = await db.rpc("my_guide_dismissed", { p_org: orgId });
  return !error && data === true;
}

/** Oculta (`true`) o vuelve a mostrar (`false`) la guía de quien llama. `false` si la base la rechaza o falla. */
export async function setGuideDismissed(db: Db, orgId: string, dismissed: boolean): Promise<boolean> {
  const { data, error } = await db.rpc("set_my_guide_dismissed", { p_org: orgId, p_dismissed: dismissed });
  return !error && data === "ok";
}

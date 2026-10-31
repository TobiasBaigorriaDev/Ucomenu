import type { Metadata } from "next";
import { headers } from "next/headers";
import { AvisoPush } from "@/components/push/aviso-push";
import { AtencionCelda, AhoraCelda, CartaCelda, HoyCelda, HoyNoIncluida } from "@/components/resumen/bloques";
import { PrimerosPasos } from "@/components/panel/primeros-pasos";
import { SonidoControl } from "@/components/panel/sonido-control";
import { getEntitlements, requireMembership } from "@/lib/auth/session";
import { analyticsTimeZone } from "@/lib/analitica/ventas";
import { buildGuide, loadGuideCounts, readGuideDismissed } from "@/lib/guia/primeros-pasos";
import { resolveBaseUrl } from "@/lib/mesas/url";
import { vapidPublicKey } from "@/lib/push/config";
import { buildAhora, type AhoraView } from "@/lib/resumen/ahora";
import { buildAttention, loadPendingComments, loadSoldOutProducts } from "@/lib/resumen/atencion";
import { loadHoy } from "@/lib/resumen/cargar";
import type { HoyView } from "@/lib/resumen/hoy";
import { loadPendingReservations } from "@/lib/reservas/cargar";
import { loadMesas } from "@/lib/sala/mesas-loader";
import { createSessionClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Resumen" };

const RESOURCE_LABEL: Record<string, string> = {
  active_products: "Platos activos",
  branches: "Sucursales",
};

/** Una lectura que falla no tira el Resumen: ese bloque dice que no pudo leer y los demás se muestran. */
async function settle<T>(read: () => Promise<T>): Promise<T | "error"> {
  try {
    return await read();
  } catch {
    return "error";
  }
}

/**
 * Resumen del panel (ficha resumen-del-panel): lo primero que ve el Dueño o el Personal. De arriba abajo: la guía de primeros pasos
 * mientras esté incompleta, el salón ahora (quien ya ve Mesas), las ventas del día (solo el Dueño con analítica), lo que espera
 * atención y la carta pública para compartir; al pie, el uso del plan (Dueño) y la guía ya completa u oculta. Todo se lee con la
 * sesión de la persona (RLS) y cada bloque falla por separado.
 */
export default async function PanelHomePage({ params }: PageProps<"/panel/[org]">) {
  const { org } = await params;
  const { membership } = await requireMembership(org, `/panel/${org}`);
  const orgId = membership.org.id;

  const supabase = await createSessionClient();
  const [branches, ent, counts, guideDismissed] = await Promise.all([
    supabase.from("branches").select("id, slug, name, is_active, timezone").eq("organization_id", orgId).order("name"),
    getEntitlements(orgId),
    loadGuideCounts(supabase, orgId),
    readGuideDismissed(supabase, orgId),
  ]);

  const isOwner = membership.role === "owner";
  // Las desactivadas no publican carta: el Resumen enlaza solo las activas y avisa si no queda ninguna.
  const activeBranches = (branches.data ?? []).filter((branch) => branch.is_active);
  const allInactive = activeBranches.length === 0 && (branches.data?.length ?? 0) > 0;
  const guide = buildGuide({
    counts,
    branchCount: activeBranches.length,
    branches: activeBranches.map((branch) => ({ id: branch.id, name: branch.name })),
    ent,
    role: membership.role,
    slug: membership.org.slug,
  });

  const features = ent?.features ?? [];
  // Cada bloque se lee solo si le corresponde a la persona y al plan (la base vuelve a comprobarlo y devuelve nada si no).
  const wantsAhora = features.includes("orders");
  const wantsHoy = isOwner && features.includes("analytics");
  const wantsComments = features.includes("video_feed");
  const wantsReservations = features.includes("reservations");
  const [mesas, hoy, pendingComments, soldOut, pendingReservations] = await Promise.all([
    wantsAhora ? settle(() => loadMesas(supabase, orgId)) : Promise.resolve(null),
    wantsHoy ? settle(() => loadHoy(supabase, orgId)) : Promise.resolve(null),
    wantsComments ? loadPendingComments(supabase, orgId) : Promise.resolve(null),
    loadSoldOutProducts(supabase, orgId),
    wantsReservations ? loadPendingReservations(supabase, orgId) : Promise.resolve(null),
  ]);

  const ahora: AhoraView | "error" | null = mesas === null ? null : mesas === "error" ? "error" : buildAhora(mesas);
  // Un local sin mesas activas todavía no tiene salón que mirar: la guía ya lo explica.
  const showAhora = ahora === "error" || (ahora !== null && (ahora.tablesTotal > 0 || ahora.pendingCalls > 0));
  const hoyView: HoyView | null = hoy === "error" ? null : hoy;

  // Solo el Dueño ve el plan (el Personal nunca recibe límites ni uso). Un recurso sin tope se muestra «sin tope» y no genera aviso.
  const usageRows =
    isOwner && ent
      ? Object.keys(RESOURCE_LABEL).map((key) => ({ label: RESOURCE_LABEL[key], used: ent.usage[key] ?? 0, limit: ent.limits[key] ?? null }))
      : null;
  const attention = buildAttention({
    slug: membership.org.slug,
    pendingReservations,
    pendingComments,
    soldOutProducts: soldOut,
    usage: usageRows?.flatMap((row) => (row.limit === null ? [] : [{ label: row.label, used: row.used, limit: row.limit }])) ?? null,
  });

  const timeZone = analyticsTimeZone(branches.data ?? [], null);
  const now = new Date();
  const today = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone }).format(now);
  const weekday = new Intl.DateTimeFormat("es-AR", { weekday: "long", timeZone }).format(now);
  const base = resolveBaseUrl(await headers());

  const guideFirst = guide?.kind === "steps" && !guideDismissed;
  const guideBlock = guide ? <PrimerosPasos guide={guide} slug={membership.org.slug} dismissed={guideDismissed} /> : null;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:px-10 lg:py-12">
      <h1 className="font-display text-4xl leading-tight">Resumen</h1>
      <p className="mt-2 text-base text-muted" data-testid="resumen-fecha">
        {today.charAt(0).toUpperCase() + today.slice(1)}
      </p>

      {guideFirst ? guideBlock : null}

      <div className="mt-6 grid gap-4">
        {showAhora ? <AhoraCelda view={ahora as AhoraView | "error"} slug={membership.org.slug} /> : null}

        {wantsHoy ? <HoyCelda view={hoyView} weekday={weekday} timeZone={timeZone} slug={membership.org.slug} now={now} /> : isOwner && ent ? <HoyNoIncluida slug={membership.org.slug} /> : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <AtencionCelda items={attention} />
          <CartaCelda
            branches={activeBranches.map((branch) => ({ id: branch.id, name: branch.name, slug: branch.slug }))}
            allInactive={allInactive}
            isOwner={isOwner}
            slug={membership.org.slug}
            localName={membership.org.name}
            base={base}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2 lg:items-start [&>*:only-child]:lg:col-span-2">
          {usageRows ? (
            <section aria-labelledby="uso" className="rounded-3xl bg-sand p-5 ring-1 ring-inset ring-ink/15 sm:p-6">
              <h2 id="uso" className="font-display text-2xl">
                Uso del plan
              </h2>
              <ul className="mt-3 divide-y divide-ink/15 border-t border-ink/15">
                {usageRows.map((resource) => (
                  <li key={resource.label} className="flex items-baseline gap-3 py-3 text-lg">
                    <span>{resource.label}</span>
                    <span aria-hidden className="leader" />
                    <span className="font-medium tabular-nums">{resource.limit === null ? `${resource.used}, sin tope` : `${resource.used} de ${resource.limit}`}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {/* Solo con el plan que incluye el llamado (la función de base rechazaría el alta igual) y con claves VAPID en el servidor. */}
          {features.includes("waiter_call") ? (
            <div data-testid="resumen-avisos">
              <SonidoControl />
              <AvisoPush slug={membership.org.slug} publicKey={vapidPublicKey()} where="panel" />
            </div>
          ) : null}
        </div>
        {/* El `mt-8` propio de la guía sobra acá: el espacio lo da la grilla. */}
        {!guideFirst && guideBlock ? <div className="[&>*]:!mt-0">{guideBlock}</div> : null}
      </div>
    </main>
  );
}

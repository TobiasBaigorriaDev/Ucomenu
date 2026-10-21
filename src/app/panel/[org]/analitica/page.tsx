import type { Metadata } from "next";
import Link from "next/link";
import { HoursChart } from "@/components/analitica/hours-chart";
import { getEntitlements, requireOwner } from "@/lib/auth/session";
import { loadAnalytics } from "@/lib/analitica/cargar";
import {
  ANALYTICS_DAYS,
  barPercent,
  callsOf,
  hourRange,
  peakHours,
  plural,
  totalCalls,
  type DishViews,
  type HourCalls,
} from "@/lib/analitica/lectura";
import { readBranchView } from "@/lib/sucursales/vista";
import { createSessionClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Analítica" };

/**
 * Analítica básica del local (ficha analitica-basica, ADR 0022): platos más vistos y llamados por hora de los últimos 14
 * días. Solo el Dueño y solo con el plan que incluye `analytics`; la base vuelve a comprobarlo y, si no corresponde, no
 * entrega ni una fila. Los gráficos son barras de CSS con una tabla equivalente para lectores de pantalla.
 */
export default async function AnalyticsPage({ params, searchParams }: PageProps<"/panel/[org]/analitica">) {
  const { org } = await params;
  const { membership } = await requireOwner(org, `/panel/${org}/analitica`);
  const ent = await getEntitlements(membership.org.id);
  const hasAnalytics = ent?.features.includes("analytics") === true;

  const db = await createSessionClient();
  const branches = (await db.from("branches").select("id, slug, name").eq("organization_id", membership.org.id).eq("is_active", true).order("name")).data ?? [];
  const requested = (await searchParams).sucursal;
  // Sin `?sucursal=`, abre en la sucursal que la persona eligió en la sala si es exactamente una; `?sucursal=todas` fuerza «Todas».
  let branch = typeof requested === "string" ? branches.find((item) => item.slug === requested) ?? null : null;
  if (requested === undefined && branches.length > 1) {
    const view = await readBranchView(db, membership.org.id);
    if (view.length === 1) branch = branches.find((item) => item.id === view[0]) ?? null;
  }
  const base = `/panel/${membership.org.slug}/analitica`;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:px-10 lg:py-12">
      <h1 className="font-display text-4xl leading-tight">Analítica</h1>
      <p className="mt-2 max-w-prose text-base text-muted">
        Qué platos se miran más y a qué horas llaman las mesas, en los últimos {ANALYTICS_DAYS} días.
      </p>

      {!ent ? (
        <p role="status" className="mt-6 max-w-prose text-base text-muted" data-testid="analitica-sin-estado">
          No pudimos comprobar el estado de la cuenta. Probá de nuevo en unos minutos.
        </p>
      ) : !hasAnalytics ? (
        <p className="panel-cell mt-6 max-w-prose text-base" data-testid="analitica-no-incluida">
          La analítica está incluida desde el plan Pro. Para sumarla, contactá a UcoMenu: podés ver tu plan en{" "}
          <Link href={`/panel/${membership.org.slug}/suscripcion`} className="font-medium underline underline-offset-4">
            Suscripción
          </Link>
          .
        </p>
      ) : (
        <Content orgId={membership.org.id} branchId={branch?.id ?? null} branches={branches} current={branch?.slug ?? null} base={base} />
      )}
    </main>
  );
}

async function Content({
  orgId,
  branchId,
  branches,
  current,
  base,
}: {
  orgId: string;
  branchId: string | null;
  branches: { id: string; slug: string; name: string }[];
  current: string | null;
  base: string;
}) {
  const { dishes, calls } = await loadAnalytics(await createSessionClient(), orgId, branchId);

  return (
    <>
      {branches.length > 1 ? (
        <nav aria-label="Filtrar por sucursal" className="mt-6 flex flex-wrap gap-2" data-testid="analitica-sucursales">
          {[{ slug: null as string | null, name: "Todas las sucursales" }, ...branches].map((item) => {
            const active = item.slug === current;
            return (
              <Link
                key={item.slug ?? "todas"}
                href={`${base}?sucursal=${item.slug ?? "todas"}`}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-full px-4 text-base font-medium ${
                  active ? "bg-brand text-white" : "border border-ink/50 text-ink hover:bg-ink/5"
                }`}
              >
                {item.name}
              </Link>
            );
          })}
        </nav>
      ) : null}

      <TopDishesSection dishes={dishes?.dishes ?? null} total={dishes?.total ?? 0} failed={dishes === null} />
      <CallsSection hours={calls} />
    </>
  );
}

function TopDishesSection({ dishes, total, failed }: { dishes: DishViews[] | null; total: number; failed: boolean }) {
  const max = Math.max(0, ...(dishes ?? []).map((dish) => dish.views));
  return (
    <section aria-labelledby="platos-titulo" className="mt-10" data-testid="top-platos">
      <h2 id="platos-titulo" className="font-display text-3xl leading-tight">
        Platos más vistos
      </h2>
      {failed ? (
        <p role="status" className="mt-3 max-w-prose text-base text-muted" data-testid="platos-error">
          No pudimos leer esta sección. Probá de nuevo en unos minutos.
        </p>
      ) : !dishes || dishes.length === 0 ? (
        <p className="mt-3 max-w-prose text-base text-muted" data-testid="platos-vacio">
          Todavía no hay vistas para mostrar. Se cuenta cada vez que alguien abre el detalle de un plato en tu carta.
        </p>
      ) : (
        <>
          <p className="mt-1 text-base text-muted" data-testid="platos-total">
            {plural(total, "vista", "vistas")} en los últimos {ANALYTICS_DAYS} días, en total.
          </p>
          <ol className="mt-4 panel-list" data-testid="platos-lista">
            {dishes.map((dish, index) => (
              <li key={dish.id} className="border-b border-ink/15 py-3" data-testid="plato-fila" data-nombre={dish.name}>
                <div className="flex items-baseline gap-3">
                  <span className="w-6 shrink-0 text-right text-base text-muted tabular-nums">{index + 1}</span>
                  <span className="min-w-0 flex-1 text-lg break-words">
                    {dish.name}
                    {dish.active ? null : <span className="ml-2 text-sm text-muted">(desactivado)</span>}
                  </span>
                  <span className="shrink-0 text-lg font-medium tabular-nums">{dish.views}</span>
                </div>
                <div aria-hidden className="mt-2 ml-9 h-2 rounded-full bg-ink/10">
                  <div className="h-2 rounded-full bg-brand" style={{ width: `${barPercent(dish.views, max)}%` }} />
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function CallsSection({ hours }: { hours: HourCalls[] | null }) {
  const total = hours ? totalCalls(hours) : 0;
  const peaks = hours ? peakHours(hours) : [];
  return (
    <section aria-labelledby="horas-titulo" className="mt-12" data-testid="llamados-horas">
      <h2 id="horas-titulo" className="font-display text-3xl leading-tight">
        Llamados por hora
      </h2>
      {hours === null ? (
        <p role="status" className="mt-3 max-w-prose text-base text-muted" data-testid="horas-error">
          No pudimos leer esta sección. Probá de nuevo en unos minutos.
        </p>
      ) : total === 0 ? (
        <p className="mt-3 max-w-prose text-base text-muted" data-testid="horas-vacio">
          Todavía no hubo llamados en los últimos {ANALYTICS_DAYS} días.
        </p>
      ) : (
        <>
          <p className="mt-1 text-base text-muted" data-testid="horas-total">
            {plural(total, "llamado", "llamados")} en los últimos {ANALYTICS_DAYS} días. Horario de Argentina.
          </p>
          <p className="mt-3 text-lg" data-testid="hora-pico">
            {peaks.length === 1 ? "Hora pico: " : "Horas pico: "}
            <strong className="font-medium">{peaks.map((peak) => hourRange(peak.hour)).join(" y ")}</strong> ({plural(callsOf(peaks[0]), "llamado", "llamados")}
            {peaks.length > 1 ? " cada una" : ""})
          </p>

          <HoursChart hours={hours} />

          {/* Un `div` oculto (NO la tabla con `sr-only`): una tabla ignora el recorte y sus filas, ubicadas fuera del marco, estiraban la página con un hueco en blanco abajo. */}
          <div className="sr-only">
          <table data-testid="tabla-horas">
            <caption>Llamados por hora del día, últimos {ANALYTICS_DAYS} días</caption>
            <thead>
              <tr>
                <th scope="col">Hora</th>
                <th scope="col">Llaman al mozo</th>
                <th scope="col">Piden la cuenta</th>
              </tr>
            </thead>
            <tbody>
              {hours.map((hour) => (
                <tr key={hour.hour}>
                  <th scope="row">{hourRange(hour.hour)}</th>
                  <td>{hour.waiter}</td>
                  <td>{hour.bill}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </section>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "@/components/panel/styles";
import { getEntitlements, requireMembership } from "@/lib/auth/session";
import { formatArs } from "@/lib/money";
import { promocionesBlockNotice } from "@/lib/promociones/mensajes";
import { instantAt, wallClock } from "@/lib/promociones/precio";
import { loadPromotionsScreen, previewPrices, type CatalogView, type PreviewRow, type PromotionView } from "@/lib/promociones/promociones";
import { datesLabel, daysLabel, discountLabel, formatClock, parseClock, parseDate, windowLabel } from "@/lib/promociones/reglas";
import { createSessionClient } from "@/lib/supabase/server";
import { DeleteForm, DuplicateForm, ToggleActiveForm } from "./promotion-controls";

export const metadata: Metadata = { title: "Promociones" };

const listFormat = new Intl.ListFormat("es-AR", { style: "long", type: "conjunction" });
const badgeClass = "inline-flex items-center rounded-full border border-ink/25 bg-sand px-2.5 py-0.5 text-sm text-ink";
const AVISOS: Record<string, string> = { creada: "Promoción creada.", guardada: "Cambios guardados." };

/** Hasta cuántos nombres se listan antes de «y N más». */
const SHOWN_NAMES = 4;

function namesSummary(names: string[]): string {
  if (names.length <= SHOWN_NAMES) return listFormat.format(names);
  return `${names.slice(0, SHOWN_NAMES).join(", ")} y ${names.length - SHOWN_NAMES} más`;
}

function scopeOf(promotion: PromotionView, catalog: CatalogView): { targets: string; branches: string } {
  const categoryName = new Map(catalog.categories.map((c) => [c.id, c.name]));
  const productName = new Map(catalog.products.map((p) => [p.id, p.name]));
  const categories = promotion.categoryIds.map((id) => `todo «${categoryName.get(id) ?? "categoría"}»`);
  const products = promotion.productIds.map((id) => productName.get(id) ?? "plato");
  const targets = [...categories, ...products];
  const branchName = new Map(catalog.branches.map((b) => [b.id, b.name]));
  const branches = promotion.allBranches ? "Todas las sucursales" : namesSummary(promotion.branchIds.map((id) => branchName.get(id) ?? "sucursal"));
  return { targets: targets.length > 0 ? namesSummary(targets) : "Sin platos ni categorías: no aplica a nada", branches: branches || "Ninguna sucursal: no aplica a nada" };
}

/** `?sucursal=&fecha=&hora=` de la vista previa; vacío = ahora en la primera sucursal. */
async function buildPreview(
  searchParams: Record<string, string | string[] | undefined>,
  catalog: CatalogView,
  orgId: string,
): Promise<{ branchSlug: string; date: string; time: string; rows: PreviewRow[] | null; error: string | null } | null> {
  const one = (key: string) => (typeof searchParams[key] === "string" ? (searchParams[key] as string) : "");
  const branch = catalog.branches.find((b) => b.slug === one("sucursal")) ?? catalog.branches[0];
  if (!branch) return null;
  const now = wallClock(new Date(), branch.timeZone);
  const date = parseDate(one("fecha")) ?? now.date;
  const minute = parseClock(one("hora")) ?? now.minute;
  const requested = one("fecha") !== "" || one("hora") !== "" || one("sucursal") !== "";
  const base = { branchSlug: branch.slug, date, time: formatClock(minute) };
  if (!requested) return { ...base, rows: null, error: null };
  try {
    const db = await createSessionClient();
    return { ...base, rows: await previewPrices(db, orgId, branch.id, instantAt(date, minute, branch.timeZone)), error: null };
  } catch {
    return { ...base, rows: null, error: "No pudimos calcular la vista previa. Probá de nuevo en unos minutos." };
  }
}

/** Dueño y Staff leen; solo el Dueño cambia (la base lo impone). Se abre aunque la cuenta esté en solo lectura. */
export default async function PromocionesPage({ params, searchParams }: PageProps<"/panel/[org]/promociones">) {
  const { org } = await params;
  const query = await searchParams;
  const { membership } = await requireMembership(org, `/panel/${org}/promociones`);
  const db = await createSessionClient();
  const [screen, ent] = await Promise.all([loadPromotionsScreen(db, membership.org.id), getEntitlements(membership.org.id)]);
  const isOwner = membership.role === "owner";
  const notice = promocionesBlockNotice(ent);
  // Falla cerrado: sin poder leer el estado de la cuenta se muestra pero no se edita.
  const canWrite = isOwner && notice === null;
  const preview = await buildPreview(query, screen.catalog, membership.org.id);
  const aviso = typeof query.aviso === "string" ? AVISOS[query.aviso] : undefined;
  const base = `/panel/${membership.org.slug}/promociones`;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:px-10 lg:py-12">
      <h1 className="font-display text-4xl leading-tight">Promociones</h1>
      <p className="mt-2 max-w-prose text-base text-muted">
        Descuentos que se aplican solos por día y horario (Happy hour, almuerzo ejecutivo…). La carta muestra el precio anterior tachado, el
        promocional y hasta cuándo rige. Si dos promociones alcanzan al mismo plato, gana la que lo deja más barato; no se suman.
      </p>
      {aviso ? (
        <p role="status" className="mt-3 text-base font-medium" data-testid="promociones-aviso">
          {aviso}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-3 max-w-prose text-base font-medium" data-testid="promociones-bloqueadas">
          {notice}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {isOwner ? (
          canWrite ? (
            <Link href={`${base}/nueva`} className={primaryButtonClass}>
              Nueva promoción
            </Link>
          ) : null
        ) : (
          <p className="text-base text-muted">Solo el Dueño puede crear o cambiar promociones.</p>
        )}
        <Link href={`${base}/historial`} className={secondaryButtonClass}>
          Historial de promociones
        </Link>
      </div>

      <section aria-labelledby="lista" className="panel-cell mt-6">
        <h2 id="lista" className="font-display text-2xl">
          Tus promociones
        </h2>
        {screen.promotions.length === 0 ? (
          <p className="mt-3 max-w-prose text-base text-muted" data-testid="promociones-vacio">
            Todavía no hay promociones.
          </p>
        ) : (
          <ul className="mt-3 panel-list">
            {screen.promotions.map((promotion) => {
              const scope = scopeOf(promotion, screen.catalog);
              const others = screen.overlaps.get(promotion.id);
              const dates = datesLabel(promotion.startsOn, promotion.endsOn);
              return (
                <li key={promotion.id} className="border-b border-ink/15 py-4" data-testid="promocion" data-name={promotion.name} data-active={promotion.isActive ? "true" : "false"}>
                  <p className="text-lg font-medium break-words">
                    {promotion.name}{" "}
                    <span className={badgeClass} data-testid="promocion-estado">
                      {promotion.isActive ? "Activa" : "Pausada"}
                    </span>
                  </p>
                  <p className="mt-1 text-base">{discountLabel(promotion.discountType, promotion.discountValue)}</p>
                  <p className="mt-1 text-base text-muted">
                    {daysLabel(promotion.weekdaysMask)} · {windowLabel(promotion.startMinute, promotion.endMinute)}
                    {dates ? ` · ${dates}` : ""}
                  </p>
                  <p className="mt-1 text-base text-muted break-words">Alcanza a: {scope.targets}</p>
                  <p className="mt-1 text-base text-muted break-words">Sucursales: {scope.branches}</p>
                  {others ? (
                    <p className="mt-2 max-w-prose text-base font-medium" data-testid="promocion-superposicion">
                      Se superpone con {listFormat.format(others.map((name) => `«${name}»`))}: donde coinciden, cada plato se vende al menor precio.
                    </p>
                  ) : null}
                  {isOwner ? (
                    <div className="mt-3 flex flex-wrap items-start gap-2">
                      {canWrite ? (
                        <Link href={`${base}/${promotion.id}`} className={secondaryButtonClass} aria-label={`Editar ${promotion.name}`}>
                          Editar
                        </Link>
                      ) : null}
                      <ToggleActiveForm orgSlug={membership.org.slug} id={promotion.id} name={promotion.name} isActive={promotion.isActive} canWrite={canWrite} />
                      <DuplicateForm orgSlug={membership.org.slug} id={promotion.id} name={promotion.name} canWrite={canWrite} />
                      <DeleteForm orgSlug={membership.org.slug} id={promotion.id} name={promotion.name} canWrite={canWrite} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {preview ? (
        <section aria-labelledby="vista-previa" className="panel-cell mt-6">
          <h2 id="vista-previa" className="font-display text-2xl">
            Vista previa por día y hora
          </h2>
          <p className="mt-2 max-w-prose text-base text-muted">
            Mirá qué platos tendrían promoción y a qué precio en una sucursal, un día y una hora. La hora es la de la sucursal. Es el mismo cálculo
            que usa la carta.
          </p>
          <form method="get" className="mt-4 grid max-w-2xl gap-4 sm:grid-cols-3" data-testid="vista-previa-form">
            <div>
              <label htmlFor="vp-sucursal" className={labelClass}>
                Sucursal
              </label>
              <select id="vp-sucursal" name="sucursal" defaultValue={preview.branchSlug} className={`${inputClass} mt-1`}>
                {screen.catalog.branches.map((branch) => (
                  <option key={branch.id} value={branch.slug}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="vp-fecha" className={labelClass}>
                Día
              </label>
              <input id="vp-fecha" name="fecha" type="date" defaultValue={preview.date} className={`${inputClass} mt-1`} />
            </div>
            <div>
              <label htmlFor="vp-hora" className={labelClass}>
                Hora
              </label>
              <input id="vp-hora" name="hora" type="time" defaultValue={preview.time} className={`${inputClass} mt-1`} />
            </div>
            <div className="sm:col-span-3">
              <button type="submit" className={secondaryButtonClass}>
                Ver precios
              </button>
            </div>
          </form>
          {preview.error ? (
            <p role="alert" className="mt-4 text-base font-medium text-danger">
              {preview.error}
            </p>
          ) : preview.rows === null ? null : preview.rows.length === 0 ? (
            <p className="mt-4 text-base text-muted" data-testid="vista-previa-vacia">
              A esa hora ningún plato tiene promoción en esa sucursal.
            </p>
          ) : (
            <ul className="mt-4 panel-list" data-testid="vista-previa-lista">
              {preview.rows.map((row) => (
                <li key={row.productId} className="border-b border-ink/15 py-3" data-testid="vista-previa-fila">
                  <p className="text-base font-medium break-words">{row.productName}</p>
                  <p className="text-base">
                    <span className="text-muted line-through">{formatArs(row.basePriceCents)}</span> <span className="font-medium">{formatArs(row.priceCents)}</span>{" "}
                    <span className="text-muted">· {row.promotionName}</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </main>
  );
}

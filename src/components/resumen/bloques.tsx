import Link from "next/link";
import { primaryButtonClass, secondaryButtonClass } from "@/components/panel/styles";
import { changeLabel, dayLabel } from "@/lib/analitica/ventas";
import { formatArs } from "@/lib/money";
import type { AhoraView } from "@/lib/resumen/ahora";
import type { AttentionItem } from "@/lib/resumen/atencion";
import { barHeight, type HoyView } from "@/lib/resumen/hoy";
import { CopiarEnlace } from "./copiar-enlace";

/**
 * Bloques del Resumen del panel (ficha resumen-del-panel, DESIGN.md «Celdas del Resumen»). Son de servidor y solo dibujan lo que
 * `src/lib/resumen/` ya calculó. Colores solo desde los roles de la paleta; sin sombras; cifras en `tabular-nums`; el estado
 * siempre en texto (nunca solo color ni solo forma).
 */

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

const READ_ERROR = "No pudimos leer esta sección. Probá de nuevo en unos minutos.";

function Arrow() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Ahora
// ---------------------------------------------------------------------------------------------------------------------

function Stat({ id, label, value, note, hot = false, wide = false, money = false }: { id: string; label: string; value: string; note?: string; hot?: boolean; wide?: boolean; money?: boolean }) {
  return (
    <div className={`min-w-0 rounded-2xl p-4 ${wide ? "col-span-2 sm:col-span-1" : ""} ${hot ? "bg-brand text-white" : ""}`} data-testid={`ahora-${id}`} data-activo={hot ? "si" : "no"}>
      <dt className={`text-sm font-medium ${hot ? "text-white" : "text-muted"}`}>{label}</dt>
      <dd className="mt-1">
        <span className={`block font-display leading-none tabular-nums ${money ? "text-4xl whitespace-nowrap" : "text-5xl"}`} data-testid={`ahora-${id}-valor`}>
          {value}
        </span>
        {note ? <span className={`mt-2 block text-sm ${hot ? "text-white" : "text-muted"}`}>{note}</span> : null}
      </dd>
    </div>
  );
}

/** El salón en este momento. `view === "error"`: la lectura falló y los demás bloques siguen. */
export function AhoraCelda({ view, slug }: { view: AhoraView | "error"; slug: string }) {
  return (
    <section aria-labelledby="ahora-titulo" className="panel-cell sm:!p-6" data-testid="resumen-ahora">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="ahora-titulo" className="font-display text-2xl">
          Ahora en el salón
        </h2>
        <Link href={`/sala/${slug}/mesas`} className={primaryButtonClass}>
          Abrir Sala en vivo
        </Link>
      </div>
      {view === "error" ? (
        <p role="status" className="mt-3 max-w-prose text-base text-muted" data-testid="ahora-error">
          {READ_ERROR}
        </p>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-1 sm:grid-cols-[1fr_1fr_1fr_1.5fr]">
            <Stat
              id="llamados"
              label="Llamados pendientes"
              value={String(view.pendingCalls)}
              note={view.pendingCalls === 0 ? "Ninguna mesa espera" : `${view.waiterCalls} al mozo · ${view.billCalls} piden la cuenta`}
              hot={view.pendingCalls > 0}
              wide
            />
            <Stat id="mesas" label="Mesas con pedido" value={String(view.tablesWithOrder)} note={`de ${plural(view.tablesTotal, "mesa activa", "mesas activas")}`} />
            <Stat id="cocina" label="Platos en cocina" value={String(view.inKitchen)} note={view.ready > 0 ? `${plural(view.ready, "listo para llevar", "listos para llevar")}` : "Ninguno listo todavía"} />
            <Stat id="abierto" label="Por cobrar" value={formatArs(view.openCents)} note="en pedidos sin cerrar" wide money />
          </dl>
          {view.othersPending > 0 ? (
            <p className="mt-3 max-w-prose text-sm text-muted" data-testid="ahora-otras">
              {plural(view.othersPending, "llamado pendiente", "llamados pendientes")} en sucursales que no estás mirando.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Hoy
// ---------------------------------------------------------------------------------------------------------------------

/** «▲ +12 % frente al viernes pasado» / «Igual que el viernes pasado» (`versus` lleva su preposición: «al viernes…», «a la semana…»). La flecha es decoración: el signo y el texto dicen lo mismo. */
function Delta({ percent, same, versus }: { percent: number; same: string; versus: string }) {
  return (
    <>
      <span aria-hidden>{percent > 0 ? "▲ " : percent < 0 ? "▼ " : ""}</span>
      {percent === 0 ? `Igual que ${same}` : `${changeLabel(percent)} frente ${versus}`}
    </>
  );
}

/**
 * Ventas del día (solo el Dueño con analítica). Izquierda: la cifra de hoy y lo más pedido; derecha: los últimos 7 días. Las barras
 * son decorativas (`aria-hidden`); cada día lleva su texto equivalente. `weekday` es el día de la semana de hoy en la zona del local.
 */
export function HoyCelda({ view, weekday, timeZone, slug, now }: { view: HoyView | null; weekday: string; timeZone: string; slug: string; now?: Date }) {
  if (view === null) {
    return (
      <section aria-labelledby="hoy-titulo" className="panel-cell sm:!p-6" data-testid="resumen-hoy">
        <h2 id="hoy-titulo" className="font-display text-2xl">
          Ventas
        </h2>
        <p role="status" className="mt-3 max-w-prose text-base text-muted" data-testid="hoy-error">
          {READ_ERROR}
        </p>
      </section>
    );
  }
  if (!view.hasOrders) {
    return (
      <section aria-labelledby="hoy-titulo" className="panel-cell sm:!p-6" data-testid="resumen-hoy">
        <h2 id="hoy-titulo" className="font-display text-2xl">
          Ventas
        </h2>
        <p className="mt-3 max-w-prose text-base text-muted" data-testid="hoy-vacio">
          Todavía no hay pedidos cerrados en las últimas dos semanas. Las ventas se cuentan cuando tu equipo cierra una mesa desde la Sala.
        </p>
      </section>
    );
  }

  const lastWeekday = `el ${weekday} pasado`;
  const max = Math.max(...view.bars.map((bar) => bar.cents));
  return (
    <div className="grid gap-4 lg:grid-cols-[3fr_2fr] lg:items-stretch" data-testid="resumen-hoy">
      <section aria-labelledby="hoy-titulo" className="rounded-3xl bg-brand p-5 text-white sm:p-6">
        <h2 id="hoy-titulo" className="font-display text-2xl">
          Ventas de hoy
        </h2>
        {view.todayOrders === 0 ? (
          <p className="mt-3 font-display text-4xl leading-tight sm:text-5xl" data-testid="hoy-valor">
            Todavía sin ventas
          </p>
        ) : (
          <p className="mt-3 font-display text-5xl leading-none tabular-nums break-words sm:text-6xl" data-testid="hoy-valor">
            {formatArs(view.todayCents)}
          </p>
        )}
        <p className="mt-3 max-w-prose text-lg" data-testid="hoy-cambio">
          {view.todayOrders === 0 ? (
            view.sameWeekdayOrders > 0 ? (
              <>
                {capitalize(lastWeekday)} se vendieron <span className="tabular-nums">{formatArs(view.sameWeekdayCents)}</span> en el día.
              </>
            ) : (
              `Aparecen cuando tu equipo cierra una mesa.`
            )
          ) : view.vsSameWeekday === null ? (
            `${capitalize(lastWeekday)} no hubo ventas para comparar.`
          ) : (
            <Delta percent={view.vsSameWeekday} same={lastWeekday} versus={`al ${weekday} pasado`} />
          )}
        </p>
        <p className="mt-1 text-base text-white">
          {plural(view.todayOrders, "pedido cerrado", "pedidos cerrados")} hoy
          {view.weekTicketCents !== null ? (
            <>
              {" · "}ticket promedio de la semana <span className="tabular-nums">{formatArs(view.weekTicketCents)}</span>
            </>
          ) : null}
        </p>

        {view.dishes.length > 0 ? (
          <div className="mt-5 border-t border-white/25 pt-4" data-testid="hoy-platos">
            <h3 className="text-base font-medium">Lo más pedido esta semana</h3>
            <ol className="mt-2 divide-y divide-white/25">
              {view.dishes.map((dish, index) => (
                <li key={`${index}-${dish.name}`} className="flex items-baseline gap-3 py-2 text-lg">
                  <span className="w-5 shrink-0 text-base tabular-nums">{index + 1}</span>
                  <span className="min-w-0 font-medium break-words">{dish.name}</span>
                  <span aria-hidden className="leader" />
                  <span className="shrink-0 text-base tabular-nums">{plural(dish.units, "pedido", "pedidos")}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="semana-titulo" className="rounded-3xl bg-sand p-5 ring-1 ring-inset ring-ink/15 sm:p-6" data-testid="resumen-semana">
        <h2 id="semana-titulo" className="font-display text-2xl">
          Últimos 7 días
        </h2>
        <p className="mt-2 font-display text-4xl leading-none tabular-nums break-words" data-testid="semana-valor">
          {formatArs(view.weekCents)}
        </p>
        <p className="mt-1 text-base text-ink/80" data-testid="semana-cambio">
          {plural(view.weekOrders, "pedido cerrado", "pedidos cerrados")}
          {view.weekVsPrevious !== null ? (
            <>
              {" · "}
              <Delta percent={view.weekVsPrevious} same="la semana anterior" versus="a la semana anterior" />
            </>
          ) : null}
        </p>
        <ol className="mt-5 flex h-32 items-end gap-2" data-testid="semana-barras" aria-label="Ventas de cada uno de los últimos 7 días">
          {view.bars.map((bar) => {
            const label = dayLabel(bar.daysAgo, timeZone, now);
            const today = bar.daysAgo === 0;
            return (
              <li key={bar.daysAgo} className="flex h-full min-w-0 flex-1 flex-col justify-end" data-testid="semana-dia" data-dias-atras={bar.daysAgo}>
                <span className="sr-only">
                  {label}: {bar.orders === 0 ? "sin ventas" : `${formatArs(bar.cents)}, ${plural(bar.orders, "pedido", "pedidos")}`}
                </span>
                <span
                  aria-hidden
                  className={bar.cents === 0 ? EMPTY_DAY : today ? TODAY_BAR : PAST_BAR}
                  style={{ height: `${barHeight(bar.cents, max)}%` }}
                />
              </li>
            );
          })}
        </ol>
        <ol aria-hidden className="mt-2 flex gap-2 text-center text-sm text-ink/80">
          {view.bars.map((bar) => (
            <li key={bar.daysAgo} className={`min-w-0 flex-1 ${bar.daysAgo === 0 ? "font-medium text-ink" : ""}`}>
              {bar.daysAgo === 0 ? "hoy" : dayLabel(bar.daysAgo, timeZone, now).split(" ")[0]}
            </li>
          ))}
        </ol>
        <p className="mt-4">
          <Link href={`/panel/${slug}/analitica`} className="inline-flex min-h-11 items-center gap-2 text-base font-medium underline underline-offset-4">
            Ver la analítica completa
            <Arrow />
          </Link>
        </p>
      </section>
    </div>
  );
}

/** Barras de la semana: un día sin ventas es una marca recta en la base; uno con ventas, una barra de esquinas superiores redondeadas. */
const EMPTY_DAY = "block w-full h-0 border-b-2 border-ink/25";
const TODAY_BAR = "block w-full rounded-t-lg bg-brand";
const PAST_BAR = "block w-full rounded-t-lg bg-brand/45";

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Para el Dueño sin el plan que incluye la analítica: dice qué se pierde, sin esconder el bloque. */
export function HoyNoIncluida({ slug }: { slug: string }) {
  return (
    <section aria-labelledby="hoy-titulo" className="panel-cell sm:!p-6" data-testid="resumen-hoy-no-incluida">
      <h2 id="hoy-titulo" className="font-display text-2xl">
        Ventas
      </h2>
      <p className="mt-3 max-w-prose text-base">
        Las ventas del día, la comparación con la semana pasada y los platos más pedidos vienen con el plan Pro.{" "}
        <Link href={`/panel/${slug}/suscripcion`} className="font-medium underline underline-offset-4">
          Ver tu plan
        </Link>
        .
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Para atender
// ---------------------------------------------------------------------------------------------------------------------

/** Pendientes que esperan a una persona. Sin ninguno, lo dice (un bloque vacío parecería roto). */
export function AtencionCelda({ items }: { items: AttentionItem[] }) {
  return (
    <section aria-labelledby="atencion-titulo" className="panel-cell sm:!p-6" data-testid="resumen-atencion">
      <h2 id="atencion-titulo" className="font-display text-2xl">
        Para atender
      </h2>
      {items.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 text-lg" data-testid="atencion-vacio">
          <svg aria-hidden viewBox="0 0 24 24" className="size-5 shrink-0 text-brand" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
          Todo al día. No hay nada esperándote.
        </p>
      ) : (
        <ul className="mt-3 panel-list" data-testid="atencion-lista">
          {items.map((item) => (
            <li key={item.id + item.href} className="flex flex-wrap items-center justify-between gap-3 border-b border-ink/15 py-3 last:border-b-0" data-testid="atencion-item" data-item={item.id}>
              <p className="min-w-0 flex-1 basis-56 text-base">{item.text}</p>
              <Link href={item.href} className={secondaryButtonClass}>
                {item.cta}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Tu carta
// ---------------------------------------------------------------------------------------------------------------------

export type CartaBranch = { id: string; name: string; slug: string };

/** WhatsApp con el texto ya escrito: `wa.me` abre la app o WhatsApp Web sin pedir nada. */
export function whatsappHref(localName: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`Mirá la carta de ${localName}: ${url}`)}`;
}

/**
 * La carta pública de cada sucursal activa, con lo que el Dueño hace con ella: verla, copiar el enlace y compartirlo. `base` es el
 * origen público (`null` si no se pudo determinar con seguridad: queda solo «Ver la carta»). Sin sucursales activas conserva los
 * avisos de siempre.
 */
export function CartaCelda({
  branches,
  allInactive,
  isOwner,
  slug,
  localName,
  base,
}: {
  branches: CartaBranch[];
  allInactive: boolean;
  isOwner: boolean;
  slug: string;
  localName: string;
  base: string | null;
}) {
  return (
    <section aria-labelledby="carta-publica" className="rounded-3xl bg-blush p-5 text-ink sm:p-6" data-testid="resumen-carta">
      <h2 id="carta-publica" className="font-display text-2xl">
        Tu carta pública
      </h2>
      {branches.length > 0 ? (
        <ul className="mt-3 divide-y divide-ink/20 border-t border-ink/20">
          {branches.map((branch) => {
            const path = `/m/${slug}/${branch.slug}`;
            const url = base ? `${base}${path}` : null;
            return (
              <li key={branch.id} className="py-4" data-testid="carta-sucursal">
                <p className="text-lg font-medium break-words">{branch.name}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Link href={path} className={primaryButtonClass} aria-label={`Ver la carta de ${branch.name}`}>
                    Ver la carta
                  </Link>
                  {url ? (
                    <>
                      <CopiarEnlace url={url} branchName={branch.name} />
                      <a
                        href={whatsappHref(localName, url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={secondaryButtonClass}
                        aria-label={`Compartir por WhatsApp la carta de ${branch.name}`}
                      >
                        Compartir por WhatsApp
                      </a>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <>
          <p className="mt-3 max-w-prose" data-testid="resumen-sin-sucursales-activas">
            {allInactive ? "Todas las sucursales están desactivadas: la carta pública no está disponible." : "Este local todavía no tiene sucursales."}
          </p>
          {isOwner ? (
            <Link href={`/panel/${slug}/sucursales`} className={`mt-3 ${primaryButtonClass}`}>
              {allInactive ? "Reactivar una sucursal" : "Crear la primera sucursal"}
            </Link>
          ) : null}
        </>
      )}
    </section>
  );
}

import { BarsChart, type Bar } from "@/components/analitica/bars-chart";
import { Heatmap } from "@/components/analitica/heatmap";
import { barPercent, plural } from "@/lib/analitica/lectura";
import {
  averageTicket,
  busiestWeekday,
  changeLabel,
  dayLabel,
  hourSpan,
  minutesLabel,
  percentChange,
  roundToPesos,
  sharePercent,
  topSlots,
  WEEKDAYS,
  type Products,
  type Reason,
  type Sales,
} from "@/lib/analitica/ventas";
import { formatArs } from "@/lib/money";

/** Secciones de la analítica de pedidos (ficha analitica-de-pedidos). Son de servidor: la base ya entregó solo lo que el Dueño puede ver. */

export function SectionError({ id, testId }: { id: string; testId: string }) {
  return (
    <p role="status" id={id} className="mt-3 max-w-prose text-base text-muted" data-testid={testId}>
      No pudimos leer esta sección. Probá de nuevo en unos minutos.
    </p>
  );
}

const Title = ({ id, children }: { id: string; children: React.ReactNode }) => (
  <h2 id={id} className="font-display text-3xl leading-tight">
    {children}
  </h2>
);

/** ¿Hubo algo que mostrar de pedidos en el período o en el anterior? */
export const hasOrderData = (sales: Sales) =>
  sales.current.orders + sales.previous.orders + sales.current.voidedOrders + sales.current.cancelledUnits > 0;

// ---------------------------------------------------------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------------------------------------------------------

function Kpi({ id, label, value, percent, days = 0, note }: { id: string; label: string; value: string; percent?: number | null; days?: number; note?: string }) {
  return (
    <div className="panel-cell" data-testid={`kpi-${id}`}>
      <p className="text-sm font-medium text-muted">{label}</p>
      <p className="mt-1 text-2xl leading-tight font-medium tabular-nums break-words sm:text-3xl" data-testid={`kpi-${id}-valor`}>
        {value}
      </p>
      {percent === undefined ? (
        note ? <p className="mt-1 text-sm text-muted">{note}</p> : null
      ) : (
        <p className="mt-1 text-sm text-muted" data-testid={`kpi-${id}-cambio`} data-cambio={percent ?? "sin-datos"}>
          {percent === null ? (
            <>Sin datos de los {days} días anteriores</>
          ) : (
            <>
              <span aria-hidden>{percent > 0 ? "▲ " : percent < 0 ? "▼ " : ""}</span>
              {changeLabel(percent)} frente a los {days} días anteriores
            </>
          )}
        </p>
      )}
    </div>
  );
}

export function SummarySection({ sales }: { sales: Sales | null }) {
  return (
    <section aria-labelledby="resumen-titulo" className="mt-10" data-testid="resumen">
      <Title id="resumen-titulo">Resumen</Title>
      {sales === null ? (
        <SectionError id="resumen-error" testId="resumen-error" />
      ) : !hasOrderData(sales) ? (
        <p className="mt-3 max-w-prose text-base text-muted" data-testid="resumen-vacio">
          Todavía no hay pedidos cerrados en los últimos {sales.days} días. Se cuentan cuando tu equipo cierra una mesa desde la Sala.
        </p>
      ) : (
        <>
          <p className="mt-1 max-w-prose text-base text-muted">
            Últimos {sales.days} días, frente a los {sales.days} anteriores. Las ventas son las que anotó tu equipo en los pedidos cerrados: no incluyen propinas, descuentos al cobrar ni medios de pago.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Kpi id="ventas" label="Ventas anotadas" value={formatArs(sales.current.revenueCents)} percent={percentChange(sales.current.revenueCents, sales.previous.revenueCents)} days={sales.days} />
            <Kpi id="pedidos" label="Pedidos cerrados" value={String(sales.current.orders)} percent={percentChange(sales.current.orders, sales.previous.orders)} days={sales.days} />
            <Kpi
              id="ticket"
              label="Ticket promedio"
              value={averageTicket(sales.current) === null ? "—" : formatArs(averageTicket(sales.current)!)}
              percent={percentChange(averageTicket(sales.current), averageTicket(sales.previous))}
              days={sales.days}
            />
            <Kpi id="unidades" label="Platos vendidos" value={String(sales.current.units)} percent={percentChange(sales.current.units, sales.previous.units)} days={sales.days} />
            <Kpi
              id="tiempo"
              label="Tiempo típico en la mesa"
              value={sales.current.medianMinutes === null ? "—" : minutesLabel(sales.current.medianMinutes)}
              note="Desde que se abre el pedido hasta que se cierra (la mitad de las mesas, menos)."
            />
            <Kpi
              id="promos"
              label="Descuento por promociones"
              value={formatArs(sales.current.promoDiscountCents)}
              note={sales.current.promoDiscountCents === 0 ? "Ninguna promoción se aplicó en pedidos." : "Lo que se dejó de cobrar por precios promocionales."}
            />
          </div>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Ventas por día
// ---------------------------------------------------------------------------------------------------------------------

export function DailySalesSection({ sales, timeZone, now }: { sales: Sales; timeZone: string; now?: Date }) {
  const total = sales.byDay.reduce((sum, day) => sum + day.revenueCents, 0);
  const best = sales.byDay.reduce((a, b) => (b.revenueCents > a.revenueCents ? b : a), sales.byDay[0]);
  const bars: Bar[] = sales.byDay.map((day) => {
    const label = dayLabel(day.daysAgo, timeZone, now);
    const long = dayLabel(day.daysAgo, timeZone, now, true);
    return {
      key: String(day.daysAgo),
      value: day.revenueCents,
      label: `${label}: ${day.orders === 0 ? "sin ventas" : `${formatArs(day.revenueCents)}, ${plural(day.orders, "pedido", "pedidos")}`}`,
      lines: day.orders === 0 ? [long, "Sin ventas"] : [long, formatArs(day.revenueCents), plural(day.orders, "pedido cerrado", "pedidos cerrados")],
    };
  });
  const middle = sales.byDay[Math.floor((sales.byDay.length - 1) / 2)];
  return (
    <section aria-labelledby="dias-titulo" className="mt-12" data-testid="ventas-por-dia">
      <Title id="dias-titulo">Ventas por día</Title>
      <p className="mt-1 text-base text-muted" data-testid="dias-resumen">
        {formatArs(total)} en {sales.days} días, {formatArs(roundToPesos(total / sales.days))} por día en promedio.
        {best.revenueCents > 0 ? (
          <>
            {" "}
            Mejor día: <strong className="font-medium text-ink">{dayLabel(best.daysAgo, timeZone, now, true)}</strong> ({formatArs(best.revenueCents)}).
          </>
        ) : null}
      </p>
      <BarsChart
        bars={bars}
        groupLabel="Ventas de cada día. Con las flechas recorrés los días."
        testId="grafico-dias"
        axis={[dayLabel(sales.byDay[0].daysAgo, timeZone, now), dayLabel(middle.daysAgo, timeZone, now), "hoy"]}
        hint="Pasá el cursor o tocá una barra para ver el día y lo vendido."
      />
      {/* Un `div` oculto (NO la tabla con `sr-only`): una tabla ignora el recorte y estiraba la página con un hueco en blanco abajo. */}
      <div className="sr-only">
        <table data-testid="tabla-dias">
          <caption>Ventas por día, últimos {sales.days} días</caption>
          <thead>
            <tr>
              <th scope="col">Día</th>
              <th scope="col">Pedidos</th>
              <th scope="col">Ventas</th>
            </tr>
          </thead>
          <tbody>
            {sales.byDay.map((day) => (
              <tr key={day.daysAgo}>
                <th scope="row">{dayLabel(day.daysAgo, timeZone, now, true)}</th>
                <td>{day.orders}</td>
                <td>{formatArs(day.revenueCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Franjas
// ---------------------------------------------------------------------------------------------------------------------

export function SlotsSection({ sales }: { sales: Sales }) {
  const tops = topSlots(sales.slots, 3);
  const day = busiestWeekday(sales.slots);
  return (
    <section aria-labelledby="franjas-titulo" className="mt-12" data-testid="franjas">
      <Title id="franjas-titulo">Cuándo se llena el local</Title>
      <p className="mt-1 max-w-prose text-base text-muted">
        Pedidos por día de la semana y hora en que se abrieron, en el horario de cada sucursal. Sirve para armar turnos y promociones.
      </p>
      {day ? (
        <p className="mt-3 text-lg" data-testid="franjas-dia">
          Día más fuerte: <strong className="font-medium">{WEEKDAYS[day.dow - 1]}</strong> ({plural(day.orders, "pedido", "pedidos")}).
        </p>
      ) : null}
      {tops.length > 0 ? (
        <ol className="mt-2 list-decimal pl-6 text-base" data-testid="franjas-top">
          {tops.map((slot) => (
            <li key={`${slot.dow}-${slot.hour}`}>
              {WEEKDAYS[slot.dow - 1]}, {hourSpan(slot.hour)}: {plural(slot.orders, "pedido", "pedidos")}, {formatArs(slot.revenueCents)}
            </li>
          ))}
        </ol>
      ) : null}
      <Heatmap slots={sales.slots} />
      <div className="sr-only">
        <table data-testid="tabla-franjas">
          <caption>Pedidos por día de la semana y hora de apertura</caption>
          <thead>
            <tr>
              <th scope="col">Día</th>
              {Array.from({ length: 24 }, (_, hour) => (
                <th key={hour} scope="col">
                  {hourSpan(hour)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sales.slots.map((row, index) => (
              <tr key={index}>
                <th scope="row">{WEEKDAYS[index]}</th>
                {row.map((cell, hour) => (
                  <td key={hour}>{cell.orders}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Platos
// ---------------------------------------------------------------------------------------------------------------------

export function BestProductsSection({ products, days }: { products: Products | null; days: number }) {
  const max = Math.max(0, ...(products?.best ?? []).map((item) => item.revenueCents));
  return (
    <section aria-labelledby="vendidos-titulo" className="mt-12" data-testid="platos-vendidos">
      <Title id="vendidos-titulo">Platos que más venden</Title>
      {products === null ? (
        <SectionError id="vendidos-error" testId="vendidos-error" />
      ) : products.best.length === 0 ? (
        <p className="mt-3 max-w-prose text-base text-muted" data-testid="vendidos-vacio">
          Todavía no hay platos vendidos en los últimos {days} días.
        </p>
      ) : (
        <>
          <p className="mt-1 text-base text-muted">Ordenados por lo que sumaron en los últimos {days} días. Al lado, cuántas veces se miró cada uno en la carta.</p>
          <ol className="mt-4 panel-list" data-testid="vendidos-lista">
            {products.best.map((item, index) => (
              <li key={item.id ?? item.name} className="border-b border-ink/15 py-3" data-testid="vendido-fila" data-nombre={item.name}>
                <div className="flex items-baseline gap-3">
                  <span className="w-6 shrink-0 text-right text-base text-muted tabular-nums">{index + 1}</span>
                  <span className="min-w-0 flex-1 text-lg break-words">
                    {item.name}
                    {!item.inCatalog ? <span className="ml-2 text-sm text-muted">(ya no está en la carta)</span> : !item.active ? <span className="ml-2 text-sm text-muted">(desactivado)</span> : null}
                  </span>
                  <span className="shrink-0 text-lg font-medium tabular-nums">{formatArs(item.revenueCents)}</span>
                </div>
                <div aria-hidden className="mt-2 ml-9 h-2 rounded-full bg-ink/10">
                  <div className="h-2 rounded-full bg-brand" style={{ width: `${barPercent(item.revenueCents, max)}%` }} />
                </div>
                <p className="mt-1 ml-9 text-sm text-muted">
                  {plural(item.units, "unidad", "unidades")} · {plural(item.views, "vista", "vistas")}
                  {item.category ? <> · {item.category}</> : null}
                </p>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

export function CategoriesSection({ sales }: { sales: Sales }) {
  const total = sales.categories.reduce((sum, item) => sum + item.revenueCents, 0);
  return (
    <section aria-labelledby="categorias-titulo" className="mt-12" data-testid="ventas-por-categoria">
      <Title id="categorias-titulo">Ventas por categoría</Title>
      {sales.categories.length === 0 ? (
        <p className="mt-3 max-w-prose text-base text-muted" data-testid="categorias-vacio">
          Todavía no hay ventas para repartir por categoría.
        </p>
      ) : (
        <ol className="mt-4 panel-list" data-testid="categorias-lista">
          {sales.categories.map((item) => {
            const share = sharePercent(item.revenueCents, total);
            return (
              <li key={item.id ?? "sin-categoria"} className="border-b border-ink/15 py-3" data-testid="categoria-fila" data-nombre={item.name ?? "Sin categoría"}>
                <div className="flex items-baseline gap-3">
                  <span className="min-w-0 flex-1 text-lg break-words">{item.name ?? "Sin categoría (plato borrado)"}</span>
                  <span className="shrink-0 text-lg font-medium tabular-nums">{formatArs(item.revenueCents)}</span>
                </div>
                <div aria-hidden className="mt-2 h-2 rounded-full bg-ink/10">
                  <div className="h-2 rounded-full bg-terra" style={{ width: `${barPercent(item.revenueCents, total)}%` }} />
                </div>
                <p className="mt-1 text-sm text-muted">
                  {share} % de las ventas · {plural(item.units, "unidad", "unidades")}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function UnsoldSection({ products, days }: { products: Products | null; days: number }) {
  return (
    <section aria-labelledby="sinpedidos-titulo" className="mt-12" data-testid="platos-sin-pedidos">
      <Title id="sinpedidos-titulo">Platos sin pedidos</Title>
      {products === null ? (
        <SectionError id="sinpedidos-error" testId="sinpedidos-error" />
      ) : products.unsoldTotal === 0 ? (
        <p className="mt-3 max-w-prose text-base text-muted" data-testid="sinpedidos-vacio">
          Todos los platos publicados de tu carta tuvieron pedidos en los últimos {days} días.
        </p>
      ) : (
        <>
          <p className="mt-1 max-w-prose text-base text-muted" data-testid="sinpedidos-total">
            {plural(products.unsoldTotal, "plato publicado no tuvo", "platos publicados no tuvieron")} pedidos en los últimos {days} días. Primero los que más se miran: si se miran y no se piden, quizás haya que revisar su foto, su precio o su descripción.
          </p>
          <ul className="mt-4 panel-list" data-testid="sinpedidos-lista">
            {products.unsold.map((item) => (
              <li key={item.id} className="flex items-baseline gap-3 border-b border-ink/15 py-3" data-testid="sinpedidos-fila" data-nombre={item.name}>
                <span className="min-w-0 flex-1 text-lg break-words">
                  {item.name}
                  {item.category ? <span className="ml-2 text-sm text-muted">{item.category}</span> : null}
                </span>
                <span className="shrink-0 text-base tabular-nums text-muted">{item.views === 0 ? "sin vistas" : plural(item.views, "vista", "vistas")}</span>
              </li>
            ))}
          </ul>
          {products.unsoldTotal > products.unsold.length ? (
            <p className="mt-2 text-sm text-muted">Se muestran {products.unsold.length} de {products.unsoldTotal}.</p>
          ) : null}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Control
// ---------------------------------------------------------------------------------------------------------------------

function ReasonList({ id, reasons, unit }: { id: string; reasons: Reason[]; unit: [string, string] }) {
  return (
    <ul className="mt-2 panel-list" data-testid={id}>
      {reasons.map((item) => (
        <li key={item.reason} className="flex items-baseline gap-3 border-b border-ink/15 py-2">
          <span className="min-w-0 flex-1 text-base break-words">{item.reason === "" ? "Sin motivo" : item.reason}</span>
          <span className="shrink-0 text-base tabular-nums text-muted">
            {plural(item.count, unit[0], unit[1])} · {formatArs(item.cents)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ControlSection({ sales }: { sales: Sales }) {
  const { voidedOrders, voidedCents, cancelledUnits, cancelledCents } = sales.current;
  return (
    <section aria-labelledby="control-titulo" className="mt-12" data-testid="control">
      <Title id="control-titulo">Anulaciones y cancelaciones</Title>
      {voidedOrders === 0 && cancelledUnits === 0 ? (
        <p className="mt-3 max-w-prose text-base text-muted" data-testid="control-vacio">
          No hubo pedidos anulados ni platos cancelados en los últimos {sales.days} días.
        </p>
      ) : (
        <>
          <p className="mt-1 max-w-prose text-base text-muted">Lo anotado que no llegó a venderse. Sirve para detectar errores de carga o platos que se agotan.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="panel-cell" data-testid="control-anulados">
              <p className="text-sm font-medium text-muted">Pedidos anulados</p>
              <p className="mt-1 text-2xl font-medium tabular-nums sm:text-3xl">{voidedOrders}</p>
              <p className="mt-1 text-sm text-muted">{voidedOrders === 0 ? "Ninguno en el período." : `Tenían anotado ${formatArs(voidedCents)}.`}</p>
              {sales.voidReasons.length > 0 ? <ReasonList id="motivos-anulados" reasons={sales.voidReasons} unit={["pedido", "pedidos"]} /> : null}
            </div>
            <div className="panel-cell" data-testid="control-cancelados">
              <p className="text-sm font-medium text-muted">Platos cancelados</p>
              <p className="mt-1 text-2xl font-medium tabular-nums sm:text-3xl">{cancelledUnits}</p>
              <p className="mt-1 text-sm text-muted">{cancelledUnits === 0 ? "Ninguno en el período." : `Por ${formatArs(cancelledCents)}, en pedidos que sí se cerraron.`}</p>
              {sales.cancelReasons.length > 0 ? <ReasonList id="motivos-cancelados" reasons={sales.cancelReasons} unit={["plato", "platos"]} /> : null}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

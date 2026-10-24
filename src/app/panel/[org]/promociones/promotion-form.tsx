"use client";

import { useMemo, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { inputClass, labelClass } from "@/components/panel/styles";
import { priceToInput } from "@/lib/carta/price";
import type { CatalogView, PromotionView } from "@/lib/promociones/promociones";
import type { DiscountType } from "@/lib/promociones/precio";
import { DISCOUNT_TYPE_LABEL, DISCOUNT_TYPES, PROMOTION_NAME_MAX, WEEKDAYS, WEEKDAY_NAME, daysOf, formatClock } from "@/lib/promociones/reglas";
import { savePromotionAction } from "./actions";

/** Lo que muestra el formulario: la promoción que se edita, o lo que la persona escribió antes de un error. */
type Draft = {
  name: string;
  type: string;
  value: string;
  days: string[];
  allDay: boolean;
  from: string;
  to: string;
  startsOn: string;
  endsOn: string;
  allBranches: boolean;
  branches: string[];
  products: string[];
  categories: string[];
  active: boolean;
};

function draftFrom(initial: PromotionView | undefined, raw: string | undefined): Draft {
  if (raw) {
    try {
      const d = JSON.parse(raw) as Record<string, unknown>;
      const list = (value: unknown) => (Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : []);
      const str = (value: unknown) => (typeof value === "string" ? value : "");
      return {
        name: str(d.name),
        type: str(d.type) || "percent",
        value: str(d.value),
        days: list(d.days),
        allDay: d.allDay === "on",
        from: str(d.from) || "18:00",
        to: str(d.to) || "20:00",
        startsOn: str(d.startsOn),
        endsOn: str(d.endsOn),
        allBranches: d.allBranches !== "false",
        branches: list(d.branches),
        products: list(d.products),
        categories: list(d.categories),
        active: d.active !== "false",
      };
    } catch {
      // Un borrador ilegible se ignora: el formulario vuelve a su estado inicial.
    }
  }
  if (!initial) {
    return {
      name: "",
      type: "percent",
      value: "",
      days: ["1", "2", "3", "4", "5"],
      allDay: false,
      from: "18:00",
      to: "20:00",
      startsOn: "",
      endsOn: "",
      allBranches: true,
      branches: [],
      products: [],
      categories: [],
      active: true,
    };
  }
  const allDay = initial.startMinute === 0 && initial.endMinute === 1440;
  return {
    name: initial.name,
    type: initial.discountType,
    value: initial.discountType === "percent" ? String(initial.discountValue) : priceToInput(initial.discountValue),
    days: daysOf(initial.weekdaysMask).map(String),
    allDay,
    from: formatClock(initial.startMinute),
    to: formatClock(initial.endMinute),
    startsOn: initial.startsOn ?? "",
    endsOn: initial.endsOn ?? "",
    allBranches: initial.allBranches,
    branches: initial.branchIds,
    products: initial.productIds,
    categories: initial.categoryIds,
    active: initial.isActive,
  };
}

const VALUE_HELP: Record<DiscountType, string> = {
  percent: "Un número entero de 1 a 100. Por ejemplo, 25 descuenta la cuarta parte.",
  amount: "Cuánto se descuenta del precio del plato, en pesos. Por ejemplo, 500.",
  fixed_price: "El precio al que se vende mientras dure la promoción, en pesos. Si el plato ya cuesta eso o menos, no cambia nada.",
};

const checkboxRow = "flex min-h-11 items-center gap-3";

/**
 * Alta y edición de una promoción. Los días, las horas, los platos, las categorías y las sucursales se eligen acá; la base vuelve a
 * comprobar todo. Una franja que termina antes de empezar (22:00 a 02:00) sigue al día siguiente y pertenece al día en que empieza.
 */
export function PromotionForm({
  orgSlug,
  catalog,
  initial,
  canWrite,
}: {
  orgSlug: string;
  catalog: CatalogView;
  initial?: PromotionView;
  canWrite: boolean;
}) {
  return (
    <ActionForm action={savePromotionAction} className="mt-6 max-w-2xl">
      {(state) => <FormBody key={state.values?.draft ?? "inicial"} orgSlug={orgSlug} catalog={catalog} initial={initial} canWrite={canWrite} raw={state.values?.draft} />}
    </ActionForm>
  );
}

function FormBody({
  orgSlug,
  catalog,
  initial,
  canWrite,
  raw,
}: {
  orgSlug: string;
  catalog: CatalogView;
  initial?: PromotionView;
  canWrite: boolean;
  raw: string | undefined;
}) {
  const draft = useMemo(() => draftFrom(initial, raw), [initial, raw]);
  const [type, setType] = useState<DiscountType>(DISCOUNT_TYPES.find((t) => t === draft.type) ?? "percent");
  const [allDay, setAllDay] = useState(draft.allDay);
  const [allBranches, setAllBranches] = useState(draft.allBranches || catalog.branches.length <= 1);
  const [filter, setFilter] = useState("");

  // El filtro solo OCULTA (no desmonta): una casilla oculta sigue marcada y viaja en el envío.
  const needle = filter.trim().toLowerCase();
  const matches = (name: string) => needle === "" || name.toLowerCase().includes(needle);
  const productsByCategory = useMemo(
    () => catalog.categories.map((category) => ({ category, products: catalog.products.filter((p) => p.categoryId === category.id) })).filter((group) => group.products.length > 0),
    [catalog],
  );
  const anyMatch = catalog.products.some((p) => matches(p.name));

  return (
    <fieldset disabled={!canWrite} className="grid gap-6">
      <input type="hidden" name="org" value={orgSlug} />
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}

      <div>
        <label htmlFor="promo-nombre" className={labelClass}>
          Nombre de la promoción
        </label>
        <input
          id="promo-nombre"
          name="name"
          required
          maxLength={PROMOTION_NAME_MAX}
          autoComplete="off"
          defaultValue={draft.name}
          placeholder="Happy hour"
          className={`${inputClass} mt-1`}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="promo-tipo" className={labelClass}>
            Tipo de descuento
          </label>
          <select id="promo-tipo" name="type" value={type} onChange={(event) => setType(event.target.value as DiscountType)} className={`${inputClass} mt-1`}>
            {DISCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {DISCOUNT_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="promo-valor" className={labelClass}>
            {type === "percent" ? "Porcentaje" : type === "amount" ? "Monto a descontar ($)" : "Precio ($)"}
          </label>
          <input
            id="promo-valor"
            name="value"
            required
            inputMode={type === "percent" ? "numeric" : "decimal"}
            autoComplete="off"
            defaultValue={draft.value}
            aria-describedby="promo-valor-ayuda"
            className={`${inputClass} mt-1`}
          />
        </div>
        <p id="promo-valor-ayuda" className="text-sm text-muted sm:col-span-2">
          {VALUE_HELP[type]} El descuento se aplica al precio del plato, sin sus variantes ni adicionales, y nunca deja el precio por debajo de cero.
        </p>
      </div>

      <fieldset>
        <legend className={labelClass}>Días en que empieza</legend>
        <div className="mt-1 flex flex-wrap gap-x-5">
          {WEEKDAYS.map((day) => (
            <label key={day} className={checkboxRow}>
              <input type="checkbox" name="days" value={day} defaultChecked={draft.days.includes(String(day))} className="size-5 accent-cobalt" />
              <span className="capitalize">{WEEKDAY_NAME[day]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className={labelClass}>Horario</legend>
        <label className={checkboxRow}>
          <input
            type="checkbox"
            name="allDay"
            checked={allDay}
            onChange={(event) => setAllDay(event.target.checked)}
            className="size-5 accent-cobalt"
          />
          Todo el día
        </label>
        <div className="mt-1 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="promo-desde" className={labelClass}>
              Desde
            </label>
            <input id="promo-desde" name="from" type="time" disabled={allDay} defaultValue={draft.from} className={`${inputClass} mt-1`} />
          </div>
          <div>
            <label htmlFor="promo-hasta" className={labelClass}>
              Hasta
            </label>
            <input id="promo-hasta" name="to" type="time" disabled={allDay} defaultValue={draft.to} className={`${inputClass} mt-1`} />
          </div>
        </div>
        <p className="mt-1 text-sm text-muted">
          La hora es la de la sucursal. Si «hasta» es anterior a «desde» (por ejemplo, 22:00 a 02:00), la promoción sigue después de la
          medianoche y cuenta como del día en que empezó. «Hasta» 00:00 significa la medianoche.
        </p>
      </fieldset>

      <fieldset>
        <legend className={labelClass}>Fechas (opcional)</legend>
        <div className="mt-1 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="promo-fecha-desde" className={labelClass}>
              Desde el
            </label>
            <input id="promo-fecha-desde" name="startsOn" type="date" defaultValue={draft.startsOn} className={`${inputClass} mt-1`} />
          </div>
          <div>
            <label htmlFor="promo-fecha-hasta" className={labelClass}>
              Hasta el (inclusive)
            </label>
            <input id="promo-fecha-hasta" name="endsOn" type="date" defaultValue={draft.endsOn} className={`${inputClass} mt-1`} />
          </div>
        </div>
        <p className="mt-1 text-sm text-muted">Las fechas se miden sobre el día en que empieza cada franja. Vacío = sin límite.</p>
      </fieldset>

      {catalog.branches.length > 1 ? (
        <fieldset>
          <legend className={labelClass}>Sucursales</legend>
          <label className={checkboxRow}>
            <input type="radio" name="allBranches" value="true" checked={allBranches} onChange={() => setAllBranches(true)} className="size-5 accent-cobalt" />
            Todas las sucursales
          </label>
          <label className={checkboxRow}>
            <input type="radio" name="allBranches" value="false" checked={!allBranches} onChange={() => setAllBranches(false)} className="size-5 accent-cobalt" />
            Solo algunas
          </label>
          {allBranches ? null : (
            <div className="ml-8">
              {catalog.branches.map((branch) => (
                <label key={branch.id} className={checkboxRow}>
                  <input type="checkbox" name="branches" value={branch.id} defaultChecked={draft.branches.includes(branch.id)} className="size-5 accent-cobalt" />
                  {branch.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>
      ) : (
        <input type="hidden" name="allBranches" value="true" />
      )}

      <fieldset>
        <legend className={labelClass}>Categorías (alcanza a todos sus platos)</legend>
        {catalog.categories.length === 0 ? (
          <p className="mt-1 text-sm text-muted">Todavía no hay categorías.</p>
        ) : (
          <div className="mt-1 flex flex-wrap gap-x-5">
            {catalog.categories.map((category) => (
              <label key={category.id} className={checkboxRow}>
                <input type="checkbox" name="categories" value={category.id} defaultChecked={draft.categories.includes(category.id)} className="size-5 accent-cobalt" />
                {category.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend className={labelClass}>Platos puntuales</legend>
        <div className="mt-1">
          <label htmlFor="promo-filtro" className="sr-only">
            Buscar un plato
          </label>
          <input
            id="promo-filtro"
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Buscar un plato…"
            autoComplete="off"
            className={inputClass}
          />
        </div>
        <div className="mt-2 max-h-80 overflow-y-auto rounded-lg border border-ink/20 px-3">
          {!anyMatch ? <p className="py-3 text-sm text-muted">No hay platos que coincidan.</p> : null}
          {productsByCategory.map(({ category, products }) => (
            <div key={category.id} hidden={!products.some((p) => matches(p.name))} className="border-b border-ink/10 py-2 last:border-b-0">
              <p className="text-sm font-medium text-muted">{category.name}</p>
              {products.map((product) => (
                <label key={product.id} hidden={!matches(product.name)} className={checkboxRow}>
                  <input type="checkbox" name="products" value={product.id} defaultChecked={draft.products.includes(product.id)} className="size-5 accent-cobalt" />
                  <span className="break-words">
                    {product.name}
                    {product.isActive ? "" : " (inactivo)"}
                  </span>
                </label>
              ))}
            </div>
          ))}
        </div>
        <p className="mt-1 text-sm text-muted">Hay que elegir al menos una categoría o un plato. Buscar solo oculta los demás: los platos tildados siguen elegidos.</p>
      </fieldset>

      <div className={checkboxRow}>
        <input id="promo-activa" name="active" type="checkbox" value="true" defaultChecked={draft.active} className="size-5 accent-cobalt" />
        <label htmlFor="promo-activa" className="text-base">
          Activa (si la desactivás queda pausada: no se aplica pero se conserva)
        </label>
      </div>

      <div>
        <SubmitButton pendingLabel="Guardando…">{initial ? "Guardar cambios" : "Crear promoción"}</SubmitButton>
      </div>
    </fieldset>
  );
}

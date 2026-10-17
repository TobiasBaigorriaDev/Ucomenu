import { choiceRule } from "@/lib/carta/options-rules";
import type { MenuOptionGroup } from "@/lib/menu";
import { formatArs } from "@/lib/money";

/**
 * Recorta los grupos a `maxRows` filas de opciones en total (los grupos se conservan en orden y el último puede quedar
 * parcial). Las cards de media columna lo usan para que un plato con muchos extras no rompa el ritmo del bento; el
 * detalle del plato y las cards anchas muestran todo. Sin tope devuelve los grupos tal cual.
 */
export function limitOptionGroups(groups: MenuOptionGroup[], maxRows?: number): { shown: MenuOptionGroup[]; hidden: number } {
  if (maxRows === undefined) return { shown: groups, hidden: 0 };
  let left = maxRows;
  let hidden = 0;
  const shown: MenuOptionGroup[] = [];
  for (const group of groups) {
    const take = Math.max(0, Math.min(group.options.length, left));
    hidden += group.options.length - take;
    left -= take;
    if (take > 0) shown.push({ ...group, options: group.options.slice(0, take) });
  }
  return { shown, hidden };
}

/**
 * Variantes y adicionales de un plato en la carta pública. Es solo informativo (no hay pedidos): el precio principal del
 * plato sigue siendo el base y cada opción muestra su diferencia («+ $ 600»; sin diferencia, nada). Los grupos no usan
 * títulos (`h2` = categorías, `h3` = platos); cada uno es una lista con nombre y regla de elección.
 */
export function DishOptions({ productId, groups, maxRows }: { productId: string; groups: MenuOptionGroup[]; maxRows?: number }) {
  const { shown, hidden } = limitOptionGroups(groups, maxRows);
  return (
    <div className="mt-3 space-y-3" data-testid="opciones-plato">
      {shown.map((group) => {
        const titleId = `opciones-${productId}-${group.id}`;
        return (
          <div key={group.id} data-testid="grupo-opciones" className="max-w-[46ch] border-l border-ink/20 pl-3">
            <p id={titleId} className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-semibold tracking-wide text-[var(--carta-green)] [overflow-wrap:anywhere]">{group.name}</span>
              <span className="text-muted">{choiceRule(group.min_choices, group.max_choices)}</span>
            </p>
            <ul aria-labelledby={titleId} className="mt-1">
              {group.options.map((option) => (
                <li key={option.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-0.5 text-[0.9375rem] leading-snug">
                  <span className="min-w-0 [overflow-wrap:anywhere]">{option.name}</span>
                  {option.price_delta_cents > 0 ? (
                    <span className="shrink-0 whitespace-nowrap text-[var(--carta-terra)] tabular-nums">
                      + {formatArs(option.price_delta_cents)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {hidden > 0 ? <p className="text-sm text-muted">{hidden === 1 ? "1 opción más en el detalle" : `${hidden} opciones más en el detalle`}</p> : null}
    </div>
  );
}

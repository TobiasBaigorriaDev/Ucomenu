import { choiceRule } from "@/lib/carta/options-rules";
import type { MenuOptionGroup } from "@/lib/menu";
import { formatArs } from "@/lib/money";

/**
 * Variantes y adicionales de un plato en la carta pública. Es solo informativo (no hay pedidos): el precio principal del
 * plato sigue siendo el base y cada opción muestra su diferencia («+ $ 600»; sin diferencia, nada). Los grupos no usan
 * títulos (`h2` = categorías, `h3` = platos); cada uno es una lista con nombre y regla de elección.
 */
export function DishOptions({ productId, groups }: { productId: string; groups: MenuOptionGroup[] }) {
  return (
    <div className="mt-3 space-y-3" data-testid="opciones-plato">
      {groups.map((group) => {
        const titleId = `opciones-${productId}-${group.id}`;
        return (
          <div key={group.id} data-testid="grupo-opciones" className="max-w-[46ch] border-l-2 border-[var(--carta-sand)] pl-3">
            <p id={titleId} className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-semibold tracking-wide text-[var(--carta-green)] [overflow-wrap:anywhere]">{group.name}</span>
              <span className="text-muted">{choiceRule(group.min_choices, group.max_choices)}</span>
            </p>
            <ul aria-labelledby={titleId} className="mt-1">
              {group.options.map((option) => (
                <li key={option.id} className="flex items-baseline justify-between gap-x-4 py-0.5 text-[0.9375rem] leading-snug">
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
    </div>
  );
}

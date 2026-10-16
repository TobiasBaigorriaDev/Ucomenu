import type { CartaOptionGroup } from "@/lib/carta/options";
import { choiceRule, deltaToInput, isUnsatisfiable, isVariant } from "@/lib/carta/options-rules";
import { formatArs } from "@/lib/money";
import { ItemControls } from "../../item-controls";
import { optionRowAction } from "../../opciones-actions";
import { CreateGroupForm, CreateOptionForm, EditGroupForm, EditOptionForm } from "../../opciones-forms";

const badgeClass = "inline-flex items-center rounded-sm border border-ink/40 px-2 py-0.5 text-sm text-ink";

type Props = {
  orgSlug: string;
  productId: string;
  groups: CartaOptionGroup[];
  canWrite: boolean;
};

/** «Variantes y adicionales» en la pantalla del plato: grupos, sus opciones y el alta de un grupo nuevo. */
export function OpcionesSection({ orgSlug, productId, groups, canWrite }: Props) {
  return (
    <section aria-labelledby="opciones" className="mt-12" data-testid="opciones">
      <h2 id="opciones" className="font-display text-2xl">
        Variantes y adicionales
      </h2>
      <p className="mt-1 max-w-prose text-base text-muted">
        Una variante se elige entre varias (el tamaño, el punto de cocción). Los adicionales son extras opcionales. La carta
        muestra cada opción con su diferencia de precio, solo como información: el precio del plato sigue siendo el de arriba.
      </p>

      {groups.length === 0 ? (
        <p className="mt-4 text-base text-muted" data-testid="sin-grupos">
          Este plato todavía no tiene variantes ni adicionales.
        </p>
      ) : (
        <ul className="mt-5 space-y-6">
          {groups.map((group, index) => {
            const activeOptions = group.options.filter((option) => option.is_active).length;
            return (
              <li key={group.id} className="border-t-2 border-ink/30 pt-4" data-testid="grupo" data-name={group.name}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 className="min-w-0 font-display text-xl leading-tight [overflow-wrap:anywhere]">{group.name}</h3>
                  <span className={badgeClass}>{isVariant(group.min_choices, group.max_choices) ? "Variante" : "Adicionales"}</span>
                  {group.is_active ? null : <span className={badgeClass}>Inactivo</span>}
                </div>
                <p className="mt-1 text-base text-muted" data-testid="regla">
                  {choiceRule(group.min_choices, group.max_choices)}
                </p>
                {group.is_active && isUnsatisfiable(group.min_choices, activeOptions) ? (
                  <p className="mt-1 max-w-prose text-sm font-medium" data-testid="grupo-incompleto">
                    {activeOptions === 0
                      ? "Este grupo no tiene opciones activas, así que no se muestra en la carta."
                      : `Pide elegir al menos ${group.min_choices} y solo tiene ${activeOptions} opciones activas.`}
                  </p>
                ) : null}

                <div className="mt-3 flex flex-wrap items-start gap-2">
                  <ItemControls
                    orgSlug={orgSlug}
                    kind="group"
                    id={group.id}
                    name={group.name}
                    isActive={group.is_active}
                    canMoveUp={index > 0}
                    canMoveDown={index < groups.length - 1}
                    canWrite={canWrite}
                    action={optionRowAction}
                  />
                  <EditGroupForm
                    orgSlug={orgSlug}
                    id={group.id}
                    groupName={group.name}
                    values={{ name: group.name, min: String(group.min_choices), max: String(group.max_choices) }}
                    canWrite={canWrite}
                  />
                </div>

                {group.options.length > 0 ? (
                  <ul className="mt-4 border-t border-ink/15">
                    {group.options.map((option, optionIndex) => (
                      <li key={option.id} className="border-b border-ink/15 py-3" data-testid="opcion" data-name={option.name}>
                        <div className="flex items-baseline gap-3 text-lg">
                          <span className="min-w-0 font-medium break-words">{option.name}</span>
                          <span aria-hidden className="leader" />
                          <span className="shrink-0 tabular-nums">
                            {option.price_delta_cents > 0 ? `+ ${formatArs(option.price_delta_cents)}` : "Sin diferencia"}
                          </span>
                        </div>
                        {option.is_active ? null : <span className={`${badgeClass} mt-1`}>Inactiva</span>}
                        <div className="mt-2 flex flex-wrap items-start gap-2">
                          <ItemControls
                            orgSlug={orgSlug}
                            kind="option"
                            id={option.id}
                            name={option.name}
                            isActive={option.is_active}
                            canMoveUp={optionIndex > 0}
                            canMoveDown={optionIndex < group.options.length - 1}
                            canWrite={canWrite}
                            action={optionRowAction}
                          />
                          <EditOptionForm
                            orgSlug={orgSlug}
                            id={option.id}
                            optionName={option.name}
                            values={{ name: option.name, delta: deltaToInput(option.price_delta_cents) }}
                            canWrite={canWrite}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-4 text-base text-muted">Este grupo todavía no tiene opciones.</p>
                )}

                <div className="mt-3">
                  <CreateOptionForm orgSlug={orgSlug} groupId={group.id} groupName={group.name} canWrite={canWrite} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-8">
        <h3 className="font-display text-xl">Nuevo grupo</h3>
        <CreateGroupForm orgSlug={orgSlug} productId={productId} canWrite={canWrite} />
      </div>
    </section>
  );
}

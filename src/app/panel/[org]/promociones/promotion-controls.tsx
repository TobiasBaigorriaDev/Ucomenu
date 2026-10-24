"use client";

import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { dangerButtonClass, secondaryButtonClass } from "@/components/panel/styles";
import { deletePromotionAction, duplicatePromotionAction, setPromotionActiveAction } from "./actions";

const summaryExtras = "cursor-pointer list-none [&::-webkit-details-marker]:hidden";
const summaryButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-danger px-4 py-2 text-base font-medium text-danger";

type Props = { orgSlug: string; id: string; name: string; canWrite: boolean };

/** Pausar / reanudar. El estado deseado viaja explícito: dos pestañas o un reintento nunca alternan a ciegas. */
export function ToggleActiveForm({ orgSlug, id, name, isActive, canWrite }: Props & { isActive: boolean }) {
  return (
    <ActionForm action={setPromotionActiveAction}>
      <fieldset disabled={!canWrite}>
        <input type="hidden" name="org" value={orgSlug} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="active" value={isActive ? "false" : "true"} />
        <SubmitButton className={secondaryButtonClass} pendingLabel="Un momento…">
          {isActive ? `Pausar ${name}` : `Reanudar ${name}`}
        </SubmitButton>
      </fieldset>
    </ActionForm>
  );
}

export function DuplicateForm({ orgSlug, id, name, canWrite }: Props) {
  return (
    <ActionForm action={duplicatePromotionAction}>
      <fieldset disabled={!canWrite}>
        <input type="hidden" name="org" value={orgSlug} />
        <input type="hidden" name="id" value={id} />
        <SubmitButton className={secondaryButtonClass} pendingLabel="Duplicando…">
          Duplicar {name}
        </SubmitButton>
      </fieldset>
    </ActionForm>
  );
}

/** Borrar pide una confirmación que explica qué pasa. El historial queda. */
export function DeleteForm({ orgSlug, id, name, canWrite }: Props) {
  return (
    <ActionForm action={deletePromotionAction}>
      <fieldset disabled={!canWrite}>
        <input type="hidden" name="org" value={orgSlug} />
        <input type="hidden" name="id" value={id} />
        <details>
          <summary className={`${summaryButtonClass} ${summaryExtras}`} aria-label={`Borrar ${name}`}>
            Borrar
          </summary>
          <div className="mt-3 grid gap-3">
            <p className="max-w-prose text-base">
              La promoción deja de aplicarse y se borra. Queda constancia en el historial de promociones. Si solo querés frenarla un tiempo, pausala.
            </p>
            <div>
              <SubmitButton className={dangerButtonClass} pendingLabel="Borrando…">
                Sí, borrar {name}
              </SubmitButton>
            </div>
          </div>
        </details>
      </fieldset>
    </ActionForm>
  );
}

"use client";

import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { inputClass, labelClass, secondaryButtonClass } from "@/components/panel/styles";
import { NAME_MAX } from "@/lib/carta/validation";
import { createCategoryAction, renameCategoryAction } from "./actions";

export function CreateCategoryForm({ orgSlug, canWrite }: { orgSlug: string; canWrite: boolean }) {
  return (
    <ActionForm action={createCategoryAction} className="mt-3 max-w-md">
      {(state) => (
        <fieldset disabled={!canWrite} className="grid gap-3">
          <input type="hidden" name="org" value={orgSlug} />
          <div>
            <label htmlFor="categoria-nueva" className={labelClass}>
              Nombre de la categoría
            </label>
            <input
              id="categoria-nueva"
              name="name"
              required
              maxLength={NAME_MAX}
              autoComplete="off"
              defaultValue={state.values?.name ?? ""}
              className={`${inputClass} mt-1`}
            />
          </div>
          <div>
            <SubmitButton pendingLabel="Creando…">Crear categoría</SubmitButton>
          </div>
        </fieldset>
      )}
    </ActionForm>
  );
}

export function RenameCategoryForm({
  orgSlug,
  id,
  name,
  canWrite,
}: {
  orgSlug: string;
  id: string;
  name: string;
  canWrite: boolean;
}) {
  return (
    <details>
      <summary
        className={`${secondaryButtonClass} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
        aria-label={`Renombrar ${name}`}
      >
        Renombrar
      </summary>
      <ActionForm action={renameCategoryAction} className="mt-3 max-w-md">
        {(state) => (
          <fieldset disabled={!canWrite} className="grid gap-3">
            <input type="hidden" name="org" value={orgSlug} />
            <input type="hidden" name="id" value={id} />
            <div>
              <label htmlFor={`nombre-${id}`} className={labelClass}>
                Nombre nuevo
              </label>
              <input
                id={`nombre-${id}`}
                name="name"
                required
                maxLength={NAME_MAX}
                autoComplete="off"
                defaultValue={state.values?.name ?? name}
                className={`${inputClass} mt-1`}
              />
            </div>
            <div>
              <SubmitButton pendingLabel="Guardando…">Guardar nombre</SubmitButton>
            </div>
          </fieldset>
        )}
      </ActionForm>
    </details>
  );
}

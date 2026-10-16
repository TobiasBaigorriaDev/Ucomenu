"use client";

import { useRef } from "react";
import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { inputClass, labelClass } from "@/components/panel/styles";
import { BRANCH_NAME_MAX, suggestSlug } from "@/lib/sucursales/rules";
import { SLUG_MAX_LENGTH } from "@/lib/slug";
import { createBranchAction, renameBranchAction } from "./actions";

const summaryExtras = "cursor-pointer list-none [&::-webkit-details-marker]:hidden";
const summaryButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-ink/40 bg-transparent px-4 py-2 text-base font-medium text-ink";

/**
 * Alta de una sucursal. El identificador se propone a partir del nombre mientras la persona no lo toque; una vez
 * editado a mano deja de seguir al nombre (salvo que lo vacíe). Va en la dirección pública de la carta y NO se puede cambiar después.
 */
export function CreateBranchForm({ orgSlug, canWrite, full }: { orgSlug: string; canWrite: boolean; full: boolean }) {
  // Último identificador propuesto: mientras el campo siga vacío o igual a él, acompaña al nombre.
  const proposed = useRef("");
  const slugInput = useRef<HTMLInputElement>(null);

  return (
    <ActionForm action={createBranchAction} className="mt-3 max-w-md">
      {(state) =>
        // Con el tope alcanzado no se ofrecen los campos, pero el formulario sigue montado: así el aviso «Sucursal creada»
        // de la acción que acaba de ocupar el último cupo no desaparece al refrescar la pantalla.
        full ? null : (
        <fieldset disabled={!canWrite} className="grid gap-4">
          <input type="hidden" name="org" value={orgSlug} />
          <div>
            <label htmlFor="sucursal-nombre" className={labelClass}>
              Nombre de la sucursal
            </label>
            <input
              id="sucursal-nombre"
              name="name"
              required
              maxLength={BRANCH_NAME_MAX}
              autoComplete="off"
              defaultValue={state.values?.name ?? ""}
              onInput={(event) => {
                const field = slugInput.current;
                if (!field || (field.value !== "" && field.value !== proposed.current)) return;
                proposed.current = suggestSlug(event.currentTarget.value);
                field.value = proposed.current;
              }}
              className={`${inputClass} mt-1`}
            />
          </div>
          <div>
            <label htmlFor="sucursal-slug" className={labelClass}>
              Identificador en la dirección de la carta
            </label>
            <input
              ref={slugInput}
              id="sucursal-slug"
              name="slug"
              required
              maxLength={SLUG_MAX_LENGTH}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              defaultValue={state.values?.slug ?? ""}
              aria-describedby="sucursal-slug-ayuda"
              className={`${inputClass} mt-1`}
            />
            <p id="sucursal-slug-ayuda" className="mt-1 text-sm text-muted">
              Letras minúsculas sin acentos, números y guiones. Queda en el link de la carta y no se puede cambiar después.
            </p>
          </div>
          <div>
            <SubmitButton pendingLabel="Creando…">Crear sucursal</SubmitButton>
          </div>
        </fieldset>
        )
      }
    </ActionForm>
  );
}

export function RenameBranchForm({
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
      <summary className={`${summaryButtonClass} ${summaryExtras}`} aria-label={`Renombrar ${name}`}>
        Renombrar
      </summary>
      <ActionForm action={renameBranchAction} className="mt-3 max-w-md">
        {(state) => (
          <fieldset disabled={!canWrite} className="grid gap-3">
            <input type="hidden" name="org" value={orgSlug} />
            <input type="hidden" name="id" value={id} />
            <div>
              <label htmlFor={`sucursal-nombre-${id}`} className={labelClass}>
                Nombre nuevo
              </label>
              <input
                id={`sucursal-nombre-${id}`}
                name="name"
                required
                maxLength={BRANCH_NAME_MAX}
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

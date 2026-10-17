"use client";

import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { inputClass, labelClass } from "@/components/panel/styles";
import { SLUG_MAX_LENGTH } from "@/lib/slug";
import { correctBranchSlugAction } from "../../actions";

export function BranchSlugForm({ orgSlug, branchId, currentSlug }: {
  orgSlug: string; branchId: string; currentSlug: string;
}) {
  const inputId = `branch-slug-${branchId}`;
  return (
    <ActionForm action={correctBranchSlugAction} className="mt-3 grid max-w-md gap-3">
      {(state) => <>
        <input type="hidden" name="slug" value={orgSlug} />
        <input type="hidden" name="branchId" value={branchId} />
        <input type="hidden" name="expectedSlug" value={currentSlug} />
        <div>
          <label htmlFor={inputId} className={labelClass}>Nuevo identificador de la sucursal</label>
          <input key={`${currentSlug}-${state.values?.newSlug ?? ""}`} id={inputId} name="newSlug" required
            maxLength={SLUG_MAX_LENGTH} autoComplete="off" autoCapitalize="none" spellCheck={false}
            defaultValue={state.values?.newSlug ?? currentSlug} className={`${inputClass} mt-1`} />
        </div>
        <div><SubmitButton pendingLabel="Corrigiendo…">Corregir identificador</SubmitButton></div>
      </>}
    </ActionForm>
  );
}

"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { dangerButtonClass, inputClass, labelClass, secondaryButtonClass } from "@/components/panel/styles";
import { LABEL_MAX } from "@/lib/mesas/labels";
import { createTableAction, deleteTableAction, regenerateQrAction, renameTableAction, tableRowAction } from "./actions";

const summaryExtras = "cursor-pointer list-none [&::-webkit-details-marker]:hidden";

export function CreateTableForm({
  orgSlug,
  branchId,
  branchName,
  suggestion,
  canWrite,
}: {
  orgSlug: string;
  branchId: string;
  branchName: string;
  suggestion: string;
  canWrite: boolean;
}) {
  return (
    <ActionForm action={createTableAction} className="mt-3 max-w-md">
      {(state) => (
        <fieldset disabled={!canWrite} className="grid gap-3">
          <input type="hidden" name="org" value={orgSlug} />
          <input type="hidden" name="branch" value={branchId} />
          <div>
            <label htmlFor={`mesa-nueva-${branchId}`} className={labelClass}>
              Nombre de la mesa en {branchName}
            </label>
            <input
              id={`mesa-nueva-${branchId}`}
              name="label"
              required
              maxLength={LABEL_MAX}
              autoComplete="off"
              defaultValue={state.values?.label ?? suggestion}
              className={`${inputClass} mt-1`}
            />
          </div>
          <div>
            <SubmitButton pendingLabel="Creando…">Agregar mesa</SubmitButton>
          </div>
        </fieldset>
      )}
    </ActionForm>
  );
}

/** Activar/desactivar una mesa. */
export function TableToggle({
  orgSlug,
  id,
  label,
  isActive,
  canWrite,
}: {
  orgSlug: string;
  id: string;
  label: string;
  isActive: boolean;
  canWrite: boolean;
}) {
  const [state, formAction] = useActionState(tableRowAction, {});

  return (
    <form action={formAction}>
      <input type="hidden" name="org" value={orgSlug} />
      <input type="hidden" name="id" value={id} />
      <ToggleButton label={label} isActive={isActive} canWrite={canWrite} />
      {state.error ? (
        <p role="alert" className="mt-2 text-base font-medium text-danger">
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p role="status" className="mt-2 text-sm text-muted">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function ToggleButton({ label, isActive, canWrite }: { label: string; isActive: boolean; canWrite: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="intent"
      value={isActive ? "deactivate" : "activate"}
      disabled={!canWrite || pending}
      aria-label={`${isActive ? "Desactivar" : "Activar"} ${label}`}
      className={`${secondaryButtonClass} min-w-11 px-3`}
    >
      {isActive ? "Desactivar" : "Activar"}
    </button>
  );
}

export function RenameTableForm({
  orgSlug,
  id,
  label,
  canWrite,
}: {
  orgSlug: string;
  id: string;
  label: string;
  canWrite: boolean;
}) {
  return (
    <details>
      <summary className={`${secondaryButtonClass} ${summaryExtras}`} aria-label={`Renombrar ${label}`}>
        Renombrar
      </summary>
      <ActionForm action={renameTableAction} className="mt-3 max-w-md">
        {(state) => (
          <fieldset disabled={!canWrite} className="grid gap-3">
            <input type="hidden" name="org" value={orgSlug} />
            <input type="hidden" name="id" value={id} />
            <div>
              <label htmlFor={`mesa-nombre-${id}`} className={labelClass}>
                Nombre nuevo
              </label>
              <input
                id={`mesa-nombre-${id}`}
                name="label"
                required
                maxLength={LABEL_MAX}
                autoComplete="off"
                defaultValue={state.values?.label ?? label}
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

export function RegenerateQrForm({
  orgSlug,
  id,
  label,
  canWrite,
}: {
  orgSlug: string;
  id: string;
  label: string;
  canWrite: boolean;
}) {
  return (
    <details>
      <summary className={`${dangerButtonClass} ${summaryExtras}`} aria-label={`Regenerar el QR de ${label}`}>
        Regenerar QR
      </summary>
      <ActionForm action={regenerateQrAction} className="mt-3 max-w-md">
        <fieldset disabled={!canWrite}>
          <input type="hidden" name="org" value={orgSlug} />
          <input type="hidden" name="id" value={id} />
          <p className="text-base leading-relaxed">
            El QR impreso de {label} deja de funcionar de inmediato y hay que imprimir el nuevo. Usalo si alguien se llevó
            o fotografió el QR.
          </p>
          <div className="mt-3">
            <SubmitButton className={dangerButtonClass} pendingLabel="Regenerando…">
              Sí, regenerar
            </SubmitButton>
          </div>
        </fieldset>
      </ActionForm>
    </details>
  );
}

/** Borrar es irreversible: el botón solo abre la explicación y recién el segundo botón borra (el servidor vuelve a comprobar todo). */
export function DeleteTableForm({
  orgSlug,
  id,
  label,
  canWrite,
}: {
  orgSlug: string;
  id: string;
  label: string;
  canWrite: boolean;
}) {
  return (
    <details data-testid="borrar-mesa">
      <summary className={`${dangerButtonClass} ${summaryExtras}`} aria-label={`Borrar la mesa ${label}`}>
        Borrar mesa
      </summary>
      <ActionForm action={deleteTableAction} className="mt-3 max-w-prose">
        <fieldset disabled={!canWrite} className="grid gap-3">
          <input type="hidden" name="org" value={orgSlug} />
          <input type="hidden" name="id" value={id} />
          <p className="text-base leading-relaxed">
            Vas a borrar <strong className="break-words">{label}</strong> para siempre, con sus llamados al mozo.{" "}
            <strong>No se puede deshacer.</strong> Su QR impreso deja de funcionar: retiralo de la mesa. Si necesitás la mesa
            otra vez, se crea una nueva con un QR nuevo para imprimir.
          </p>
          <p className="text-base text-muted">Si solo querés pausarla, usá «Desactivar».</p>
          <div>
            <SubmitButton pendingLabel="Borrando…" className={dangerButtonClass}>
              Sí, borrar la mesa definitivamente
            </SubmitButton>
          </div>
        </fieldset>
      </ActionForm>
    </details>
  );
}

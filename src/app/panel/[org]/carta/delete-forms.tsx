"use client";

import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { dangerButtonClass, inputClass, labelClass } from "@/components/panel/styles";
import { deleteCategoryAction, deleteProductAction } from "./actions";

const summaryClass = `${dangerButtonClass} cursor-pointer list-none [&::-webkit-details-marker]:hidden`;

/**
 * Borrar es irreversible y se hace en dos pasos: el botón solo abre la explicación (un `<details>`), y recién el segundo
 * botón envía. El servidor vuelve a comprobar todo; esto es la guía.
 */
export function DeleteProductForm({
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
    <details data-testid="borrar-plato">
      <summary className={summaryClass} aria-label={`Borrar el plato ${name}`}>
        Borrar plato
      </summary>
      <ActionForm action={deleteProductAction} className="mt-3 max-w-prose">
        <fieldset disabled={!canWrite} className="grid gap-3">
          <input type="hidden" name="org" value={orgSlug} />
          <input type="hidden" name="id" value={id} />
          <p className="text-base">
            Vas a borrar <strong className="break-words">{name}</strong> para siempre, con su foto, sus variantes y adicionales y su
            disponibilidad por sucursal. <strong>No se puede deshacer.</strong> Los cambios de precio quedan en el historial.
          </p>
          <p className="text-base text-muted">Si solo querés que no se vea en la carta, usá «Desactivar» en la lista.</p>
          <div>
            <SubmitButton pendingLabel="Borrando…" className={dangerButtonClass}>
              Sí, borrar el plato definitivamente
            </SubmitButton>
          </div>
        </fieldset>
      </ActionForm>
    </details>
  );
}

export function DeleteCategoryForm({
  orgSlug,
  id,
  name,
  productCount,
  canWrite,
}: {
  orgSlug: string;
  id: string;
  name: string;
  /** Cuántos platos tiene (activos e inactivos) tal como se muestra en pantalla. */
  productCount: number;
  canWrite: boolean;
}) {
  return (
    <details data-testid="borrar-categoria">
      <summary className={summaryClass} aria-label={`Borrar la categoría ${name}`}>
        Borrar categoría
      </summary>
      <ActionForm action={deleteCategoryAction} className="mt-3 max-w-prose">
        <fieldset disabled={!canWrite} className="grid gap-3">
          <input type="hidden" name="org" value={orgSlug} />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="expected" value={productCount} />
          {productCount > 0 ? (
            <p className="text-base">
              Vas a borrar <strong className="break-words">{name}</strong> para siempre y con ella{" "}
              <strong>
                {productCount} {productCount === 1 ? "plato" : "platos"}
              </strong>
              , sus fotos, variantes y adicionales y su disponibilidad. <strong>No se puede deshacer.</strong> Los cambios de precio
              quedan en el historial.
            </p>
          ) : (
            <p className="text-base">
              Vas a borrar <strong className="break-words">{name}</strong>, que no tiene platos. <strong>No se puede deshacer.</strong>
            </p>
          )}
          <p className="text-base text-muted">Si solo querés que no se vea en la carta, usá «Desactivar».</p>
          {productCount > 0 ? (
            <div>
              <label htmlFor={`confirmar-${id}`} className={labelClass}>
                Para confirmar, escribí exactamente: <span className="break-words font-semibold">{name}</span>
              </label>
              <input
                id={`confirmar-${id}`}
                name="confirm"
                required
                autoComplete="off"
                className={`${inputClass} mt-1`}
              />
            </div>
          ) : null}
          <div>
            <SubmitButton pendingLabel="Borrando…" className={dangerButtonClass}>
              Sí, borrar la categoría definitivamente
            </SubmitButton>
          </div>
        </fieldset>
      </ActionForm>
    </details>
  );
}

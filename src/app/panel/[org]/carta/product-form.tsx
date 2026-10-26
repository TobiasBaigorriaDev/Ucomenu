"use client";

import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { inputClass, labelClass } from "@/components/panel/styles";
import { DESCRIPTION_MAX, NAME_MAX } from "@/lib/carta/validation";
import { DIETARY_LABEL, DIETARY_TAGS } from "@/lib/carta/dietary";
import { saveProductAction } from "./actions";

export type ProductFormValues = {
  name: string;
  description: string;
  /** Texto del campo de precio (`2800,50`). */
  price: string;
  categoryId: string;
  dietaryTags?: string[];
};

type Props = {
  orgSlug: string;
  /** Sin `productId` es un alta; con él, una edición. */
  productId?: string;
  categories: { id: string; name: string }[];
  /** Solo en el alta y con varias sucursales activas: en cuáles se muestra el plato nuevo (todas por defecto). */
  branches?: { id: string; name: string }[];
  initial: ProductFormValues;
  canWrite: boolean;
};

/** Alta y edición de un plato. En el alta, el plato se puede crear oculto (si el plan ya llegó a su tope). */
export function ProductForm({ orgSlug, productId, categories, branches, initial, canWrite }: Props) {
  return (
    <ActionForm action={saveProductAction} className={productId ? "mt-4" : "mt-4 max-w-md"}>
      {(state) => {
        const v = state.values;
        return (
          <fieldset disabled={!canWrite} className={`grid gap-4 ${productId ? "sm:grid-cols-2" : ""}`}>
            <input type="hidden" name="org" value={orgSlug} />
            {productId ? <input type="hidden" name="id" value={productId} /> : null}

            <div className={productId ? "sm:col-span-2" : undefined}>
              <label htmlFor="plato-nombre" className={labelClass}>
                Nombre
              </label>
              <input
                id="plato-nombre"
                name="name"
                required
                maxLength={NAME_MAX}
                autoComplete="off"
                defaultValue={v?.name ?? initial.name}
                className={`${inputClass} mt-1`}
              />
            </div>

            <div className={productId ? "sm:col-span-2" : undefined}>
              <label htmlFor="plato-descripcion" className={labelClass}>
                Descripción <span className="font-normal text-muted">(opcional)</span>
              </label>
              <textarea
                id="plato-descripcion"
                name="description"
                rows={3}
                maxLength={DESCRIPTION_MAX}
                defaultValue={v?.description ?? initial.description}
                className={`${inputClass} mt-1`}
              />
            </div>

            <div>
              <label htmlFor="plato-precio" className={labelClass}>
                Precio en pesos
              </label>
              <input
                id="plato-precio"
                name="price"
                required
                inputMode="decimal"
                autoComplete="off"
                placeholder="2800 o 2.800,50"
                defaultValue={v?.price ?? initial.price}
                className={`${inputClass} mt-1`}
              />
            </div>

            <div>
              <label htmlFor="plato-categoria" className={labelClass}>
                Categoría
              </label>
              <select
                id="plato-categoria"
                name="category"
                required
                defaultValue={v?.category ?? initial.categoryId}
                className={`${inputClass} mt-1`}
              >
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>

            {productId ? null : (
              <div className="flex min-h-11 items-center gap-3">
                <input
                  id="plato-activo"
                  name="active"
                  type="checkbox"
                  defaultChecked={v ? v.active === "on" : true}
                  className="size-5 accent-cobalt"
                />
                <label htmlFor="plato-activo" className="text-base">
                  Mostrar en la carta
                </label>
              </div>
            )}

            {productId || !branches ? null : (
              <fieldset aria-describedby="sucursales-help" data-testid="alta-sucursales">
                <legend className={labelClass}>Sucursales donde se muestra</legend>
                <p id="sucursales-help" className="mt-1 text-sm text-muted">
                  El plato es de toda la carta; acá elegís en cuáles sucursales aparece. Después podés cambiarlo, y ponerle un precio propio a cada una.
                </p>
                {branches.map((branch) => (
                  <label key={branch.id} className="flex min-h-11 items-center gap-3">
                    <input
                      type="checkbox"
                      name="shown_branch"
                      value={branch.id}
                      className="size-5 accent-cobalt"
                      defaultChecked={v?.shown ? (JSON.parse(v.shown) as string[]).includes(branch.id) : true}
                    />
                    {branch.name}
                  </label>
                ))}
              </fieldset>
            )}

            <fieldset aria-describedby="dietary-help" className={productId ? "sm:col-span-2" : undefined}>
              <legend className={labelClass}>Etiquetas dietarias</legend>
              <p id="dietary-help" className="mt-1 text-sm text-muted">Marcá solo lo que el local puede confirmar para la receta de hoy, incluyendo el contacto con otros ingredientes en la cocina, las variantes y los adicionales. La etiqueta se muestra en todas las sucursales donde se ve el plato: si en alguna no se cumple, ocultalo ahí. Revisala cada vez que cambie la receta o un proveedor. Un plato sin etiqueta no se muestra como apto para ninguna dieta.</p>
              <div className={productId ? "mt-1 flex flex-wrap gap-x-5" : undefined}>
              {DIETARY_TAGS.map((tag) => (
                <label key={tag} className="flex min-h-11 items-center gap-3">
                  <input type="checkbox" name="dietary" value={tag} className="size-5 accent-cobalt"
                    defaultChecked={(v?.dietary ? JSON.parse(v.dietary) as string[] : initial.dietaryTags ?? []).includes(tag)} />
                  {DIETARY_LABEL[tag]}
                </label>
              ))}
              </div>
            </fieldset>

            <div>
              <SubmitButton pendingLabel="Guardando…">{productId ? "Guardar cambios" : "Crear plato"}</SubmitButton>
            </div>
          </fieldset>
        );
      }}
    </ActionForm>
  );
}

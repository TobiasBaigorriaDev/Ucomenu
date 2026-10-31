"use client";

import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { inputClass, labelClass } from "@/components/panel/styles";
import { DESCRIPTION_MAX, NAME_MAX } from "@/lib/carta/validation";
import { DIETARY_LABEL, DIETARY_TAGS } from "@/lib/carta/dietary";
import { BRANCH_PRICE_FIELD } from "@/lib/carta/alta-campos";
import { saveProductAction } from "./actions";
import { GroupsBuilder, PhotoPicker } from "./alta-extras";

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

const sectionClass = "panel-cell min-w-0";

/**
 * Alta y edición de un plato. En el alta (alta unificada, ficha alta-unificada-de-platos) el mismo formulario trae los datos, la foto, las
 * variantes y adicionales y las sucursales, todo opcional salvo los datos; al crear se abre el editor del plato. El plato se puede crear
 * oculto (si el plan ya llegó a su tope).
 */
export function ProductForm({ orgSlug, productId, categories, branches, initial, canWrite }: Props) {
  return (
    <ActionForm action={saveProductAction} className={productId ? "mt-4" : "mt-4 grid max-w-3xl gap-4"}>
      {(state) => {
        const v = state.values;
        const dataFields = (
          <>
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

            <fieldset aria-describedby="dietary-help" className={productId ? "sm:col-span-2" : undefined}>
              <legend className={labelClass}>Etiquetas dietarias <span className="font-normal text-muted">(opcional)</span></legend>
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
          </>
        );

        if (productId) {
          return (
            <fieldset disabled={!canWrite} className="grid gap-4 sm:grid-cols-2">
              {dataFields}
              <div>
                <SubmitButton pendingLabel="Guardando…">Guardar cambios</SubmitButton>
              </div>
            </fieldset>
          );
        }

        return (
          <fieldset disabled={!canWrite} className="grid gap-4" data-testid="alta-plato">
            <section aria-labelledby="alta-datos" className={sectionClass}>
              <h2 id="alta-datos" className="font-display text-2xl">
                Datos del plato
              </h2>
              <div className="mt-3 grid gap-4">{dataFields}</div>
            </section>

            <section aria-labelledby="alta-foto" className={sectionClass}>
              <h2 id="alta-foto" className="font-display text-2xl">
                Foto
              </h2>
              <div className="mt-3">
                <PhotoPicker submission={state} />
              </div>
            </section>

            <section aria-labelledby="alta-variantes" className={sectionClass}>
              <h2 id="alta-variantes" className="font-display text-2xl">
                Variantes y adicionales <span className="font-sans text-base font-normal text-muted">(opcional)</span>
              </h2>
              <div className="mt-3">
                <GroupsBuilder />
              </div>
            </section>

            {branches ? (
              <section aria-labelledby="alta-sucursales" className={sectionClass} data-testid="alta-sucursales">
                <h2 id="alta-sucursales" className="font-display text-2xl">
                  Sucursales <span className="font-sans text-base font-normal text-muted">(opcional)</span>
                </h2>
                <p className="mt-1 max-w-prose text-base text-muted">
                  El plato es de toda la carta; acá elegís en cuáles sucursales aparece y, si querés, un precio propio para cada una (vacío = el precio
                  general). Después podés cambiarlo.
                </p>
                <ul className="mt-3 space-y-2">
                  {branches.map((branch) => (
                    <li key={branch.id} className="flex flex-wrap items-center gap-x-6 gap-y-1">
                      <label className="flex min-h-11 min-w-48 items-center gap-3">
                        <input
                          type="checkbox"
                          name="shown_branch"
                          value={branch.id}
                          className="size-5 accent-cobalt"
                          defaultChecked={v?.shown ? (JSON.parse(v.shown) as string[]).includes(branch.id) : true}
                        />
                        {branch.name}
                      </label>
                      <label className="flex items-center gap-2 text-base">
                        <span className="text-muted">Precio propio</span>
                        <input
                          name={`${BRANCH_PRICE_FIELD}${branch.id}`}
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="Precio general"
                          aria-label={`Precio propio en ${branch.name}`}
                          defaultValue={v?.[`${BRANCH_PRICE_FIELD}${branch.id}`] ?? ""}
                          className={`${inputClass} w-40`}
                        />
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <div>
              <SubmitButton pendingLabel="Creando…">Crear plato</SubmitButton>
            </div>
          </fieldset>
        );
      }}
    </ActionForm>
  );
}

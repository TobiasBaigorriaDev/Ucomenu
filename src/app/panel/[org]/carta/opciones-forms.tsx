"use client";

import { useRef } from "react";
import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { inputClass, labelClass, secondaryButtonClass } from "@/components/panel/styles";
import { GROUP_TEMPLATES, MAX_CHOICES } from "@/lib/carta/options-rules";
import { NAME_MAX } from "@/lib/carta/validation";
import { createGroupAction, createOptionAction, updateGroupAction, updateOptionAction } from "./opciones-actions";

const summaryClass = `${secondaryButtonClass} cursor-pointer list-none [&::-webkit-details-marker]:hidden`;

type GroupValues = { name: string; min: string; max: string };

/** Los tres campos de un grupo. Compartidos por el alta y la edición. */
function GroupFields({ idPrefix, values }: { idPrefix: string; values: GroupValues }) {
  return (
    <>
      <div>
        <label htmlFor={`${idPrefix}-nombre`} className={labelClass}>
          Nombre del grupo
        </label>
        <input
          id={`${idPrefix}-nombre`}
          name="name"
          required
          maxLength={NAME_MAX}
          autoComplete="off"
          defaultValue={values.name}
          className={`${inputClass} mt-1`}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${idPrefix}-min`} className={labelClass}>
            Mínimo a elegir
          </label>
          <input
            id={`${idPrefix}-min`}
            name="min"
            required
            inputMode="numeric"
            autoComplete="off"
            defaultValue={values.min}
            className={`${inputClass} mt-1`}
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-max`} className={labelClass}>
            Máximo a elegir
          </label>
          <input
            id={`${idPrefix}-max`}
            name="max"
            required
            inputMode="numeric"
            autoComplete="off"
            defaultValue={values.max}
            className={`${inputClass} mt-1`}
          />
        </div>
      </div>
      <p className="-mt-1 text-sm text-muted">
        Variante: mínimo 1 y máximo 1 (se elige una). Adicionales: mínimo 0 y máximo el que quieras (hasta {MAX_CHOICES}).
      </p>
    </>
  );
}

/** Alta de un grupo con dos plantillas que rellenan el formulario (siguen siendo editables). */
export function CreateGroupForm({ orgSlug, productId, canWrite }: { orgSlug: string; productId: string; canWrite: boolean }) {
  const formRef = useRef<HTMLDivElement>(null);

  function applyTemplate(template: (typeof GROUP_TEMPLATES)[number]) {
    const root = formRef.current;
    if (!root) return;
    for (const [name, value] of [
      ["name", template.name],
      ["min", template.min],
      ["max", template.max],
    ] as const) {
      const input = root.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      if (input) input.value = value;
    }
  }

  return (
    <ActionForm action={createGroupAction} className="mt-3 max-w-md">
      {(state) => (
        <fieldset disabled={!canWrite} className="grid gap-4">
          <input type="hidden" name="org" value={orgSlug} />
          <input type="hidden" name="product" value={productId} />
          <div>
            <p className={labelClass}>Empezar con una plantilla</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {GROUP_TEMPLATES.map((template) => (
                <button
                  key={template.key}
                  type="button"
                  onClick={() => applyTemplate(template)}
                  className={secondaryButtonClass}
                  data-testid={`plantilla-${template.key}`}
                >
                  {template.label}
                </button>
              ))}
            </div>
          </div>
          <div ref={formRef} className="grid gap-4">
            <GroupFields
              idPrefix="grupo-nuevo"
              values={{ name: state.values?.name ?? "", min: state.values?.min ?? "", max: state.values?.max ?? "" }}
            />
          </div>
          <div>
            <SubmitButton pendingLabel="Creando…">Crear grupo</SubmitButton>
          </div>
        </fieldset>
      )}
    </ActionForm>
  );
}

export function EditGroupForm({
  orgSlug,
  id,
  groupName,
  values,
  canWrite,
}: {
  orgSlug: string;
  id: string;
  groupName: string;
  values: GroupValues;
  canWrite: boolean;
}) {
  return (
    <details>
      <summary className={summaryClass} aria-label={`Editar el grupo ${groupName}`}>
        Editar grupo
      </summary>
      <ActionForm action={updateGroupAction} className="mt-3 max-w-md">
        {(state) => (
          <fieldset disabled={!canWrite} className="grid gap-4">
            <input type="hidden" name="org" value={orgSlug} />
            <input type="hidden" name="id" value={id} />
            <GroupFields
              idPrefix={`grupo-${id}`}
              values={{
                name: state.values?.name ?? values.name,
                min: state.values?.min ?? values.min,
                max: state.values?.max ?? values.max,
              }}
            />
            <div>
              <SubmitButton pendingLabel="Guardando…">Guardar grupo</SubmitButton>
            </div>
          </fieldset>
        )}
      </ActionForm>
    </details>
  );
}

function OptionFields({ idPrefix, values }: { idPrefix: string; values: { name: string; delta: string } }) {
  return (
    <>
      <div>
        <label htmlFor={`${idPrefix}-nombre`} className={labelClass}>
          Nombre de la opción
        </label>
        <input
          id={`${idPrefix}-nombre`}
          name="name"
          required
          maxLength={NAME_MAX}
          autoComplete="off"
          defaultValue={values.name}
          className={`${inputClass} mt-1`}
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-delta`} className={labelClass}>
          Diferencia de precio en pesos <span className="font-normal text-muted">(vacío = sin diferencia)</span>
        </label>
        <input
          id={`${idPrefix}-delta`}
          name="delta"
          inputMode="decimal"
          autoComplete="off"
          placeholder="300 o 1.250,50"
          defaultValue={values.delta}
          className={`${inputClass} mt-1`}
        />
      </div>
    </>
  );
}

export function CreateOptionForm({
  orgSlug,
  groupId,
  groupName,
  canWrite,
}: {
  orgSlug: string;
  groupId: string;
  groupName: string;
  canWrite: boolean;
}) {
  return (
    <details>
      <summary className={summaryClass} aria-label={`Agregar una opción a ${groupName}`}>
        Agregar opción
      </summary>
      <ActionForm action={createOptionAction} className="mt-3 max-w-md">
        {(state) => (
          <fieldset disabled={!canWrite} className="grid gap-4">
            <input type="hidden" name="org" value={orgSlug} />
            <input type="hidden" name="group" value={groupId} />
            <OptionFields
              idPrefix={`opcion-nueva-${groupId}`}
              values={{ name: state.values?.name ?? "", delta: state.values?.delta ?? "" }}
            />
            <div>
              <SubmitButton pendingLabel="Creando…">Crear opción</SubmitButton>
            </div>
          </fieldset>
        )}
      </ActionForm>
    </details>
  );
}

export function EditOptionForm({
  orgSlug,
  id,
  optionName,
  values,
  canWrite,
}: {
  orgSlug: string;
  id: string;
  optionName: string;
  values: { name: string; delta: string };
  canWrite: boolean;
}) {
  return (
    <details>
      <summary className={summaryClass} aria-label={`Editar la opción ${optionName}`}>
        Editar
      </summary>
      <ActionForm action={updateOptionAction} className="mt-3 max-w-md">
        {(state) => (
          <fieldset disabled={!canWrite} className="grid gap-4">
            <input type="hidden" name="org" value={orgSlug} />
            <input type="hidden" name="id" value={id} />
            <OptionFields
              idPrefix={`opcion-${id}`}
              values={{ name: state.values?.name ?? values.name, delta: state.values?.delta ?? values.delta }}
            />
            <div>
              <SubmitButton pendingLabel="Guardando…">Guardar opción</SubmitButton>
            </div>
          </fieldset>
        )}
      </ActionForm>
    </details>
  );
}

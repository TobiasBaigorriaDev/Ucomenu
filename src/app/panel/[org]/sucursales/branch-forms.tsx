"use client";

import { useRef } from "react";
import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { inputClass, labelClass } from "@/components/panel/styles";
import { BRANCH_NAME_MAX, BRANCH_TIME_ZONES, REVIEW_URL_MAX, suggestSlug } from "@/lib/sucursales/rules";
import { SLUG_MAX_LENGTH } from "@/lib/slug";
import { createBranchAction, renameBranchAction, setBranchActiveAction, setBranchReviewLinkAction, setBranchTimeZoneAction } from "./actions";

const summaryExtras = "cursor-pointer list-none [&::-webkit-details-marker]:hidden";
const summaryButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-ink/40 bg-transparent px-4 py-2 text-base font-medium text-ink";

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

/**
 * Enlace de reseñas de Google de la sucursal. Vacío lo quita. Solo se aceptan direcciones https de Google; la base lo vuelve a
 * comprobar. Es un dato de la carta pública: lo ve cualquiera que abra la carta de esta sucursal.
 */
export function ReviewLinkForm({
  orgSlug,
  id,
  name,
  link,
  canWrite,
}: {
  orgSlug: string;
  id: string;
  name: string;
  link: string | null;
  canWrite: boolean;
}) {
  return (
    <details>
      <summary className={`${summaryButtonClass} ${summaryExtras}`} aria-label={`Enlace de reseñas de ${name}`}>
        Enlace de reseñas
      </summary>
      <ActionForm action={setBranchReviewLinkAction} className="mt-3 max-w-md">
        {(state) => (
          <fieldset disabled={!canWrite} className="grid gap-3">
            <input type="hidden" name="org" value={orgSlug} />
            <input type="hidden" name="id" value={id} />
            <div>
              <label htmlFor={`sucursal-resenas-${id}`} className={labelClass}>
                Enlace de reseñas de Google
              </label>
              <input
                id={`sucursal-resenas-${id}`}
                name="link"
                type="url"
                inputMode="url"
                maxLength={REVIEW_URL_MAX}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="https://g.page/r/…/review"
                aria-describedby={`sucursal-resenas-ayuda-${id}`}
                defaultValue={state.values?.link ?? link ?? ""}
                className={`${inputClass} mt-1`}
              />
              <p id={`sucursal-resenas-ayuda-${id}`} className="mt-1 text-sm text-muted">
                Pegá el enlace que te da Google al pedir reseñas (g.page, Google Maps o search.google.com). Solo se aceptan direcciones de Google. Vacío
                lo quita.
              </p>
            </div>
            <div>
              <SubmitButton pendingLabel="Guardando…">Guardar enlace</SubmitButton>
            </div>
          </fieldset>
        )}
      </ActionForm>
    </details>
  );
}

/**
 * Zona horaria de la sucursal. Rige la hora de las promociones y de los pedidos; la facturación y los vencimientos siguen en hora
 * de Argentina. Solo se ofrecen las zonas de la lista (la base lo vuelve a comprobar).
 */
export function TimeZoneForm({
  orgSlug,
  id,
  name,
  timeZone,
  canWrite,
}: {
  orgSlug: string;
  id: string;
  name: string;
  timeZone: string;
  canWrite: boolean;
}) {
  return (
    <details>
      <summary className={`${summaryButtonClass} ${summaryExtras}`} aria-label={`Zona horaria de ${name}`}>
        Zona horaria
      </summary>
      <ActionForm action={setBranchTimeZoneAction} className="mt-3 max-w-md">
        {(state) => (
          <fieldset disabled={!canWrite} className="grid gap-3">
            <input type="hidden" name="org" value={orgSlug} />
            <input type="hidden" name="id" value={id} />
            <div>
              <label htmlFor={`sucursal-zona-${id}`} className={labelClass}>
                Zona horaria de la sucursal
              </label>
              <select
                id={`sucursal-zona-${id}`}
                name="timezone"
                defaultValue={state.values?.timezone ?? timeZone}
                aria-describedby={`sucursal-zona-ayuda-${id}`}
                className={`${inputClass} mt-1`}
              >
                {BRANCH_TIME_ZONES.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.label}
                  </option>
                ))}
              </select>
              <p id={`sucursal-zona-ayuda-${id}`} className="mt-1 text-sm text-muted">
                Es la hora con la que esta sucursal aplica sus promociones y toma sus pedidos. No cambia la facturación ni los vencimientos de
                tu cuenta, que siguen en hora de Argentina.
              </p>
            </div>
            <div>
              <SubmitButton pendingLabel="Guardando…">Guardar zona horaria</SubmitButton>
            </div>
          </fieldset>
        )}
      </ActionForm>
    </details>
  );
}

/**
 * Desactivar / reactivar. El mismo formulario sigue montado al cambiar el estado (así el aviso de la acción no se pierde al
 * refrescar la lista). Desactivar pide una confirmación que explica qué pasa; si es la última activa, avisa que el local
 * queda sin carta pública. Reactivar es un solo botón: si no hay cupo en el plan, la base lo rechaza y la pantalla lo explica.
 */
export function ToggleBranchActiveForm({
  orgSlug,
  id,
  name,
  isActive,
  isLastActive,
  canWrite,
}: {
  orgSlug: string;
  id: string;
  name: string;
  isActive: boolean;
  isLastActive: boolean;
  canWrite: boolean;
}) {
  return (
    <ActionForm action={setBranchActiveAction} className="max-w-md">
      {() => (
        <fieldset disabled={!canWrite} className="grid gap-3">
          <input type="hidden" name="org" value={orgSlug} />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="active" value={isActive ? "false" : "true"} />
          {isActive ? (
            <details>
              <summary className={`${summaryButtonClass} ${summaryExtras}`} aria-label={`Desactivar ${name}`}>
                Desactivar
              </summary>
              <div className="mt-3 grid gap-3">
                <p className="max-w-prose text-base" data-testid="aviso-desactivar">
                  {isLastActive
                    ? "Es la única sucursal activa: si la desactivás, tu local queda sin carta pública hasta que reactives una. "
                    : ""}
                  Su carta y los QR de sus mesas dirán «no disponible» y no se podrá llamar al mozo desde ellas. Las mesas y sus QR
                  se conservan, y la sucursal deja de contar para el tope de tu plan. Podés reactivarla cuando quieras.
                </p>
                <div>
                  <SubmitButton pendingLabel="Desactivando…">Sí, desactivar {name}</SubmitButton>
                </div>
              </div>
            </details>
          ) : (
            <div>
              <SubmitButton pendingLabel="Reactivando…">Reactivar</SubmitButton>
            </div>
          )}
        </fieldset>
      )}
    </ActionForm>
  );
}

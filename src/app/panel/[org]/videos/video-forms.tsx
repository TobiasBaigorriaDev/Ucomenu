"use client";

import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { dangerButtonClass, inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "@/components/panel/styles";
import { MAX_TITLE_LENGTH } from "@/lib/videos/estado";
import { deleteVideoAction, publishVideoAction, saveVideoAction } from "./actions";

const summaryClass = `${dangerButtonClass} cursor-pointer list-none [&::-webkit-details-marker]:hidden`;

type Product = { id: string; name: string };

/** Nombre del video y plato enlazado («Ver plato» en el feed). Un solo formulario por video. */
export function SaveVideoForm({
  orgSlug,
  id,
  title,
  productId,
  products,
  canWrite,
}: {
  orgSlug: string;
  id: string;
  title: string;
  productId: string | null;
  products: Product[];
  canWrite: boolean;
}) {
  return (
    <ActionForm action={saveVideoAction} className="grid gap-3 sm:max-w-xl">
      {(state) => (
        <fieldset disabled={!canWrite} className="grid min-w-0 gap-3">
          <input type="hidden" name="org" value={orgSlug} />
          <input type="hidden" name="id" value={id} />
          <div>
            <label htmlFor={`titulo-${id}`} className={labelClass}>
              Nombre del video
            </label>
            <input
              id={`titulo-${id}`}
              name="title"
              type="text"
              required
              maxLength={MAX_TITLE_LENGTH}
              autoComplete="off"
              defaultValue={state.values?.title ?? title}
              className={`${inputClass} mt-1`}
            />
          </div>
          <div>
            <label htmlFor={`plato-${id}`} className={labelClass}>
              Plato que muestra (opcional)
            </label>
            <select id={`plato-${id}`} name="product" defaultValue={state.values?.product ?? productId ?? ""} className={`${inputClass} mt-1`}>
              <option value="">Ninguno</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <SubmitButton pendingLabel="Guardando…" className={secondaryButtonClass}>
              Guardar
            </SubmitButton>
          </div>
        </fieldset>
      )}
    </ActionForm>
  );
}

/** Publicar o despublicar. Deshabilitado si no se puede (sin procesar, sin plan o con la cuenta en solo lectura). */
export function PublishVideoForm({
  orgSlug,
  id,
  title,
  published,
  enabled,
}: {
  orgSlug: string;
  id: string;
  title: string;
  published: boolean;
  enabled: boolean;
}) {
  return (
    <ActionForm action={publishVideoAction}>
      <fieldset disabled={!enabled} className="min-w-0">
        <input type="hidden" name="org" value={orgSlug} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="intent" value={published ? "unpublish" : "publish"} />
        <SubmitButton pendingLabel="Un momento…" className={published ? secondaryButtonClass : primaryButtonClass}>
          {published ? "Despublicar" : "Publicar"}
          <span className="sr-only"> {title}</span>
        </SubmitButton>
      </fieldset>
    </ActionForm>
  );
}

/**
 * Borrar es irreversible y se hace en dos pasos en la pantalla (el botón solo abre la explicación) y en dos pasos en el
 * servidor (el video deja de verse y después se borra del servicio de video). Un video en «Eliminando» ofrece reintentar.
 */
export function DeleteVideoForm({
  orgSlug,
  id,
  title,
  deleting,
  canWrite,
}: {
  orgSlug: string;
  id: string;
  title: string;
  deleting: boolean;
  canWrite: boolean;
}) {
  return (
    <details data-testid="borrar-video" open={deleting || undefined}>
      <summary className={summaryClass} aria-label={`${deleting ? "Reintentar el borrado de" : "Borrar"} ${title}`}>
        {deleting ? "Reintentar el borrado" : "Borrar video"}
      </summary>
      <ActionForm action={deleteVideoAction} className="mt-3 max-w-prose">
        <fieldset disabled={!canWrite} className="grid gap-3">
          <input type="hidden" name="org" value={orgSlug} />
          <input type="hidden" name="id" value={id} />
          <p className="text-base">
            {deleting ? (
              <>
                <strong className="[overflow-wrap:anywhere]">{title}</strong> ya no se ve, pero falta borrarlo del servicio de video. Reintentá para terminar.
              </>
            ) : (
              <>
                Vas a borrar <strong className="[overflow-wrap:anywhere]">{title}</strong> para siempre, también del servicio de video.{" "}
                <strong>No se puede deshacer.</strong> Si solo querés que no se vea, usá «Despublicar».
              </>
            )}
          </p>
          <div>
            <SubmitButton pendingLabel="Borrando…" className={dangerButtonClass}>
              {deleting ? "Reintentar" : "Sí, borrar el video definitivamente"}
            </SubmitButton>
          </div>
        </fieldset>
      </ActionForm>
    </details>
  );
}

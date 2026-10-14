"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { secondaryButtonClass } from "@/components/panel/styles";
import { rowAction } from "./actions";

const smallButton = `${secondaryButtonClass} min-w-11 px-3`;

type Props = {
  orgSlug: string;
  kind: "category" | "product";
  id: string;
  name: string;
  isActive: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** `false` con la cuenta en solo lectura o suspendida: los botones se deshabilitan (la base también lo impide). */
  canWrite: boolean;
};

/** Subir, bajar y activar/desactivar un elemento de la carta. Un solo formulario por fila. */
export function ItemControls(props: Props) {
  const [state, formAction] = useActionState(rowAction, {});

  return (
    <form action={formAction}>
      <input type="hidden" name="org" value={props.orgSlug} />
      <input type="hidden" name="kind" value={props.kind} />
      <input type="hidden" name="id" value={props.id} />
      <Buttons {...props} />
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

function Buttons({ name, isActive, canMoveUp, canMoveDown, canWrite }: Props) {
  const { pending } = useFormStatus();
  const off = !canWrite || pending;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="submit" name="intent" value="up" disabled={off || !canMoveUp} aria-label={`Subir ${name}`} className={smallButton}>
        <span aria-hidden>↑ </span>Subir
      </button>
      <button type="submit" name="intent" value="down" disabled={off || !canMoveDown} aria-label={`Bajar ${name}`} className={smallButton}>
        <span aria-hidden>↓ </span>Bajar
      </button>
      <button
        type="submit"
        name="intent"
        value={isActive ? "deactivate" : "activate"}
        disabled={off}
        aria-label={`${isActive ? "Desactivar" : "Activar"} ${name}`}
        className={smallButton}
      >
        {isActive ? "Desactivar" : "Activar"}
      </button>
    </div>
  );
}

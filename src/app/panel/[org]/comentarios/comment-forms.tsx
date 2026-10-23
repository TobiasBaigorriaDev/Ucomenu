"use client";

import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { dangerButtonClass, primaryButtonClass, secondaryButtonClass } from "@/components/panel/styles";
import { moderateCommentAction } from "./actions";

/**
 * Un botón de moderación. `approve` publica (o recupera uno rechazado); `reject` rechaza o retira. `enabled` apaga el botón cuando la
 * cuenta no permite aprobar: rechazar y retirar siempre quedan disponibles (la base también lo permite).
 */
export function ModerateCommentForm({
  orgSlug,
  id,
  intent,
  label,
  tone,
  enabled = true,
  accessibleSuffix,
}: {
  orgSlug: string;
  id: string;
  intent: "approve" | "reject";
  label: string;
  tone: "primary" | "secondary" | "danger";
  enabled?: boolean;
  /** Para lectores de pantalla: de qué comentario se trata (el botón visible solo dice «Aprobar»). */
  accessibleSuffix: string;
}) {
  const className = tone === "primary" ? primaryButtonClass : tone === "danger" ? dangerButtonClass : secondaryButtonClass;
  return (
    <ActionForm action={moderateCommentAction}>
      <fieldset disabled={!enabled} className="min-w-0">
        <input type="hidden" name="org" value={orgSlug} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="intent" value={intent} />
        <SubmitButton pendingLabel="Un momento…" className={className}>
          {label}
          <span className="sr-only"> {accessibleSuffix}</span>
        </SubmitButton>
      </fieldset>
    </ActionForm>
  );
}

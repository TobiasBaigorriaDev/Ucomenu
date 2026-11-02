"use client";

import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { confirmLinkAction } from "@/lib/registro/actions";
import type { LinkType } from "@/lib/registro/registro";

export function ConfirmForm({ tokenHash, type }: { tokenHash: string; type: LinkType }) {
  return (
    <ActionForm action={confirmLinkAction}>
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />
      <SubmitButton pendingLabel="Confirmando…">{type === "recovery" ? "Continuar" : "Confirmar"}</SubmitButton>
    </ActionForm>
  );
}

"use client";

import Image from "next/image";
import { useActionState, useEffect, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { dangerButtonClass, labelClass } from "@/components/panel/styles";
import type { FormState } from "@/lib/form-state";
import { MAX_LOGO_BYTES } from "@/lib/identidad/logos";
import { removeLogoAction, uploadLogoAction } from "./actions";

type Props = { orgSlug: string; canWrite: boolean; name: string };

export function LogoForm({ orgSlug, canWrite, name, currentUrl }: Props & { currentUrl: string | null }) {
  const [state, formAction] = useActionState(uploadLogoAction, {});
  const [picked, setPicked] = useState<{ url: string | null; error?: string; at: FormState } | null>(null);
  const current = picked?.at === state ? picked : null;
  useEffect(() => () => { if (picked?.url) URL.revokeObjectURL(picked.url); }, [picked, state]);
  return (
    <div className="mt-5 max-w-md">
      {currentUrl ? <Image src={currentUrl} alt={`Logo actual de ${name}`} width={240} height={144} unoptimized className="h-36 w-60 max-w-full rounded-2xl border border-ink/15 object-contain p-3" /> : <p className="text-base text-muted">Todavía no agregaste un logo. La carta muestra el nombre del local.</p>}
      <form action={formAction} className="mt-4">
        <fieldset disabled={!canWrite} className="grid gap-3">
          <input type="hidden" name="org" value={orgSlug} />
          <label htmlFor="archivo-logo" className={labelClass}>{currentUrl ? "Reemplazar el logo" : "Elegir un logo"}</label>
          <input id="archivo-logo" name="logo" type="file" accept="image/jpeg,image/png,image/webp" required aria-describedby="logo-ayuda"
            className="block min-h-11 w-full text-base file:mr-3 file:min-h-11 file:rounded-full file:border file:border-ink/40 file:bg-transparent file:px-4 file:text-base"
            onChange={event => {
              const file = event.currentTarget.files?.[0];
              if (!file) return setPicked(null);
              if (file.size > MAX_LOGO_BYTES) {
                event.currentTarget.value = "";
                return setPicked({ url: null, error: "El logo supera los 2 MB. Elegí un archivo más liviano.", at: state });
              }
              setPicked({ url: URL.createObjectURL(file), at: state });
            }} />
          <p id="logo-ayuda" className="text-sm text-muted">Elegí el archivo y tocá «Guardar logo» para publicarlo.</p>
          {current?.url ? <Image src={current.url} alt="Vista previa del logo elegido" width={240} height={144} unoptimized className="h-36 w-60 max-w-full object-contain" /> : null}
          {current?.error ? <p role="alert" className="font-medium text-danger">{current.error}</p> : null}
          <div><SubmitButton pendingLabel="Subiendo…">Guardar logo</SubmitButton></div>
        </fieldset>
        {state.error ? <p role="alert" className="mt-3 font-medium text-danger">{state.error}</p> : null}
        {state.message ? <p role="status" className="mt-3 font-medium">{state.message}</p> : null}
      </form>
      <ActionForm action={removeLogoAction} className="mt-3">
        <fieldset disabled={!canWrite || !currentUrl}>
          <input type="hidden" name="org" value={orgSlug} />
          <SubmitButton className={dangerButtonClass} pendingLabel="Quitando…">Quitar logo</SubmitButton>
        </fieldset>
      </ActionForm>
    </div>
  );
}

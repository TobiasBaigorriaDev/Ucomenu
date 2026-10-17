"use client";

import Image from "next/image";
import { useActionState, useEffect, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { dangerButtonClass, labelClass } from "@/components/panel/styles";
import type { FormState } from "@/lib/form-state";
import { MAX_LOGO_BYTES } from "@/lib/identidad/logos";
import { isPalette, PALETTES, paletteStyle } from "@/lib/identidad/palettes";
import "@/components/menu/carta.css";
import { cartaFontClass } from "@/components/menu/carta-fonts";
import { paletteAction, removeLogoAction, uploadLogoAction } from "./actions";

type Props = { orgSlug: string; canWrite: boolean; name: string };

export function PaletteForm({ orgSlug, canWrite, name, palette }: Props & { palette: string }) {
  const [selected, setSelected] = useState(isPalette(palette) ? palette : "oliva");
  return (
    <ActionForm action={paletteAction} className="mt-5">
      <fieldset disabled={!canWrite}>
        <legend className="sr-only">Paleta de colores</legend>
        <input type="hidden" name="org" value={orgSlug} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.entries(PALETTES).map(([key, p]) => (
            <label key={key} className="flex min-h-16 cursor-pointer items-center gap-3 rounded-md border border-ink/30 px-3 py-3 has-checked:border-cobalt has-checked:bg-tile/40 has-disabled:cursor-default has-disabled:opacity-60">
              <input type="radio" name="palette" value={key} checked={selected === key} onChange={() => setSelected(key as typeof selected)} className="size-4 shrink-0 accent-cobalt" />
              <span className="min-w-0">
                <span className="block font-medium">{p.name}</span>
                <span aria-hidden="true" className="mt-1 flex gap-1">
                  {[p.accent, p.blush, p.sand].map(color => <span key={color} className="size-3 rounded-full border border-black/10" style={{ background: color }} />)}
                </span>
              </span>
            </label>
          ))}
        </div>
        <div className={`${cartaFontClass} carta mt-5 rounded-xl px-5 py-6`} style={{ ...paletteStyle(selected), minHeight: 0 }} data-testid="apariencia-preview">
          <p className="font-display text-3xl break-words text-[var(--carta-green)]">{name}</p>
          <p className="mt-2 text-base text-muted">Así se verá la paleta en tu carta.</p>
          <span className="mt-4 inline-block rounded-full bg-[var(--carta-green)] px-4 py-2 text-base font-medium text-white">Carta del local</span>
        </div>
        <div className="mt-4"><SubmitButton pendingLabel="Guardando…">Guardar colores</SubmitButton></div>
      </fieldset>
    </ActionForm>
  );
}

export function LogoForm({ orgSlug, canWrite, name, currentUrl }: Props & { currentUrl: string | null }) {
  const [state, formAction] = useActionState(uploadLogoAction, {});
  const [picked, setPicked] = useState<{ url: string | null; error?: string; at: FormState } | null>(null);
  const current = picked?.at === state ? picked : null;
  useEffect(() => () => { if (picked?.url) URL.revokeObjectURL(picked.url); }, [picked, state]);
  return (
    <div className="mt-5 max-w-md">
      {currentUrl ? <Image src={currentUrl} alt={`Logo actual de ${name}`} width={240} height={144} unoptimized className="h-36 w-60 max-w-full rounded-md border border-ink/15 object-contain p-3" /> : <p className="text-base text-muted">Todavía no agregaste un logo. La carta muestra el nombre del local.</p>}
      <form action={formAction} className="mt-4">
        <fieldset disabled={!canWrite} className="grid gap-3">
          <input type="hidden" name="org" value={orgSlug} />
          <label htmlFor="archivo-logo" className={labelClass}>{currentUrl ? "Reemplazar el logo" : "Elegir un logo"}</label>
          <input id="archivo-logo" name="logo" type="file" accept="image/jpeg,image/png,image/webp" required aria-describedby="logo-ayuda"
            className="block min-h-11 w-full text-base file:mr-3 file:min-h-11 file:rounded-md file:border file:border-ink/40 file:bg-transparent file:px-4 file:text-base"
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

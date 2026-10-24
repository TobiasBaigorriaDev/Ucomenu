"use client";

import Image from "next/image";
import { useActionState, useEffect, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { dangerButtonClass, inputClass, labelClass } from "@/components/panel/styles";
import type { FormState } from "@/lib/form-state";
import { MAX_LOGO_BYTES } from "@/lib/identidad/logos";
import { isLayout, LAYOUT_KEYS, LAYOUTS, type Layout } from "@/lib/identidad/layouts";
import { isPalette, PALETTE_KEYS, PALETTES } from "@/lib/identidad/palettes";
import { isTheme, NO_THEME, THEME_KEYS, THEMES, type Theme, type ThemeStatus } from "@/lib/identidad/temas";
import { layoutAction, paletteAction, removeLogoAction, themeAction, uploadLogoAction } from "./actions";
import { CartaPreview } from "./carta-preview";

type Props = { orgSlug: string; canWrite: boolean; name: string };

const GROUPS = [
  { scheme: "light", title: "Claras" },
  { scheme: "dark", title: "Oscuras" },
] as const;

export function PaletteForm({ orgSlug, canWrite, name, palette, logo, layout }: Props & { palette: string; logo: string | null; layout: Layout }) {
  const [selected, setSelected] = useState(isPalette(palette) ? palette : "oliva");
  return (
    <ActionForm action={paletteAction} className="mt-5">
      <fieldset disabled={!canWrite} className="min-w-0">
        <legend className="sr-only">Paleta de colores</legend>
        <input type="hidden" name="org" value={orgSlug} />
        {GROUPS.map(group => (
          <div key={group.scheme} className="mt-4 first:mt-0">
            <p className="mb-2 text-sm font-medium text-muted">{group.title}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {PALETTE_KEYS.filter(key => PALETTES[key].scheme === group.scheme).map(key => {
                const p = PALETTES[key];
                return (
                  <label key={key} className="flex min-h-16 cursor-pointer items-center gap-3 rounded-2xl border border-ink/30 px-3 py-3 has-checked:border-cobalt has-checked:bg-tile/40 has-disabled:cursor-default has-disabled:opacity-60">
                    <input type="radio" name="palette" value={key} checked={selected === key} onChange={() => setSelected(key)} className="size-4 shrink-0 accent-cobalt" />
                    <span className="min-w-0">
                      <span className="block font-medium">{p.name}</span>
                      <span aria-hidden="true" className="mt-1 flex gap-1">
                        {[p.background, p.accent, p.terra, p.blush].map(color => <span key={color} className="size-3 rounded-full border border-ink/30" style={{ background: color }} />)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
        <p className="mt-5 text-sm text-muted">Así se verá tu carta con la paleta elegida (con platos de ejemplo).</p>
        <CartaPreview name={name} logo={logo} palette={selected} layout={layout} testId="apariencia-preview" />
        <div className="mt-4"><SubmitButton pendingLabel="Guardando…">Guardar colores</SubmitButton></div>
      </fieldset>
    </ActionForm>
  );
}

export function LayoutForm({ orgSlug, canWrite, name, palette, logo, layout }: Props & { palette: string; logo: string | null; layout: string }) {
  const [selected, setSelected] = useState<Layout>(isLayout(layout) ? layout : "bento");
  return (
    <ActionForm action={layoutAction} className="mt-5">
      <fieldset disabled={!canWrite} className="min-w-0">
        <legend className="sr-only">Estilo de la carta</legend>
        <input type="hidden" name="org" value={orgSlug} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {LAYOUT_KEYS.map(key => (
            <label key={key} className="flex cursor-pointer items-start gap-3 rounded-2xl border border-ink/30 px-3 py-3 has-checked:border-cobalt has-checked:bg-tile/40 has-disabled:cursor-default has-disabled:opacity-60">
              <input type="radio" name="layout" value={key} checked={selected === key} onChange={() => setSelected(key)} className="mt-1 size-4 shrink-0 accent-cobalt" />
              <span className="min-w-0">
                <span className="block font-medium">{LAYOUTS[key].name}</span>
                <span className="mt-1 block text-sm text-muted">{LAYOUTS[key].description}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="mt-5 text-sm text-muted">Así se verá tu carta con el estilo elegido (con platos de ejemplo).</p>
        <CartaPreview name={name} logo={logo} palette={isPalette(palette) ? palette : "oliva"} layout={selected} testId="apariencia-preview-estilo" />
        <div className="mt-4"><SubmitButton pendingLabel="Guardando…">Guardar estilo</SubmitButton></div>
      </fieldset>
    </ActionForm>
  );
}

const longDay = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const dayText = (day: string) => longDay.format(new Date(`${day}T00:00:00Z`));

/** El estado del tema en palabras, tal como lo ve hoy el comensal. */
function statusText(status: ThemeStatus): string {
  switch (status.kind) {
    case "none": return "Sin tema: la carta se ve normal.";
    case "active": return `${THEMES[status.theme].name}: activo hoy${status.until ? `, hasta el ${dayText(status.until)}` : ", hasta que lo apagues"}.`;
    case "scheduled": return `${THEMES[status.theme].name}: programado desde el ${dayText(status.from)}. Hoy la carta se ve normal.`;
    case "expired": return `${THEMES[status.theme].name}: venció el ${dayText(status.until)}. Hoy la carta se ve normal.`;
  }
}

export function ThemeForm({ orgSlug, canWrite, name, palette, logo, layout, theme, from, until, status }: Props & { palette: string; logo: string | null; layout: string; theme: string; from: string | null; until: string | null; status: ThemeStatus }) {
  const [selected, setSelected] = useState<Theme | typeof NO_THEME>(isTheme(theme) ? theme : NO_THEME);
  const [start, setStart] = useState(from ?? "");
  const [end, setEnd] = useState(until ?? "");
  const wrongOrder = Boolean(start && end && end < start);
  return (
    <ActionForm action={themeAction} className="mt-5">
      <fieldset disabled={!canWrite} className="min-w-0">
        <legend className="sr-only">Fecha especial</legend>
        <input type="hidden" name="org" value={orgSlug} />
        <p data-testid="tema-estado" className="font-medium">{statusText(status)}</p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[NO_THEME, ...THEME_KEYS].map(key => (
            <label key={key} className="flex min-h-16 cursor-pointer items-start gap-3 rounded-2xl border border-ink/30 px-3 py-3 has-checked:border-cobalt has-checked:bg-tile/40 has-disabled:cursor-default has-disabled:opacity-60">
              <input type="radio" name="theme" value={key} checked={selected === key} onChange={() => setSelected(key as Theme | typeof NO_THEME)} className="mt-1 size-4 shrink-0 accent-cobalt" />
              <span className="min-w-0">
                <span className="block font-medium">{key === NO_THEME ? "Ninguno" : THEMES[key as Theme].name}</span>
                <span className="mt-0.5 block text-sm text-muted">{key === NO_THEME ? "La carta normal" : THEMES[key as Theme].when}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="mt-5 grid max-w-md gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="tema-desde" className={labelClass}>Desde (opcional)</label>
            <input id="tema-desde" name="from" type="date" value={selected === NO_THEME ? "" : start} onChange={event => setStart(event.target.value)} disabled={selected === NO_THEME} className={`${inputClass} mt-1`} />
          </div>
          <div>
            <label htmlFor="tema-hasta" className={labelClass}>Hasta (opcional)</label>
            <input id="tema-hasta" name="until" type="date" value={selected === NO_THEME ? "" : end} onChange={event => setEnd(event.target.value)} disabled={selected === NO_THEME} aria-invalid={wrongOrder} aria-describedby="tema-ayuda" className={`${inputClass} mt-1`} />
          </div>
        </div>
        <p id="tema-ayuda" className={`mt-2 text-sm ${wrongOrder ? "font-medium text-danger" : "text-muted"}`}>
          {wrongOrder ? "«Hasta» no puede ser anterior a «Desde»." : "Dentro de esas fechas (inclusive, hora de Argentina) se ve el tema y después la carta vuelve sola a la normal. Sin fechas, queda activo hasta que lo apagues."}
        </p>
        <p className="mt-5 text-sm text-muted">Así se verá tu carta con la fecha elegida (con platos de ejemplo).</p>
        <CartaPreview name={name} logo={logo} palette={isPalette(palette) ? palette : "oliva"} layout={isLayout(layout) ? layout : "bento"} theme={isTheme(selected) ? selected : null} testId="apariencia-preview-tema" />
        <div className="mt-4"><SubmitButton pendingLabel="Guardando…">Guardar fecha especial</SubmitButton></div>
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

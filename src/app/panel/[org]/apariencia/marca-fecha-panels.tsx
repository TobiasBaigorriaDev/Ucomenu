"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { dangerButtonClass, inputClass, labelClass } from "@/components/panel/styles";
import type { FormState } from "@/lib/form-state";
import { MAX_LOGO_BYTES } from "@/lib/identidad/logos";
import { isTheme, NO_THEME, THEME_KEYS, THEMES, type Theme, type ThemeStatus } from "@/lib/identidad/temas";
import { HOURS_MAX, TAGLINE_MAX } from "@/lib/identidad/voz";
import { removeCoverAction, themeAction, uploadCoverAction, voiceAction } from "./actions";
import { LogoForm } from "./appearance-forms";

// Paneles de las pestañas «Marca» y «Fechas especiales». Lo que se escribe o se elige acá alimenta la vista previa única del estudio
// (`AparienciaStudio`) antes de guardarse; cada formulario guarda lo suyo con su propio botón.

export type VoiceDraft = { tagline: string; hours: string; instagram: string; whatsapp: string };

/** Portada: una foto de ambiente que encabeza la carta. La foto elegida se ve en la vista previa ANTES de guardarla (`onPick`). */
function CoverForm({ orgSlug, canWrite, currentUrl, layout, onPick }: { orgSlug: string; canWrite: boolean; currentUrl: string | null; layout: string; onPick: (url: string | null) => void }) {
  const [state, formAction] = useActionState(uploadCoverAction, {});
  const [picked, setPicked] = useState<{ url: string | null; error?: string; at: FormState } | null>(null);
  const current = picked?.at === state ? picked : null;
  const pickedUrl = current?.url ?? null;
  useEffect(() => {
    onPick(pickedUrl);
  }, [pickedUrl, onPick]);
  useEffect(() => () => { if (picked?.url) URL.revokeObjectURL(picked.url); }, [picked, state]);
  return (
    <div className="max-w-xl">
      <form action={formAction}>
        <fieldset disabled={!canWrite} className="grid gap-3">
          <input type="hidden" name="org" value={orgSlug} />
          <label htmlFor="archivo-portada" className={labelClass}>{currentUrl ? "Reemplazar la portada" : "Elegir una foto de portada"}</label>
          <input id="archivo-portada" name="cover" type="file" accept="image/jpeg,image/png,image/webp" required aria-describedby="portada-ayuda"
            className="block min-h-11 w-full text-base file:mr-3 file:min-h-11 file:rounded-full file:border file:border-ink/40 file:bg-transparent file:px-4 file:text-base"
            onChange={event => {
              const file = event.currentTarget.files?.[0];
              if (!file) return setPicked(null);
              if (file.size > MAX_LOGO_BYTES) {
                event.currentTarget.value = "";
                return setPicked({ url: null, error: "La portada supera los 2 MB. Elegí un archivo más liviano.", at: state });
              }
              setPicked({ url: URL.createObjectURL(file), at: state });
            }} />
          <p id="portada-ayuda" className="text-sm text-muted">Una foto horizontal de tu salón, tu barra o tu fachada. PNG, JPEG o WebP, hasta 2 MB. Se recorta al centro en formato 16:9 y va arriba de la carta, sin texto encima, para que el nombre siempre se lea bien. Elegí el archivo, mirá la vista previa y tocá «Guardar portada».</p>
          {current?.error ? <p role="alert" className="font-medium text-danger">{current.error}</p> : null}
          <div><SubmitButton pendingLabel="Subiendo…">Guardar portada</SubmitButton></div>
        </fieldset>
        {state.error ? <p role="alert" className="mt-3 font-medium text-danger">{state.error}</p> : null}
        {state.message ? <p role="status" className="mt-3 font-medium">{state.message}</p> : null}
      </form>
      {layout === "hoja" ? <p data-testid="portada-hoja" className="mt-4 text-sm font-medium">Tu carta usa el estilo Hoja, que se muestra como una página de PDF y no lleva portada. La foto se guarda y aparece apenas elijas otro estilo.</p> : null}
      <ActionForm action={removeCoverAction} className="mt-3">
        <fieldset disabled={!canWrite || !currentUrl}>
          <input type="hidden" name="org" value={orgSlug} />
          <SubmitButton className={dangerButtonClass} pendingLabel="Quitando…">Quitar portada</SubmitButton>
        </fieldset>
      </ActionForm>
    </div>
  );
}

function Card({ id, title, children, intro }: { id: string; title: string; intro: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="panel-cell">
      <h3 id={id} className="font-display text-xl">{title}</h3>
      <p className="mt-1 text-sm text-muted">{intro}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Pestaña «Marca»: logo, portada y los datos públicos del local. */
export function BrandPanel(props: {
  orgSlug: string; name: string; canWrite: boolean; logoUrl: string | null; coverUrl: string | null; layout: string;
  voice: VoiceDraft; onVoice: (patch: Partial<VoiceDraft>) => void; onCoverPick: (url: string | null) => void;
}) {
  const { orgSlug, canWrite, voice, onVoice } = props;
  return (
    <div className="grid gap-6">
      <Card id="logo" title="Logo del local" intro="Se muestra completo, junto al nombre del local. PNG, JPEG o WebP, hasta 2 MB. Si tiene fondo transparente, se conserva.">
        <LogoForm orgSlug={orgSlug} name={props.name} currentUrl={props.logoUrl} canWrite={canWrite} />
      </Card>
      <Card id="portada" title="Portada" intro="Una foto de ambiente arriba de tu carta. Es opcional: sin foto, la carta se ve como siempre.">
        <CoverForm orgSlug={orgSlug} canWrite={canWrite} currentUrl={props.coverUrl} layout={props.layout} onPick={props.onCoverPick} />
      </Card>
      <Card id="datos" title="Datos del local" intro="Un lema, tus horarios y tus redes para que la carta hable de tu local. Todo es opcional.">
        <ActionForm action={voiceAction}>
          <fieldset disabled={!canWrite} className="grid min-w-0 max-w-xl gap-4">
            <legend className="sr-only">Datos del local</legend>
            <input type="hidden" name="org" value={orgSlug} />
            <div>
              <label htmlFor="voz-lema" className={labelClass}>Lema (opcional)</label>
              <input id="voz-lema" name="tagline" type="text" maxLength={TAGLINE_MAX} value={voice.tagline} onChange={event => onVoice({ tagline: event.target.value })} placeholder="Café de especialidad desde 2014" className={`${inputClass} mt-1`} />
              <p className="mt-1 text-sm text-muted">Aparece bajo el nombre. Hasta {TAGLINE_MAX} caracteres, tal como lo escribas (no se traduce).</p>
            </div>
            <div>
              <label htmlFor="voz-horarios" className={labelClass}>Horarios (opcional)</label>
              <input id="voz-horarios" name="hours" type="text" maxLength={HOURS_MAX} value={voice.hours} onChange={event => onVoice({ hours: event.target.value })} placeholder="Lun a sáb de 8 a 20 hs · Dom cerrado" className={`${inputClass} mt-1`} />
              <p className="mt-1 text-sm text-muted">Una sola línea, la misma para todas tus sucursales. Va al pie de la carta.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="voz-instagram" className={labelClass}>Instagram (opcional)</label>
                <input id="voz-instagram" name="instagram" type="text" value={voice.instagram} onChange={event => onVoice({ instagram: event.target.value })} placeholder="@milocal" autoCapitalize="none" className={`${inputClass} mt-1`} />
              </div>
              <div>
                <label htmlFor="voz-whatsapp" className={labelClass}>WhatsApp (opcional)</label>
                <input id="voz-whatsapp" name="whatsapp" type="tel" value={voice.whatsapp} onChange={event => onVoice({ whatsapp: event.target.value })} placeholder="+54 9 11 1234-5678" className={`${inputClass} mt-1`} />
              </div>
            </div>
            <p className="text-sm text-muted">Todo esto es público: lo ve cualquiera que abra tu carta. Usá el Instagram y el WhatsApp del local, no teléfonos personales. Dejá un campo vacío para quitarlo. El lema, Instagram y WhatsApp van arriba de la carta; los horarios, al pie.</p>
            <div><SubmitButton pendingLabel="Guardando…">Guardar datos del local</SubmitButton></div>
          </fieldset>
        </ActionForm>
      </Card>
    </div>
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

export type ThemeDraft = { selected: Theme | typeof NO_THEME; start: string; end: string };

/** Pestaña «Fechas especiales»: tema de fecha con su ventana. */
export function DatesPanel({ orgSlug, canWrite, draft, onDraft, saved, status }: {
  orgSlug: string; canWrite: boolean; draft: ThemeDraft; onDraft: (patch: Partial<ThemeDraft>) => void; saved: { theme: string; from: string | null; until: string | null }; status: ThemeStatus;
}) {
  const wrongOrder = Boolean(draft.start && draft.end && draft.end < draft.start);
  return (
    <section aria-labelledby="fecha-especial" className="panel-cell">
      <h3 id="fecha-especial" className="font-display text-xl">Fecha especial</h3>
      <p className="mt-1 text-sm text-muted">Un detalle opcional para San Valentín, Navidad, Halloween y otras fechas: un patrón suave de fondo, un saludo y adornos. No cambia tus colores ni tus platos.</p>
      <ActionForm action={themeAction} className="mt-4">
        <fieldset disabled={!canWrite} className="min-w-0">
          <legend className="sr-only">Fecha especial</legend>
          <input type="hidden" name="org" value={orgSlug} />
          <p data-testid="tema-estado" className="font-medium">{statusText(status)}</p>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {[NO_THEME, ...THEME_KEYS].map(key => (
              <label key={key} className="flex min-h-16 cursor-pointer items-start gap-3 rounded-2xl border border-ink/30 px-3 py-3 has-checked:border-cobalt has-checked:bg-tile/40 has-disabled:cursor-default has-disabled:opacity-60">
                <input key={`${key}:${saved.theme}`} type="radio" name="theme" value={key} checked={draft.selected === key} onChange={() => onDraft({ selected: key as Theme | typeof NO_THEME })} className="mt-1 size-4 shrink-0 accent-cobalt" />
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
              <input key={`desde:${saved.from}`} id="tema-desde" name="from" type="date" value={draft.selected === NO_THEME ? "" : draft.start} onChange={event => onDraft({ start: event.target.value })} disabled={draft.selected === NO_THEME} className={`${inputClass} mt-1`} />
            </div>
            <div>
              <label htmlFor="tema-hasta" className={labelClass}>Hasta (opcional)</label>
              <input key={`hasta:${saved.until}`} id="tema-hasta" name="until" type="date" value={draft.selected === NO_THEME ? "" : draft.end} onChange={event => onDraft({ end: event.target.value })} disabled={draft.selected === NO_THEME} aria-invalid={wrongOrder} aria-describedby="tema-ayuda" className={`${inputClass} mt-1`} />
            </div>
          </div>
          <p id="tema-ayuda" className={`mt-2 text-sm ${wrongOrder ? "font-medium text-danger" : "text-muted"}`}>
            {wrongOrder ? "«Hasta» no puede ser anterior a «Desde»." : "Dentro de esas fechas (inclusive, hora de Argentina) se ve el tema y después la carta vuelve sola a la normal. Sin fechas, queda activo hasta que lo apagues."}
          </p>
          <div className="mt-4"><SubmitButton pendingLabel="Guardando…">Guardar fecha especial</SubmitButton></div>
        </fieldset>
      </ActionForm>
    </section>
  );
}

export const themeFrom = (theme: string): Theme | typeof NO_THEME => (isTheme(theme) ? theme : NO_THEME);

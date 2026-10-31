"use client";

import { useActionState, useEffect, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { dangerButtonClass, inputClass, labelClass } from "@/components/panel/styles";
import type { FormState } from "@/lib/form-state";
import { AMBIENT_KEYS, AMBIENTS, isAmbient, type Ambient } from "@/lib/identidad/ambientes";
import type { Look } from "@/lib/identidad/apariencia";
import { DENSITIES, DENSITY_KEYS, SHAPES, SHAPE_KEYS, type Density, type Shape } from "@/lib/identidad/formas";
import { isLayout, type Layout } from "@/lib/identidad/layouts";
import { MAX_LOGO_BYTES } from "@/lib/identidad/logos";
import { isPalette } from "@/lib/identidad/palettes";
import { FONT_KEYS, FONTS, type Font } from "@/lib/identidad/tipografias";
import { HOURS_MAX, TAGLINE_MAX, type Voice } from "@/lib/identidad/voz";
import { ambientAction, fontAction, removeCoverAction, shapeAction, uploadCoverAction, voiceAction } from "./actions";
import { CartaPreview } from "./carta-preview";

// Formularios de la personalización ampliada (ADR 0050): tipografía, forma y densidad, ambientación y datos del local.
// Cada uno guarda por separado y muestra la vista previa real de la carta con lo que está eligiendo.

type Props = { orgSlug: string; canWrite: boolean; name: string; palette: string; logo: string | null; layout: string; look: Look };
type Option = { key: string; name: string; description: string };

const optionClass = "flex min-h-16 cursor-pointer items-start gap-3 rounded-2xl border border-ink/30 px-3 py-3 has-checked:border-cobalt has-checked:bg-tile/40 has-disabled:cursor-default has-disabled:opacity-60";

/** Opciones excluyentes (radio) con nombre y descripción; la selección la controla el formulario que lo usa. */
function OptionGroup({ legend, field, options, value, onChange, saved }: { legend: string; field: string; options: Option[]; value: string; onChange: (key: string) => void; saved: string }) {
  return (
    <fieldset className="mt-4 min-w-0 first:mt-0">
      <legend className="mb-2 text-sm font-medium text-muted">{legend}</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {options.map(option => (
          <label key={option.key} className={optionClass}>
            <input key={`${option.key}:${saved}`} type="radio" name={field} value={option.key} checked={value === option.key} onChange={() => onChange(option.key)} className="mt-1 size-4 shrink-0 accent-cobalt" />
            <span className="min-w-0">
              <span className="block font-medium">{option.name}</span>
              <span className="mt-0.5 block text-sm text-muted">{option.description}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const previewBase = (p: Props) => ({ name: p.name, logo: p.logo, palette: isPalette(p.palette) ? p.palette : "oliva", layout: (isLayout(p.layout) ? p.layout : "bento") as Layout });

export function FontForm(props: Props) {
  const [selected, setSelected] = useState<Font>(props.look.font);
  return (
    <ActionForm action={fontAction} className="mt-5">
      <fieldset disabled={!props.canWrite} className="min-w-0">
        <legend className="sr-only">Tipografía de la carta</legend>
        <input type="hidden" name="org" value={props.orgSlug} />
        <OptionGroup legend="Voz de los títulos" field="font" options={FONT_KEYS.map(key => ({ key, name: FONTS[key].name, description: FONTS[key].description }))} value={selected} onChange={key => setSelected(key as Font)} saved={props.look.font} />
        <p className="mt-5 text-sm text-muted">Así se verá tu carta con la tipografía elegida. Cambia solo los títulos: las descripciones y los precios mantienen su letra legible.</p>
        <CartaPreview {...previewBase(props)} look={{ ...props.look, font: selected }} testId="apariencia-preview-fuente" />
        <div className="mt-4"><SubmitButton pendingLabel="Guardando…">Guardar tipografía</SubmitButton></div>
      </fieldset>
    </ActionForm>
  );
}

export function ShapeForm(props: Props) {
  const [shape, setShape] = useState<Shape>(props.look.shape);
  const [density, setDensity] = useState<Density>(props.look.density);
  return (
    <ActionForm action={shapeAction} className="mt-5">
      <fieldset disabled={!props.canWrite} className="min-w-0">
        <legend className="sr-only">Forma y densidad de la carta</legend>
        <input type="hidden" name="org" value={props.orgSlug} />
        <OptionGroup legend="Esquinas y bordes" field="shape" options={SHAPE_KEYS.map(key => ({ key, name: SHAPES[key].name, description: SHAPES[key].description }))} value={shape} onChange={key => setShape(key as Shape)} saved={props.look.shape} />
        <OptionGroup legend="Espacio entre elementos" field="density" options={DENSITY_KEYS.map(key => ({ key, name: DENSITIES[key].name, description: DENSITIES[key].description }))} value={density} onChange={key => setDensity(key as Density)} saved={props.look.density} />
        <p className="mt-5 text-sm text-muted">Los colores no cambian. El estilo Afiche conserva sus esquinas rectas.</p>
        <CartaPreview {...previewBase(props)} look={{ ...props.look, shape, density }} testId="apariencia-preview-forma" />
        <div className="mt-4"><SubmitButton pendingLabel="Guardando…">Guardar forma</SubmitButton></div>
      </fieldset>
    </ActionForm>
  );
}

export function AmbientForm(props: Props) {
  const [selected, setSelected] = useState<Ambient>(isAmbient(props.look.ambient) ? props.look.ambient : "ninguno");
  return (
    <ActionForm action={ambientAction} className="mt-5">
      <fieldset disabled={!props.canWrite} className="min-w-0">
        <legend className="sr-only">Ambientación de la carta</legend>
        <input type="hidden" name="org" value={props.orgSlug} />
        <OptionGroup legend="Textura de fondo y adornos del pie" field="ambient" options={AMBIENT_KEYS.map(key => ({ key, name: AMBIENTS[key].name, description: AMBIENTS[key].description }))} value={selected} onChange={key => setSelected(key as Ambient)} saved={props.look.ambient} />
        <p className="mt-5 text-sm text-muted">La textura es muy suave para no molestar la lectura. Si activás una fecha especial, esa decoración reemplaza a la textura mientras dure.</p>
        <CartaPreview {...previewBase(props)} look={{ ...props.look, ambient: selected }} testId="apariencia-preview-ambiente" />
        <div className="mt-4"><SubmitButton pendingLabel="Guardando…">Guardar ambientación</SubmitButton></div>
      </fieldset>
    </ActionForm>
  );
}

export function VoiceForm(props: Props & { voice: Voice }) {
  const [tagline, setTagline] = useState(props.voice.tagline ?? "");
  return (
    <ActionForm action={voiceAction} className="mt-5">
      <fieldset disabled={!props.canWrite} className="grid min-w-0 max-w-xl gap-4">
        <legend className="sr-only">Datos del local</legend>
        <input type="hidden" name="org" value={props.orgSlug} />
        <div>
          <label htmlFor="voz-lema" className={labelClass}>Lema (opcional)</label>
          <input id="voz-lema" name="tagline" type="text" maxLength={TAGLINE_MAX} defaultValue={props.voice.tagline ?? ""} onChange={event => setTagline(event.target.value)} placeholder="Café de especialidad desde 2014" className={`${inputClass} mt-1`} />
          <p className="mt-1 text-sm text-muted">Aparece bajo el nombre. Hasta {TAGLINE_MAX} caracteres, tal como lo escribas (no se traduce).</p>
        </div>
        <div>
          <label htmlFor="voz-horarios" className={labelClass}>Horarios (opcional)</label>
          <input id="voz-horarios" name="hours" type="text" maxLength={HOURS_MAX} defaultValue={props.voice.hours ?? ""} placeholder="Lun a sáb de 8 a 20 hs · Dom cerrado" className={`${inputClass} mt-1`} />
          <p className="mt-1 text-sm text-muted">Una sola línea, la misma para todas tus sucursales. Va al pie de la carta.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="voz-instagram" className={labelClass}>Instagram (opcional)</label>
            <input id="voz-instagram" name="instagram" type="text" defaultValue={props.voice.instagram ? `@${props.voice.instagram}` : ""} placeholder="@milocal" autoCapitalize="none" className={`${inputClass} mt-1`} />
          </div>
          <div>
            <label htmlFor="voz-whatsapp" className={labelClass}>WhatsApp (opcional)</label>
            <input id="voz-whatsapp" name="whatsapp" type="tel" defaultValue={props.voice.whatsapp ? `+${props.voice.whatsapp}` : ""} placeholder="+54 9 11 1234-5678" className={`${inputClass} mt-1`} />
          </div>
        </div>
        <p className="text-sm text-muted">Todo esto es público: lo ve cualquiera que abra tu carta. Usá el Instagram y el WhatsApp del local, no teléfonos personales. Dejá un campo vacío para quitarlo.</p>
        <div>
          <p className="mb-1 text-sm text-muted">Así se verá el lema en tu carta (con platos de ejemplo).</p>
          <CartaPreview {...previewBase(props)} look={props.look} tagline={tagline.trim() || null} testId="apariencia-preview-voz" />
        </div>
        <div><SubmitButton pendingLabel="Guardando…">Guardar datos del local</SubmitButton></div>
      </fieldset>
    </ActionForm>
  );
}

/** Portada: una foto de ambiente que encabeza la carta. La vista previa muestra la foto elegida ANTES de guardarla. */
export function CoverForm(props: Props & { currentUrl: string | null }) {
  const [state, formAction] = useActionState(uploadCoverAction, {});
  const [picked, setPicked] = useState<{ url: string | null; error?: string; at: FormState } | null>(null);
  const current = picked?.at === state ? picked : null;
  useEffect(() => () => { if (picked?.url) URL.revokeObjectURL(picked.url); }, [picked, state]);
  return (
    <div className="mt-5">
      <form action={formAction} className="max-w-xl">
        <fieldset disabled={!props.canWrite} className="grid gap-3">
          <input type="hidden" name="org" value={props.orgSlug} />
          <label htmlFor="archivo-portada" className={labelClass}>{props.currentUrl ? "Reemplazar la portada" : "Elegir una foto de portada"}</label>
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
          <p id="portada-ayuda" className="text-sm text-muted">Una foto horizontal de tu salón, tu barra o tu fachada. PNG, JPEG o WebP, hasta 2 MB. Se recorta al centro en formato 16:9 y va arriba de la carta, sin texto encima, para que el nombre siempre se lea bien. Elegí el archivo y tocá «Guardar portada».</p>
          {current?.error ? <p role="alert" className="font-medium text-danger">{current.error}</p> : null}
          <div><SubmitButton pendingLabel="Subiendo…">Guardar portada</SubmitButton></div>
        </fieldset>
        {state.error ? <p role="alert" className="mt-3 font-medium text-danger">{state.error}</p> : null}
        {state.message ? <p role="status" className="mt-3 font-medium">{state.message}</p> : null}
      </form>
      <p className="mt-5 text-sm text-muted">{current?.url ? "Así se verá tu carta con la foto elegida (todavía sin guardar)." : props.currentUrl ? "Así se ve hoy tu carta con la portada." : "Así se verá tu carta cuando agregues una portada: elegí una foto para verla acá."}</p>
      <CartaPreview {...previewBase(props)} cover={current?.url ?? props.currentUrl} testId="apariencia-preview-portada" />
      <ActionForm action={removeCoverAction} className="mt-3">
        <fieldset disabled={!props.canWrite || !props.currentUrl}>
          <input type="hidden" name="org" value={props.orgSlug} />
          <SubmitButton className={dangerButtonClass} pendingLabel="Quitando…">Quitar portada</SubmitButton>
        </fieldset>
      </ActionForm>
    </div>
  );
}

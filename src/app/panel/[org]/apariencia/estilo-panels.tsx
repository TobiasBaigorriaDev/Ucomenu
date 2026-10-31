"use client";

import { AMBIENT_KEYS, AMBIENTS } from "@/lib/identidad/ambientes";
import { DENSITIES, DENSITY_KEYS, SHAPES, SHAPE_KEYS } from "@/lib/identidad/formas";
import { LAYOUT_KEYS, LAYOUTS } from "@/lib/identidad/layouts";
import { LOOK_KEYS, LOOKS, lookStyle, matchingLook, type StyleDraft } from "@/lib/identidad/looks";
import { PALETTE_KEYS, PALETTES } from "@/lib/identidad/palettes";
import { FONT_KEYS, FONTS } from "@/lib/identidad/tipografias";

// Paneles de las pestañas «Estilo» y «Detalles». Son controlados: el estado vive en `AparienciaStudio`, que es quien alimenta la vista
// previa única. Ninguno guarda nada por su cuenta; el botón de guardar es el de la barra que comparten las dos pestañas.

/** `saved` es lo ya guardado: al cambiar (después de guardar) los radios se vuelven a montar, porque React resetea el formulario al terminar la acción y los dejaría sin marcar. */
export type StyleProps = { style: StyleDraft; saved: StyleDraft; onChange: (patch: Partial<StyleDraft>) => void; canWrite: boolean };

type Option = { key: string; name: string; description: string };
const optionClass = "flex min-h-16 cursor-pointer items-start gap-3 rounded-2xl border border-ink/30 px-3 py-3 has-checked:border-cobalt has-checked:bg-tile/40 has-disabled:cursor-default has-disabled:opacity-60";

/** Opciones excluyentes (radio) con nombre y descripción. */
function OptionGroup({ legend, field, options, value, saved, onChange }: { legend: string; field: string; options: Option[]; value: string; saved: string; onChange: (key: string) => void }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-medium text-muted">{legend}</legend>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-3">
        {options.map(option => (
          <label key={option.key} className={optionClass}>
            <input key={`${option.key}:${saved}`} type="radio" name={`ui-${field}`} value={option.key} checked={value === option.key} onChange={() => onChange(option.key)} className="mt-1 size-4 shrink-0 accent-cobalt" />
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

const GROUPS = [
  { scheme: "light", title: "Claras" },
  { scheme: "dark", title: "Oscuras" },
] as const;

function Heading({ id, title, children }: { id: string; title: string; children: string }) {
  return (
    <>
      <h3 id={id} className="font-display text-xl">{title}</h3>
      <p className="mt-1 text-sm text-muted">{children}</p>
    </>
  );
}

/** Combinaciones ya armadas: un clic cambia las seis opciones en la vista previa; se publican con «Guardar apariencia». */
export function LookGallery({ style, onChange, canWrite }: Omit<StyleProps, "saved">) {
  const current = matchingLook(style);
  return (
    <section aria-labelledby="looks" data-testid="looks">
      <Heading id="looks" title="Empezá con un look">Una combinación lista de colores, estilo, letra y detalles. Después podés ajustar lo que quieras.</Heading>
      <fieldset disabled={!canWrite} className="mt-4 min-w-0">
        <legend className="sr-only">Looks</legend>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-3">
          {LOOK_KEYS.map(key => {
            const look = LOOKS[key];
            const palette = PALETTES[look.palette];
            return (
              <li key={key}>
                <button
                  type="button"
                  aria-pressed={current === key}
                  data-look={key}
                  onClick={() => onChange(lookStyle(key))}
                  className="flex h-full w-full cursor-pointer flex-col items-start gap-2 rounded-2xl border border-ink/30 px-3 py-3 text-left hover:border-cobalt aria-pressed:border-cobalt aria-pressed:bg-tile/40 disabled:cursor-default disabled:opacity-60"
                >
                  <span aria-hidden="true" className="flex gap-1">
                    {[palette.background, palette.accent, palette.terra, palette.blush].map(color => <span key={color} className="size-4 rounded-full border border-ink/30" style={{ background: color }} />)}
                  </span>
                  <span className="font-medium">{look.name}{current === key ? <span className="ml-2 text-sm font-normal text-muted">(elegido)</span> : null}</span>
                  <span className="text-sm text-muted">{look.description}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </fieldset>
    </section>
  );
}

/** Pestaña «Estilo»: paleta, composición de la carta y tipografía de los títulos. */
export function StylePanel({ style, saved, onChange, canWrite }: StyleProps) {
  return (
    <div className="grid gap-8">
      <LookGallery style={style} onChange={onChange} canWrite={canWrite} />
      <section aria-labelledby="colores">
        <Heading id="colores" title="Colores de la carta">Elegí una paleta; todas tienen el contraste de lectura comprobado.</Heading>
        <fieldset disabled={!canWrite} className="mt-4 min-w-0">
          <legend className="sr-only">Paleta de colores</legend>
          {GROUPS.map(group => (
            <div key={group.scheme} className="mt-4 first:mt-0">
              <p className="mb-2 text-sm font-medium text-muted">{group.title}</p>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,10rem),1fr))] gap-3">
                {PALETTE_KEYS.filter(key => PALETTES[key].scheme === group.scheme).map(key => {
                  const p = PALETTES[key];
                  return (
                    <label key={key} className="flex min-h-16 cursor-pointer items-center gap-3 rounded-2xl border border-ink/30 px-3 py-3 has-checked:border-cobalt has-checked:bg-tile/40 has-disabled:cursor-default has-disabled:opacity-60">
                      <input key={`${key}:${saved.palette}`} type="radio" name="ui-palette" value={key} checked={style.palette === key} onChange={() => onChange({ palette: key })} className="size-4 shrink-0 accent-cobalt" />
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
        </fieldset>
      </section>
      <section aria-labelledby="estilo-carta">
        <Heading id="estilo-carta" title="Estilo de la carta">Cómo se muestran las categorías y los platos. Los datos, las fotos y los colores son los mismos.</Heading>
        <fieldset disabled={!canWrite} className="mt-4 min-w-0">
          <OptionGroup legend="Composición" field="layout" options={LAYOUT_KEYS.map(key => ({ key, name: LAYOUTS[key].name, description: LAYOUTS[key].description }))} value={style.layout} saved={saved.layout} onChange={key => onChange({ layout: key as StyleDraft["layout"] })} />
        </fieldset>
      </section>
      <section aria-labelledby="tipografia">
        <Heading id="tipografia" title="Tipografía">La voz de los títulos: el nombre del local, las categorías y los platos. El texto de lectura no cambia.</Heading>
        <fieldset disabled={!canWrite} className="mt-4 min-w-0">
          <OptionGroup legend="Voz de los títulos" field="font" options={FONT_KEYS.map(key => ({ key, name: FONTS[key].name, description: FONTS[key].description }))} value={style.font} saved={saved.font} onChange={key => onChange({ font: key as StyleDraft["font"] })} />
        </fieldset>
        {style.layout === "afiche" ? <p className="mt-3 text-sm font-medium">El estilo Afiche usa su propia letra condensada: esta elección se guarda y se nota con otro estilo.</p> : null}
      </section>
    </div>
  );
}

/** Pestaña «Detalles»: esquinas y bordes, espaciado y textura de fondo. */
export function DetailsPanel({ style, saved, onChange, canWrite }: StyleProps) {
  return (
    <div className="grid gap-8">
      <section aria-labelledby="forma">
        <Heading id="forma" title="Forma y densidad">Esquinas redondeadas o rectas, bordes marcados y más o menos espacio entre platos. Los colores no cambian.</Heading>
        <fieldset disabled={!canWrite} className="mt-4 grid min-w-0 gap-4">
          <OptionGroup legend="Esquinas y bordes" field="shape" options={SHAPE_KEYS.map(key => ({ key, name: SHAPES[key].name, description: SHAPES[key].description }))} value={style.shape} saved={saved.shape} onChange={key => onChange({ shape: key as StyleDraft["shape"] })} />
          <OptionGroup legend="Espacio entre elementos" field="density" options={DENSITY_KEYS.map(key => ({ key, name: DENSITIES[key].name, description: DENSITIES[key].description }))} value={style.density} saved={saved.density} onChange={key => onChange({ density: key as StyleDraft["density"] })} />
        </fieldset>
        {style.layout === "afiche" ? <p className="mt-3 text-sm font-medium">El estilo Afiche ya trae sus esquinas rectas y sus filetes: la forma se nota con otro estilo.</p> : null}
      </section>
      <section aria-labelledby="ambientacion">
        <Heading id="ambientacion" title="Ambientación">Una textura suave de fondo y adornos propios en el pie de la carta, todo el año. Si activás una fecha especial, esa decoración reemplaza a la textura mientras dure.</Heading>
        <fieldset disabled={!canWrite} className="mt-4 min-w-0">
          <OptionGroup legend="Textura de fondo y adornos del pie" field="ambient" options={AMBIENT_KEYS.map(key => ({ key, name: AMBIENTS[key].name, description: AMBIENTS[key].description }))} value={style.ambient} saved={saved.ambient} onChange={key => onChange({ ambient: key as StyleDraft["ambient"] })} />
        </fieldset>
      </section>
    </div>
  );
}

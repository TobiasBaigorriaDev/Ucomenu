"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { secondaryButtonClass } from "@/components/panel/styles";
import { sameStyle, type StyleDraft } from "@/lib/identidad/looks";
import { isTheme, NO_THEME, type ThemeStatus } from "@/lib/identidad/temas";
import { validateHours, validateInstagram, validateTagline, validateWhatsapp, type Voice } from "@/lib/identidad/voz";
import { styleAction } from "./actions";
import { CartaPreview } from "./carta-preview";
import { DetailsPanel, StylePanel } from "./estilo-panels";
import { BrandPanel, DatesPanel, themeFrom, type ThemeDraft, type VoiceDraft } from "./marca-fecha-panels";

type TabId = "marca" | "estilo" | "detalles" | "fechas";
const TABS: { id: TabId; label: string }[] = [
  { id: "marca", label: "Marca" },
  { id: "estilo", label: "Estilo" },
  { id: "detalles", label: "Detalles" },
  { id: "fechas", label: "Fechas especiales" },
];

const voiceDraft = (voice: Voice): VoiceDraft => ({
  tagline: voice.tagline ?? "",
  hours: voice.hours ?? "",
  instagram: voice.instagram ? `@${voice.instagram}` : "",
  whatsapp: voice.whatsapp ? `+${voice.whatsapp}` : "",
});

/** Lo escrito, tal como lo guardará el servidor (o `undefined` si todavía no es válido). */
function parsedVoice(draft: VoiceDraft) {
  const tagline = validateTagline(draft.tagline);
  const hours = validateHours(draft.hours);
  const instagram = validateInstagram(draft.instagram);
  const whatsapp = validateWhatsapp(draft.whatsapp);
  return {
    tagline: tagline.ok ? tagline.value : undefined,
    hours: hours.ok ? hours.value : undefined,
    instagram: instagram.ok ? instagram.value : undefined,
    whatsapp: whatsapp.ok ? whatsapp.value : undefined,
  };
}

/**
 * Estudio de apariencia: cuatro pestañas (Marca, Estilo, Detalles y Fechas especiales) y UNA vista previa con los cambios que todavía no
 * se guardaron. Estilo y Detalles se guardan juntos con un solo botón (lo que se ve es lo que se publica, en una sola escritura); Marca
 * y Fechas especiales guardan lo suyo. Todas las pestañas quedan montadas, así que nada de lo escrito se pierde al cambiar de una a otra.
 */
export function AparienciaStudio(props: {
  orgSlug: string; name: string; canWrite: boolean; logoUrl: string | null; coverUrl: string | null;
  saved: { style: StyleDraft; theme: string; themeFrom: string | null; themeUntil: string | null; voice: Voice };
  themeStatus: ThemeStatus;
}) {
  const { orgSlug, name, canWrite, saved } = props;
  const [tab, setTab] = useState<TabId>("estilo");
  const [style, setStyle] = useState<StyleDraft>(saved.style);
  const [voice, setVoice] = useState<VoiceDraft>(() => voiceDraft(saved.voice));
  const [theme, setTheme] = useState<ThemeDraft>({ selected: themeFrom(saved.theme), start: saved.themeFrom ?? "", end: saved.themeUntil ?? "" });
  const [coverDraft, setCoverDraft] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({ marca: null, estilo: null, detalles: null, fechas: null });
  const pickCover = useCallback((url: string | null) => setCoverDraft(url), []);

  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setSheetOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetOpen]);

  // ── Cambios sin guardar, por pestaña ───────────────────────────────────────────────────────────────────────────────
  const styleDirty = !sameStyle(style, saved.style);
  const now = parsedVoice(voice);
  const voiceDirty = now.tagline !== saved.voice.tagline || now.hours !== saved.voice.hours || now.instagram !== saved.voice.instagram || now.whatsapp !== saved.voice.whatsapp || coverDraft !== null;
  const savedTheme = themeFrom(saved.theme);
  const themeDirty = theme.selected !== savedTheme || (theme.selected !== NO_THEME && (theme.start !== (saved.themeFrom ?? "") || theme.end !== (saved.themeUntil ?? "")));
  const dirty: Record<TabId, boolean> = { marca: voiceDirty, estilo: styleDirty, detalles: styleDirty, fechas: themeDirty };

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = TABS.length - 1;
    const next = event.key === "ArrowRight" ? (index === last ? 0 : index + 1) : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1) : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (next === null) return;
    event.preventDefault();
    setTab(TABS[next].id);
    tabRefs.current[TABS[next].id]?.focus();
  }

  const styleTab = tab === "estilo" || tab === "detalles";
  const previewSocial = { instagram: now.instagram ?? null, whatsapp: now.whatsapp ?? null };

  return (
    <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(26rem,32rem)] xl:items-start">
      <div className="min-w-0">
        <div role="tablist" aria-label="Secciones de la apariencia" className="flex gap-1 overflow-x-auto border-b border-ink/20">
          {TABS.map((item, index) => (
            <button
              key={item.id}
              ref={element => { tabRefs.current[item.id] = element; }}
              type="button"
              role="tab"
              id={`tab-${item.id}`}
              aria-selected={tab === item.id}
              aria-controls={`panel-${item.id}`}
              tabIndex={tab === item.id ? 0 : -1}
              onClick={() => setTab(item.id)}
              onKeyDown={event => onTabKey(event, index)}
              className="-mb-px inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 border-transparent px-4 text-base font-medium text-muted hover:text-ink aria-selected:border-cobalt aria-selected:font-semibold aria-selected:text-ink"
            >
              {item.label}
              {dirty[item.id] ? <><span aria-hidden="true" className="size-2 rounded-full bg-cobalt" /><span className="sr-only">(cambios sin guardar)</span></> : null}
            </button>
          ))}
        </div>

        <div className="mt-5">
          <div role="tabpanel" id="panel-marca" aria-labelledby="tab-marca" hidden={tab !== "marca"}>
            <BrandPanel
              orgSlug={orgSlug} name={name} canWrite={canWrite} logoUrl={props.logoUrl} coverUrl={props.coverUrl} layout={style.layout}
              voice={voice} onVoice={patch => setVoice(previous => ({ ...previous, ...patch }))} onCoverPick={pickCover}
            />
          </div>

          <ActionForm action={styleAction} inlineMessages>
            {state => (
              <>
                <input type="hidden" name="org" value={orgSlug} />
                <input type="hidden" name="palette" value={style.palette} />
                <input type="hidden" name="layout" value={style.layout} />
                <input type="hidden" name="font" value={style.font} />
                <input type="hidden" name="shape" value={style.shape} />
                <input type="hidden" name="density" value={style.density} />
                <input type="hidden" name="ambient" value={style.ambient} />
                <div role="tabpanel" id="panel-estilo" aria-labelledby="tab-estilo" hidden={tab !== "estilo"} className="panel-cell">
                  <StylePanel style={style} saved={saved.style} onChange={patch => setStyle(previous => ({ ...previous, ...patch }))} canWrite={canWrite} />
                </div>
                <div role="tabpanel" id="panel-detalles" aria-labelledby="tab-detalles" hidden={tab !== "detalles"} className="panel-cell">
                  <DetailsPanel style={style} saved={saved.style} onChange={patch => setStyle(previous => ({ ...previous, ...patch }))} canWrite={canWrite} />
                </div>
                <div hidden={!styleTab} className="sticky bottom-0 z-10 -mx-4 mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-ink/15 bg-porcelain/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8 xl:mx-0 xl:rounded-2xl xl:border xl:px-4">
                  <fieldset disabled={!canWrite} className="contents">
                    <SubmitButton pendingLabel="Guardando…">Guardar apariencia</SubmitButton>
                    <button type="button" onClick={() => setStyle(saved.style)} disabled={!canWrite || !styleDirty} className={secondaryButtonClass}><span>Descartar<span className="hidden sm:inline"> cambios</span></span></button>
                  </fieldset>
                  <p aria-live="polite" className="min-w-0 text-sm text-muted">
                    {styleDirty ? <><span className="sm:hidden">Cambios sin guardar</span><span className="hidden sm:inline">Tenés cambios sin guardar: la vista previa los muestra, tu carta todavía no.</span></> : "Sin cambios pendientes."}
                  </p>
                  {state.error ? <p role="alert" className="w-full text-base font-medium text-danger">{state.error}</p> : null}
                  {state.message ? <p role="status" className="w-full text-base font-medium text-ink">{state.message}</p> : null}
                </div>
              </>
            )}
          </ActionForm>

          <div role="tabpanel" id="panel-fechas" aria-labelledby="tab-fechas" hidden={tab !== "fechas"}>
            <DatesPanel
              orgSlug={orgSlug} canWrite={canWrite} draft={theme} onDraft={patch => setTheme(previous => ({ ...previous, ...patch }))}
              saved={{ theme: saved.theme, from: saved.themeFrom, until: saved.themeUntil }} status={props.themeStatus}
            />
          </div>
        </div>
      </div>

      {sheetOpen ? <div aria-hidden="true" onClick={() => setSheetOpen(false)} className="fixed inset-0 z-30 bg-black/40 xl:hidden" /> : null}
      <aside
        aria-label="Vista previa de tu carta"
        className={`${sheetOpen ? "fixed inset-x-0 bottom-0 z-40 block max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-ink/20 bg-porcelain p-4 shadow-2xl" : "hidden"} xl:sticky xl:inset-x-auto xl:top-6 xl:bottom-auto xl:z-auto xl:block xl:max-h-[calc(100dvh-3rem)] xl:overflow-y-auto xl:rounded-none xl:border-0 xl:bg-transparent xl:p-0 xl:shadow-none`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl">Vista previa</h2>
            <p className="mt-1 text-sm text-muted">Así se ve tu carta con lo que estás eligiendo, aunque todavía no lo hayas guardado (con platos de ejemplo).</p>
          </div>
          <button type="button" onClick={() => setSheetOpen(false)} className={`${secondaryButtonClass} shrink-0 xl:hidden`}>Cerrar</button>
        </div>
        <CartaPreview
          name={name}
          logo={props.logoUrl}
          palette={style.palette}
          layout={style.layout}
          theme={isTheme(theme.selected) ? theme.selected : null}
          look={{ font: style.font, shape: style.shape, density: style.density, ambient: style.ambient }}
          tagline={now.tagline ?? null}
          social={previewSocial}
          cover={coverDraft ?? props.coverUrl}
          testId="apariencia-preview"
        />
      </aside>

      {sheetOpen ? null : (
        <button type="button" onClick={() => setSheetOpen(true)} data-testid="ver-vista-previa" className="fixed right-4 bottom-24 z-30 inline-flex min-h-12 items-center gap-2 rounded-full bg-cobalt px-5 text-base font-semibold text-white shadow-lg xl:hidden">
          Ver vista previa
          {styleDirty || voiceDirty || themeDirty ? <span aria-hidden="true" className="size-2 rounded-full bg-white" /> : null}
        </button>
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { inputClass, secondaryButtonClass } from "@/components/panel/styles";
import { LANG_NAME, type TranslatedLang } from "@/lib/idiomas/idiomas";
import type { TranslationNode } from "@/lib/idiomas/panel";
import { TRANSLATED_DESCRIPTION_MAX, TRANSLATED_NAME_MAX } from "@/lib/idiomas/traducciones";
import { saveTranslationsAction, suggestTranslationsAction } from "./actions";

/** Prefijo de los campos (`c:{id}:name`); lo lee `readEntries` en el servidor. */
const PREFIX = { category: "c", product: "p", group: "g", option: "o" } as const;

/** Campo con una sugerencia automática todavía sin revisar: se resalta hasta que se edita o se guarda. */
const suggestedClass = `${inputClass} data-[sugerido]:border-cobalt data-[sugerido]:bg-cobalt/5`;

const KIND_LABEL = { category: "Categoría", product: "Plato", group: "Variante o adicionales", option: "Opción" } as const;

/** Un texto original (a la izquierda) y el campo de su traducción (a la derecha; debajo en el celular). */
function Row({
  fieldName,
  original,
  value,
  multiline,
  small,
  lang,
}: {
  fieldName: string;
  original: string;
  value: string;
  multiline?: boolean;
  small?: boolean;
  lang: TranslatedLang;
}) {
  const id = `t-${fieldName}`;
  return (
    // La columna del campo tiene ancho fijo y llega al borde derecho: aunque los grupos y opciones se sangren, todos los campos quedan alineados.
    <div className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] sm:items-start sm:gap-4">
      <label htmlFor={id} className={`[overflow-wrap:anywhere] ${small ? "text-sm text-muted" : "text-base"}`}>
        <span className="sr-only">Traducción al {LANG_NAME[lang]} de </span>
        {original}
      </label>
      {multiline ? (
        <textarea id={id} name={fieldName} rows={3} maxLength={TRANSLATED_DESCRIPTION_MAX} lang={lang} defaultValue={value} className={suggestedClass} />
      ) : (
        <input id={id} name={fieldName} maxLength={TRANSLATED_NAME_MAX} autoComplete="off" lang={lang} defaultValue={value} className={suggestedClass} />
      )}
    </div>
  );
}

/**
 * «Sugerir con IA»: pide al servidor la traducción de lo que falta y la escribe SOLO en los campos que siguen vacíos (lo que
 * el local ya escribió nunca se pisa). No guarda: el local revisa, corrige y pulsa «Guardar». Los campos sugeridos se
 * resaltan hasta que se editan o se guarda.
 */
function SuggestButton({ orgSlug, lang }: { orgSlug: string; lang: TranslatedLang }) {
  const button = useRef<HTMLButtonElement>(null);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ error?: string; message?: string }>({});

  useEffect(() => {
    const form = button.current?.form;
    if (!form) return;
    const unmark = (event: Event) => {
      if (event.target instanceof HTMLElement) delete event.target.dataset.sugerido;
    };
    // Al guardar, el aviso de la sugerencia se va: el resultado del guardado ocupa su lugar y no se anuncian dos estados a la vez.
    const unmarkAll = () => {
      form.querySelectorAll<HTMLElement>("[data-sugerido]").forEach((field) => delete field.dataset.sugerido);
      setResult({});
    };
    form.addEventListener("input", unmark);
    form.addEventListener("submit", unmarkAll);
    return () => {
      form.removeEventListener("input", unmark);
      form.removeEventListener("submit", unmarkAll);
    };
  }, []);

  const suggest = () => {
    const form = button.current?.form;
    if (!form) return;
    setResult({});
    const data = new FormData();
    data.set("org", orgSlug);
    data.set("lang", lang);
    start(async () => {
      let answer;
      try {
        answer = await suggestTranslationsAction(data);
      } catch {
        setResult({ error: "No se pudo obtener la sugerencia. Probá de nuevo en unos minutos." });
        return;
      }
      if (!answer.ok) {
        setResult({ error: answer.error });
        return;
      }
      let filled = 0;
      for (const [key, text] of Object.entries(answer.suggestions)) {
        const field = form.elements.namedItem(key);
        if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) || field.value.trim() !== "") continue;
        field.value = text;
        field.dataset.sugerido = "true";
        filled += 1;
      }
      const rest = answer.requested - filled;
      setResult({
        message:
          filled === 0
            ? "No se completó ningún campo: ya tenían texto."
            : `Se completaron ${filled} ${filled === 1 ? "campo" : "campos"} con sugerencias (resaltados). Revisalos y pulsá «Guardar»: todavía no se guardó nada.${rest > 0 ? ` Quedan ${rest} sin sugerencia; podés volver a pulsar «Sugerir».` : ""}`,
      });
    });
  };

  return (
    <div className="grid gap-2">
      <div>
        <button ref={button} type="button" onClick={suggest} disabled={pending} className={secondaryButtonClass}>
          {pending ? "Pensando…" : `Sugerir con IA lo que falta en ${LANG_NAME[lang]}`}
        </button>
      </div>
      <p className="max-w-prose text-sm text-muted">
        Completa solo los campos vacíos con una traducción automática, que conviene revisar. Para eso los textos de tu carta se envían a Google
        (Gemini). No se guarda hasta que pulses «Guardar».
      </p>
      {result.error ? (
        <p role="alert" className="text-base font-medium text-danger">
          {result.error}
        </p>
      ) : null}
      {result.message ? (
        <p role="status" className="max-w-prose text-base font-medium text-ink" data-testid="sugerencia-resultado">
          {result.message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Formulario único de un idioma: todos los textos de la carta, en el orden en que se ven. Se guardan solo los que cambiaron;
 * vaciar un campo quita esa traducción (la carta vuelve a mostrar el español). Las descripciones solo existen en los platos.
 */
export function TranslationsForm({
  orgSlug,
  lang,
  tree,
  canWrite,
  canSuggest,
}: {
  orgSlug: string;
  lang: TranslatedLang;
  tree: TranslationNode[];
  canWrite: boolean;
  /** Hay un servicio de sugerencias configurado en el servidor. */
  canSuggest: boolean;
}) {
  return (
    <ActionForm action={saveTranslationsAction} className="mt-6" inlineMessages>
      {(state) => {
        const field = (item: TranslationNode, part: "name" | "description") => {
          const name = `${PREFIX[item.kind]}:${item.id}:${part}`;
          return { name, value: state.values?.[name] ?? item.translations[lang]?.[part] ?? "" };
        };
        const renderNode = (item: TranslationNode, depth: number) => {
          const name = field(item, "name");
          const description = item.kind === "product" && item.description ? field(item, "description") : null;
          return (
            <div
              key={`${item.kind}:${item.id}`}
              className={depth === 0 ? "" : depth === 1 ? "mt-5" : "mt-3 border-l border-ink/20 pl-4"}
              data-testid={`traduccion-${item.kind}`}
            >
              <p className="mb-1 text-sm font-medium text-muted">
                {KIND_LABEL[item.kind]}
                {item.isActive ? "" : " (oculto en la carta)"}
              </p>
              <Row fieldName={name.name} original={item.name} value={name.value} lang={lang} />
              {description ? (
                <div className="mt-2">
                  <Row fieldName={description.name} original={item.description ?? ""} value={description.value} multiline small lang={lang} />
                </div>
              ) : null}
              {item.children.map((child) => renderNode(child, depth + 1))}
            </div>
          );
        };
        return (
          <fieldset disabled={!canWrite} className="grid gap-6">
            <input type="hidden" name="org" value={orgSlug} />
            <input type="hidden" name="lang" value={lang} />
            {canSuggest ? <SuggestButton orgSlug={orgSlug} lang={lang} /> : null}
            {tree.map((category) => (
              <section key={category.id} aria-label={category.name} className="panel-cell">
                {renderNode(category, 0)}
              </section>
            ))}
            {/* El resultado va junto al botón fijo: en una carta larga el final de la página queda lejos de donde se guarda. */}
            <div className="sticky bottom-0 -mx-4 grid gap-2 border-t border-ink/15 bg-porcelain px-4 py-3 sm:mx-0 sm:rounded-2xl sm:border">
              {state.error ? (
                <p role="alert" className="max-h-[30vh] overflow-y-auto text-base font-medium text-danger">
                  {state.error}
                </p>
              ) : null}
              {state.message ? (
                <p role="status" className="text-base font-medium text-ink">
                  {state.message}
                </p>
              ) : null}
              <div>
                <SubmitButton pendingLabel="Guardando…">Guardar traducciones al {LANG_NAME[lang]}</SubmitButton>
              </div>
            </div>
          </fieldset>
        );
      }}
    </ActionForm>
  );
}

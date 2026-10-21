"use client";

import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { inputClass } from "@/components/panel/styles";
import { LANG_NAME, type TranslatedLang } from "@/lib/idiomas/idiomas";
import type { TranslationNode } from "@/lib/idiomas/panel";
import { TRANSLATED_DESCRIPTION_MAX, TRANSLATED_NAME_MAX } from "@/lib/idiomas/traducciones";
import { saveTranslationsAction } from "./actions";

/** Prefijo de los campos (`c:{id}:name`); lo lee `readEntries` en el servidor. */
const PREFIX = { category: "c", product: "p", group: "g", option: "o" } as const;

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
        <textarea id={id} name={fieldName} rows={3} maxLength={TRANSLATED_DESCRIPTION_MAX} lang={lang} defaultValue={value} className={inputClass} />
      ) : (
        <input id={id} name={fieldName} maxLength={TRANSLATED_NAME_MAX} autoComplete="off" lang={lang} defaultValue={value} className={inputClass} />
      )}
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
}: {
  orgSlug: string;
  lang: TranslatedLang;
  tree: TranslationNode[];
  canWrite: boolean;
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

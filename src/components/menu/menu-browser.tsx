"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { DIETARY_LABEL, DIETARY_TAGS, filterMenu, type DietaryTag } from "@/lib/carta/dietary";
import type { MenuProduct, MenuSection as Section } from "@/lib/menu";
import { CategoryBar } from "./category-bar";
import { CategoryMosaic } from "./category-mosaic";
import { DishDetail } from "./dish-detail";
import { MenuSection } from "./menu-section";

export function MenuBrowser({ sections }: { sections: Section[] }) {
  const [query, setQuery] = useState("");
  const [tags, setTags] = useState<DietaryTag[]>([]);
  const [selected, setSelected] = useState<MenuProduct | null>(null);
  const visible = useMemo(() => filterMenu(sections, query, tags), [sections, query, tags]);
  const count = visible.reduce((total, section) => total + section.products.length, 0);
  const filtering = Boolean(query.trim()) || tags.length > 0;
  function clear() { setQuery(""); setTags([]); }

  return (
    <>
      <div role="search" aria-label="Buscar y filtrar la carta" className="mx-auto max-w-3xl px-4 pb-8 sm:px-6">
        <label htmlFor="menu-search" className="block text-base font-medium">Buscar platos</label>
        <input id="menu-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder="Nombre o descripción" autoComplete="off" maxLength={200}
          className="mt-2 min-h-12 w-full rounded-lg border border-ink/40 bg-transparent px-4 text-base placeholder:text-muted" />
        <fieldset className="mt-4">
          <legend className="mb-2 text-sm text-muted">Etiquetas declaradas por el local</legend>
          <div className="flex flex-wrap gap-2">
            {DIETARY_TAGS.map((tag) => <button key={tag} type="button" aria-pressed={tags.includes(tag)}
              onClick={() => setTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag])}
              className="min-h-11 rounded-full border border-[var(--carta-green)] px-4 text-sm font-medium text-[var(--carta-green)] hover:bg-[var(--carta-sand)] aria-pressed:bg-[var(--carta-green)] aria-pressed:text-white">
              {DIETARY_LABEL[tag]}
            </button>)}
          </div>
        </fieldset>
        {/* El aviso aparece donde importa: al filtrar por etiqueta. Sin filtros, el inicio queda limpio (el pie y el detalle lo repiten). */}
        {tags.length > 0 ? (
          <p data-testid="aviso-etiquetas" className="mt-3 text-sm leading-relaxed text-muted">
            {tags.length > 1 ? "Se muestran los platos que tienen todas las etiquetas elegidas. " : ""}
            Etiquetas declaradas por el local, no certificadas: con alergias o celiaquía, confirmalo con el personal.{" "}
            <Link href="/alergenos" className="font-medium text-[var(--carta-green)] underline underline-offset-4">Aviso de alérgenos</Link>
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4">
          <p role="status" aria-live="polite" className="text-sm text-muted">{count === 1 ? "1 plato" : `${count} platos`}{filtering ? (count === 1 ? " encontrado" : " encontrados") : " en la carta"}</p>
          {filtering ? <button type="button" onClick={clear} className="min-h-11 text-sm font-medium text-[var(--carta-green)] underline underline-offset-4">Limpiar búsqueda y filtros</button> : null}
        </div>
      </div>
      {visible.length ? <>
        <CategoryMosaic sections={visible} />
        <CategoryBar sections={visible} />
        <main className="mx-auto max-w-5xl px-4 pb-12 sm:px-6">
          {visible.map((section, i) => <MenuSection key={section.category.id} section={section} index={i} onSelect={setSelected} />)}
        </main>
      </> : <main className="mx-auto max-w-3xl px-4 py-12 text-center sm:px-6">
        <h2 className="font-display text-2xl">No encontramos platos con esa búsqueda.</h2>
        <p className="mt-3 text-muted">Probá con otro nombre o quitá algún filtro.</p>
      </main>}
      {selected ? <DishDetail product={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
}

"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { DIETARY_TAGS, filterMenu, type DietaryTag } from "@/lib/carta/dietary";
import type { Lang } from "@/lib/idiomas/idiomas";
import { TEXTOS } from "@/lib/idiomas/textos";
import type { MenuProduct, MenuSection as Section } from "@/lib/menu";
import { CategoryBar } from "./category-bar";
import { CategoryMosaic } from "./category-mosaic";
import { DishDetail } from "./dish-detail";
import { MenuSection } from "./menu-section";

export function MenuBrowser({ sections, branchId, lang }: { sections: Section[]; branchId: string; lang: Lang }) {
  const t = TEXTOS[lang];
  const [query, setQuery] = useState("");
  const [tags, setTags] = useState<DietaryTag[]>([]);
  // Se guarda el id (no el plato): si la persona cambia de idioma con el detalle abierto, se muestra el mismo plato traducido.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Analítica básica (ficha analitica-basica): se cuenta UNA vista por plato y por visita. La memoria es solo de esta página
  // (se pierde al recargar): la carta promete no guardar nada en el dispositivo, así que no se usa ningún almacenamiento.
  const viewed = useRef<Set<string>>(new Set());
  const counting = useRef(true);
  function select(product: MenuProduct) {
    setSelectedId(product.id);
    if (!counting.current || viewed.current.has(product.id)) return;
    viewed.current.add(product.id);
    // Un `fetch` a una ruta, NO una acción del servidor: las acciones de la página van de a una y un conteo lento demoraría
    // «Llamar al mozo». Sin esperar y sin mostrar nada; si el local no tiene analítica o falla, se deja de intentar en esta visita.
    void fetch("/api/vista-plato", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ branch: branchId, product: product.id }),
      keepalive: true,
      credentials: "omit",
      cache: "no-store",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: unknown) => {
        if (!data || (data as { counted?: unknown }).counted !== true) counting.current = false;
      })
      .catch(() => {
        counting.current = false;
      });
  }
  const visible = useMemo(() => filterMenu(sections, query, tags), [sections, query, tags]);
  const selected = selectedId ? sections.flatMap((section) => section.products).find((product) => product.id === selectedId) ?? null : null;
  const count = visible.reduce((total, section) => total + section.products.length, 0);
  const filtering = Boolean(query.trim()) || tags.length > 0;
  function clear() { setQuery(""); setTags([]); }

  return (
    <>
      <div role="search" aria-label={t.search.region} className="mx-auto max-w-3xl px-4 pb-8 sm:px-6">
        <label htmlFor="menu-search" className="block text-base font-medium">{t.search.label}</label>
        <input id="menu-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder={t.search.placeholder} autoComplete="off" maxLength={200}
          className="mt-2 min-h-12 w-full rounded-lg border border-ink/60 bg-transparent px-4 text-base placeholder:text-muted" />
        <fieldset className="mt-4">
          <legend className="mb-2 text-sm text-muted">{t.search.tagsLegend}</legend>
          <div className="flex flex-wrap gap-2">
            {DIETARY_TAGS.map((tag) => <button key={tag} type="button" aria-pressed={tags.includes(tag)}
              onClick={() => setTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag])}
              className="min-h-11 rounded-full border border-[var(--carta-green)] px-4 text-sm font-medium text-[var(--carta-green)] hover:bg-[var(--carta-sand)] aria-pressed:bg-[var(--carta-green)] aria-pressed:text-white">
              {t.dietary[tag]}
            </button>)}
          </div>
        </fieldset>
        {/* El aviso aparece donde importa: al filtrar por etiqueta. Sin filtros, el inicio queda limpio (el pie y el detalle lo repiten). */}
        {tags.length > 0 ? (
          <p data-testid="aviso-etiquetas" className="mt-3 text-sm leading-relaxed text-muted">
            {tags.length > 1 ? `${t.search.allTags} ` : ""}
            {t.search.tagsNotice}{" "}
            <Link href="/alergenos" className="font-medium text-[var(--carta-green)] underline underline-offset-4">{t.search.allergenLink}</Link>
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4">
          <p role="status" aria-live="polite" className="text-sm text-muted">{t.count.status(count, filtering)}</p>
          {filtering ? <button type="button" onClick={clear} className="min-h-11 text-sm font-medium text-[var(--carta-green)] underline underline-offset-4">{t.search.clear}</button> : null}
        </div>
      </div>
      {visible.length ? <>
        <CategoryMosaic sections={visible} lang={lang} />
        <CategoryBar sections={visible} lang={lang} />
        <main className="mx-auto max-w-5xl px-4 pb-12 sm:px-6">
          {visible.map((section, i) => <MenuSection key={section.category.id} section={section} index={i} onSelect={select} lang={lang} />)}
        </main>
      </> : <main className="mx-auto max-w-3xl px-4 py-12 text-center sm:px-6">
        <h2 className="font-display text-2xl">{t.search.emptyTitle}</h2>
        <p className="mt-3 text-muted">{t.search.emptyHint}</p>
      </main>}
      {selected ? <DishDetail product={selected} onClose={() => setSelectedId(null)} lang={lang} /> : null}
    </>
  );
}

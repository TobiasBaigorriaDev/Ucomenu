"use client";

import { useEffect, useRef, useState } from "react";
import type { Lang } from "@/lib/idiomas/idiomas";
import { TEXTOS } from "@/lib/idiomas/textos";
import type { MenuSection } from "@/lib/menu";
import { categoryAnchor, MOSAIC_ID } from "./anchors";

/** Distancia desde arriba de la pantalla a partir de la cual una sección cuenta como «la que se está leyendo». */
const READING_OFFSET = 96;
/** Tras tocar una opción se ignora el scroll un instante, para que la animación no marque las categorías del medio. */
const CLICK_LOCK_MS = 900;

/**
 * Barra fija de categorías: aparece cuando el mosaico ya quedó arriba de la pantalla y marca la categoría que se
 * está leyendo. Mientras está oculta es `inert` (no recibe foco ni la leen los lectores de pantalla), así que el
 * primer Tab de la página cae en el mosaico. No ocupa lugar en el flujo: no mueve el contenido al aparecer.
 */
export function CategoryBar({ sections, lang }: { sections: MenuSection[]; lang: Lang }) {
  const [activeId, setActiveId] = useState(sections[0]?.category.id);
  const [visible, setVisible] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const lockUntil = useRef(0);

  useEffect(() => {
    let frame = 0;
    let unlock = 0;

    function update() {
      frame = 0;
      const mosaic = document.getElementById(MOSAIC_ID);
      setVisible(mosaic ? mosaic.getBoundingClientRect().bottom < 0 : true);
      if (performance.now() < lockUntil.current) return;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      let current = sections[0]?.category.id;
      for (const { category } of sections) {
        const el = document.getElementById(categoryAnchor(category.id));
        if (el && el.getBoundingClientRect().top <= READING_OFFSET) current = category.id;
      }
      if (atBottom) current = sections[sections.length - 1]?.category.id;
      setActiveId(current);
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(update);
    }
    function onHashChange() {
      lockUntil.current = performance.now() + CLICK_LOCK_MS;
      window.clearTimeout(unlock);
      unlock = window.setTimeout(schedule, CLICK_LOCK_MS + 50);
    }

    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("hashchange", onHashChange);
      cancelAnimationFrame(frame);
      window.clearTimeout(unlock);
    };
  }, [sections]);

  // La opción activa se acerca al centro de la barra (solo dentro de la barra: no mueve la página).
  useEffect(() => {
    const list = listRef.current;
    const link = list?.querySelector<HTMLElement>("[aria-current]");
    if (!visible || !list || !link || list.scrollWidth <= list.clientWidth) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollTo({
      left: link.offsetLeft - (list.clientWidth - link.offsetWidth) / 2,
      behavior: reduced ? "auto" : "smooth",
    });
  }, [activeId, visible]);

  return (
    <nav
      aria-label={TEXTOS[lang].categories.bar}
      inert={!visible}
      className={`carta-bar fixed inset-x-0 top-0 z-10 border-b border-ink/10 bg-porcelain/95 backdrop-blur motion-safe:transition-[transform,opacity] motion-safe:duration-300 ${
        visible ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0"
      }`}
    >
      <ul ref={listRef} className="mx-auto flex max-w-5xl gap-2 overflow-x-auto px-4 py-2.5 sm:px-6 [scrollbar-width:none]">
        {sections.map(({ category }) => (
          <li key={category.id} className="shrink-0">
            <a
              href={`#${categoryAnchor(category.id)}`}
              aria-current={category.id === activeId ? "true" : undefined}
              onClick={() => {
                lockUntil.current = performance.now() + CLICK_LOCK_MS;
                setActiveId(category.id);
              }}
              className="flex min-h-11 max-w-[70vw] items-center rounded-full bg-[var(--carta-blush)] px-4 text-[0.75rem] font-semibold tracking-[0.08em] text-ink uppercase hover:bg-[var(--carta-sand)] aria-[current=true]:bg-[var(--carta-green)] aria-[current=true]:text-white"
            >
              <span className="truncate">{category.name}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

"use client";

import { useRef, useState, type ReactNode } from "react";

const sections = [
  { id: "general", label: "Datos y foto" },
  { id: "opciones", label: "Variantes" },
  { id: "sucursales", label: "Sucursales" },
] as const;

/** Cambia de tarea sin desmontar formularios ni perder campos o fotos sin guardar. */
export function EditorTabs({ general, opciones, sucursales }: {
  general: ReactNode;
  opciones: ReactNode;
  sucursales: ReactNode;
}) {
  const [active, setActive] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const panels = [general, opciones, sucursales];

  return (
    <div className="mt-6">
      <div role="tablist" aria-label="Editar plato" className="flex flex-wrap gap-1 border-b border-ink/15 pb-3 sm:gap-2">
        {sections.map((section, index) => (
          <button
            key={section.id}
            ref={(button) => { buttons.current[index] = button; }}
            type="button"
            role="tab"
            id={`editor-tab-${section.id}`}
            aria-controls={`editor-panel-${section.id}`}
            aria-selected={active === index}
            tabIndex={active === index ? 0 : -1}
            onClick={() => setActive(index)}
            onKeyDown={(event) => {
              let next: number;
              if (event.key === "ArrowRight") next = (index + 1) % sections.length;
              else if (event.key === "ArrowLeft") next = (index + sections.length - 1) % sections.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = sections.length - 1;
              else return;
              event.preventDefault();
              setActive(next);
              buttons.current[next]?.focus();
            }}
            className={`inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium sm:px-4 sm:text-base ${active === index
              ? "bg-brand text-white"
              : "border border-ink/40 text-ink hover:bg-ink/5"}`}
          >
            {section.label}
          </button>
        ))}
      </div>
      {sections.map((section, index) => (
        <div
          key={section.id}
          role="tabpanel"
          id={`editor-panel-${section.id}`}
          aria-labelledby={`editor-tab-${section.id}`}
          hidden={active !== index}
          tabIndex={0}
          className="pt-4"
        >
          {panels[index]}
        </div>
      ))}
    </div>
  );
}

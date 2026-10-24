"use client";

import { useMemo, useState } from "react";
import { formatArs } from "@/lib/money";
import { filterSections, type AnotarSection } from "@/lib/sala/anotar";
import { Sheet } from "./sheet";
import { fieldClass, primaryClass } from "./ui";

/**
 * La carta de la sucursal en una hoja aparte: buscar y tocar un plato abre su panel (que se apila encima). Al anotar, la hoja queda
 * abierta para seguir con el próximo plato; «Listo» la cierra.
 */
export function CartaSheet({
  sections,
  notice,
  onPick,
  onClose,
}: {
  sections: AnotarSection[];
  notice: string | null;
  onPick: (productId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => filterSections(sections, query), [sections, query]);

  return (
    <Sheet
      title="Anotar un plato"
      testId="hoja-carta"
      onClose={onClose}
      closeLabel="Cerrar la carta"
      footer={
        <button type="button" onClick={onClose} className={`${primaryClass} w-full`} data-testid="carta-listo">
          Listo
        </button>
      }
    >
      <p role="status" data-testid="anotado" className={notice ? "mt-3 rounded-2xl bg-brand/10 px-4 py-3 text-base text-ink" : "sr-only"}>
        {notice}
      </p>
      <label className="mt-3 block text-base font-medium" htmlFor="buscar-plato">
        Buscar plato
      </label>
      <input
        id="buscar-plato"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoComplete="off"
        placeholder="Por nombre o categoría"
        className={`${fieldClass} mt-1`}
      />

      {sections.length === 0 ? (
        <p className="mt-4 text-lg text-muted" data-testid="carta-vacia">
          La carta de esta sucursal no tiene platos para anotar.
        </p>
      ) : shown.length === 0 ? (
        <p className="mt-4 text-lg text-muted" data-testid="sin-resultados">
          Ningún plato coincide con «{query.trim()}».
        </p>
      ) : (
        <div className="mt-4 space-y-6" data-testid="carta">
          {shown.map((section) => (
            <section key={section.categoryId} aria-label={section.name}>
              <h3 className="text-xl font-semibold break-words">{section.name}</h3>
              <ul className="mt-2 divide-y divide-ink/10 rounded-3xl border border-ink/15 bg-white">
                {section.products.map((product) => (
                  <li key={product.id}>
                    <button
                      type="button"
                      data-testid="plato"
                      data-plato={product.name}
                      disabled={product.block !== null}
                      onClick={() => onPick(product.id)}
                      className="flex min-h-14 w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      <span className="min-w-0">
                        <span className="block text-lg font-medium break-words">{product.name}</span>
                        {product.block === "unavailable" ? <span className="block text-sm font-semibold text-suspended-ink">Agotado en esta sucursal</span> : null}
                        {product.block === "options_unfulfillable" ? (
                          <span className="block text-sm font-semibold text-suspended-ink">No se puede anotar: sus opciones obligatorias no tienen suficientes elecciones</span>
                        ) : null}
                        {product.groups.length > 0 && product.block === null ? <span className="block text-sm text-muted">Con opciones</span> : null}
                      </span>
                      <span className="shrink-0 text-right text-lg">
                        {product.listCents !== null ? <span className="block text-sm text-muted line-through">{formatArs(product.listCents)}</span> : null}
                        {formatArs(product.priceCents)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Sheet>
  );
}

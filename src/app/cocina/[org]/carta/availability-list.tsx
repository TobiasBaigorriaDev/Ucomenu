"use client";

import { useState } from "react";
import { isStaleKitchen, KITCHEN_TEXT, type KitchenCategory } from "@/lib/cocina/cocina";
import { setAvailabilityAction } from "../actions";

const buttonClass =
  "inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-ink/50 px-4 py-2 text-base font-medium text-ink hover:bg-ink/5 disabled:opacity-60";
const primaryClass =
  "inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-cobalt px-5 py-2 text-base font-medium text-white hover:bg-brand-deep disabled:opacity-60";

const normalize = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Los platos de una sucursal con su estado, para marcar agotado o volver a disponible. El comensal sigue viendo el plato, como «no
 * disponible» (agotar no lo oculta ni lo borra). Cada toque guarda UN plato en UNA sucursal y escribe el estado deseado, no una
 * alternancia: dos personas o un reintento nunca se pisan.
 */
export function AvailabilityList({ slug, branchId, categories }: { slug: string; branchId: string; categories: KitchenCategory[] }) {
  const [available, setAvailable] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(categories.flatMap((category) => category.products.map((product) => [product.id, product.available]))),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");

  async function set(productId: string, name: string, next: boolean) {
    setBusy(productId);
    setNotes((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== productId)));
    try {
      const result = await setAvailabilityAction(slug, { productId, branchId, available: next });
      if (result.status === "failed") {
        setNotes((current) => ({ ...current, [productId]: KITCHEN_TEXT[result.reason] }));
        if (isStaleKitchen(result.reason)) window.location.reload();
        return;
      }
      setAvailable((current) => ({ ...current, [productId]: next }));
      setNotes((current) => ({ ...current, [productId]: next ? `${name}: disponible de nuevo.` : `${name}: marcado como agotado.` }));
    } catch {
      setNotes((current) => ({ ...current, [productId]: "No se pudo comunicar con el servidor. Probá de nuevo." }));
    } finally {
      setBusy(null);
    }
  }

  const wanted = normalize(query.trim());
  const shown = categories
    .map((category) => ({ ...category, products: category.products.filter((product) => wanted === "" || normalize(product.name).includes(wanted)) }))
    .filter((category) => category.products.length > 0);
  const soldOut = Object.values(available).filter((value) => !value).length;

  return (
    <div className="mt-6">
      <label htmlFor="buscar-plato" className="block text-base font-medium">
        Buscar un plato
      </label>
      <input
        id="buscar-plato"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoComplete="off"
        className="mt-1 min-h-11 w-full max-w-md rounded-2xl border border-ink/50 bg-white px-4 text-base"
      />
      <p className="mt-3 text-base text-muted" data-testid="resumen-agotados">
        {soldOut === 0 ? "Nada agotado en esta sucursal." : soldOut === 1 ? "1 plato agotado en esta sucursal." : `${soldOut} platos agotados en esta sucursal.`}
      </p>

      {shown.length === 0 ? (
        <p className="mt-6 text-lg text-muted">No encontramos ese plato.</p>
      ) : (
        shown.map((category) => (
          <section key={category.id} aria-labelledby={`cat-${category.id}`} className="panel-cell mt-4">
            <h2 id={`cat-${category.id}`} className="font-display text-2xl">
              {category.name}
            </h2>
            <ul className="mt-2 divide-y divide-ink/15">
              {category.products.map((product) => {
                const isAvailable = available[product.id] ?? product.available;
                return (
                  <li key={product.id} className="py-3" data-testid="plato-cocina" data-plato={product.name} data-disponible={isAvailable ? "true" : "false"}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-lg break-words">{product.name}</p>
                        <p className={`text-base ${isAvailable ? "text-muted" : "font-semibold"}`}>{isAvailable ? "Disponible" : "Agotado"}</p>
                      </div>
                      {isAvailable ? (
                        <button
                          type="button"
                          onClick={() => set(product.id, product.name, false)}
                          disabled={busy === product.id}
                          aria-label={`Marcar agotado: ${product.name}`}
                          className={primaryClass}
                        >
                          {busy === product.id ? "Guardando…" : "Agotado"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => set(product.id, product.name, true)}
                          disabled={busy === product.id}
                          aria-label={`Volver a disponible: ${product.name}`}
                          className={buttonClass}
                        >
                          {busy === product.id ? "Guardando…" : "Hay de nuevo"}
                        </button>
                      )}
                    </div>
                    {notes[product.id] ? (
                      <p role="status" className="mt-2 text-base font-medium">
                        {notes[product.id]}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

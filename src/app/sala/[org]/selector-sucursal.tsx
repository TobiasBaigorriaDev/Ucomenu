"use client";

import { useState } from "react";
import type { SalaBranch } from "@/lib/sala/types";

/**
 * «Qué sucursales miro»: cada persona elige una, varias o todas las de su local. La elección es suya (no un permiso: la base
 * entrega lo mismo a cualquier miembro) y la siguen la sala, el cartel de avisos, el sonido y el aviso de sus dispositivos.
 * Vista vacía = todas. Elegir todas una por una vuelve a «Todas».
 */
export function SelectorDeSucursal({
  branches,
  view,
  saving,
  onChange,
}: {
  branches: SalaBranch[];
  /** Ids elegidos; vacío = todas. */
  view: string[];
  saving: boolean;
  onChange: (next: string[]) => void;
}) {
  const [multiple, setMultiple] = useState(view.length > 1);
  if (branches.length < 2) return null;
  const all = view.length === 0;

  const toggle = (id: string) => {
    if (!multiple) {
      onChange([id]);
      return;
    }
    const current = all ? [] : view;
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    // Ninguna o todas elegidas es «Todas»: nunca queda una vista que no muestre nada.
    onChange(next.length === 0 || next.length === branches.length ? [] : next);
  };

  const chip = (active: boolean) =>
    `inline-flex min-h-11 items-center rounded-full px-4 text-base font-medium disabled:opacity-60 ${
      active ? "bg-brand text-white" : "border border-ink/50 text-ink hover:bg-ink/5"
    }`;

  return (
    <div role="group" aria-labelledby="sucursales-que-miro" data-testid="selector-sucursal" className="panel-cell mb-4 !py-4">
      <p id="sucursales-que-miro" className="text-sm font-medium text-muted">
        Sucursales que mirás
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" aria-pressed={all} disabled={saving} onClick={() => onChange([])} className={chip(all)}>
          Todas
        </button>
        {branches.map((branch) => (
          <button
            key={branch.id}
            type="button"
            aria-pressed={!all && view.includes(branch.id)}
            disabled={saving}
            onClick={() => toggle(branch.id)}
            className={chip(!all && view.includes(branch.id))}
          >
            {branch.name}
          </button>
        ))}
      </div>
      <label className="mt-2 flex min-h-11 w-fit items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={multiple}
          disabled={saving}
          onChange={(event) => setMultiple(event.target.checked)}
          className="h-4 w-4 accent-brand"
        />
        Elegir varias
      </label>
      <p className="mt-2 max-w-prose text-sm text-muted">
        Solo ves y recibís avisos (en pantalla, con sonido y en el celular) de las sucursales elegidas. Se recuerda en todos tus
        dispositivos.
      </p>
    </div>
  );
}

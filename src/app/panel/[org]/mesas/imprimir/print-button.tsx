"use client";

import { primaryButtonClass } from "@/components/panel/styles";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className={primaryButtonClass}>
      Imprimir
    </button>
  );
}

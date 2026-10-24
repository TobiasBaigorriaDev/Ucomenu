"use client";

/** Abre el diálogo de impresión del navegador (o «Guardar como PDF»). No se imprime nada solo. */
export function PrintButton() {
  return (
    <button
      type="button"
      data-testid="imprimir"
      onClick={() => window.print()}
      className="inline-flex min-h-12 items-center justify-center rounded-full bg-cobalt px-6 py-2 text-lg font-medium text-white hover:bg-brand-deep print:hidden"
    >
      Imprimir
    </button>
  );
}

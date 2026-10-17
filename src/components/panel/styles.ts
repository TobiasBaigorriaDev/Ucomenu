/**
 * Clases compartidas de formularios y botones del panel. Viven en un módulo SIN "use client": si se
 * exportaran desde un componente de cliente, un componente de servidor que las importe recibiría una
 * referencia de cliente en vez del texto.
 */
export const inputClass =
  "block min-h-11 w-full rounded-lg border border-ink/60 bg-white px-3 py-2 text-base text-ink placeholder:text-muted/70";
export const labelClass = "block text-sm font-medium text-ink";
export const primaryButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-cobalt px-5 py-2 text-base font-medium text-white hover:bg-brand-deep disabled:opacity-60";
export const secondaryButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-ink/40 bg-transparent px-4 py-2 text-base font-medium text-ink hover:bg-ink/5 disabled:opacity-60";
export const dangerButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-danger px-4 py-2 text-base font-medium text-danger hover:bg-danger/5 disabled:opacity-60";

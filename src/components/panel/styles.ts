/**
 * Clases compartidas de formularios y botones del panel. Viven en un módulo SIN "use client": si se
 * exportaran desde un componente de cliente, un componente de servidor que las importe recibiría una
 * referencia de cliente en vez del texto.
 */
export const inputClass =
  "block min-h-11 w-full rounded-md border border-ink/40 bg-white px-3 py-2 text-base text-ink placeholder:text-muted/70";
export const labelClass = "block text-sm font-medium text-ink";
export const primaryButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-cobalt px-5 py-2 text-base font-medium text-white disabled:opacity-60";
export const secondaryButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-ink/40 bg-transparent px-4 py-2 text-base font-medium text-ink disabled:opacity-60";
export const dangerButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-danger px-4 py-2 text-base font-medium text-danger disabled:opacity-60";

/** Clases comunes de la pantalla «Anotar» (mismos botones que la Sala de llamados). */
export const buttonClass =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-ink/50 px-4 py-2 text-base font-medium text-ink hover:bg-ink/5 disabled:opacity-60";
export const primaryClass =
  "inline-flex min-h-12 items-center justify-center rounded-full bg-cobalt px-6 py-2 text-lg font-medium text-white hover:bg-brand-deep disabled:opacity-60";
export const smallPrimaryClass =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-cobalt px-4 py-2 text-base font-medium text-white hover:bg-brand-deep disabled:opacity-60";
/** Lo que no se deshace (cancelar, anular): borde y texto de peligro, sin depender solo del color (el texto lo dice). */
export const dangerClass =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-suspended-edge px-4 py-2 text-base font-medium text-suspended-ink hover:bg-suspended-bg disabled:opacity-60";
export const dangerPrimaryClass =
  "inline-flex min-h-12 items-center justify-center rounded-full bg-danger px-6 py-2 text-lg font-medium text-white hover:opacity-90 disabled:opacity-60";
export const fieldClass = "min-h-12 w-full rounded-2xl border border-ink/30 bg-white px-4 py-2 text-lg text-ink";
export const errorBoxClass = "rounded-2xl bg-suspended-bg px-4 py-3 text-base text-suspended-ink ring-1 ring-inset ring-suspended-edge";

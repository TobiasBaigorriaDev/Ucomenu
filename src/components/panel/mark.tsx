/** Marca de UcoMenu: dos rombos, el vivo sobre el profundo (el mismo gesto que los rombos del pie de la carta). */
export function Mark({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 28 16" className={className}>
      <path d="M8 0 16 8 8 16 0 8Z" fill="currentColor" />
      <path d="M20 0 28 8 20 16 12 8Z" fill="var(--vivid, var(--carta-terra))" />
    </svg>
  );
}

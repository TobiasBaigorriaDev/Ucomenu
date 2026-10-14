import "./carta.css";

/** Cuadraditos girados sobre el título (como confeti): quedan fuera de la fila de sucursal y mesa. */
const CONFETTI = [
  "left-[6%] top-[9%] size-3 bg-[var(--carta-blush)]",
  "right-[8%] top-[7%] size-2.5 bg-[var(--carta-green)]",
  "left-[24%] top-[15%] size-2 bg-[var(--carta-terra)]",
];

export function MenuHeader({
  organizationName,
  branchName,
  tableLabel,
}: {
  organizationName: string;
  /** La pantalla de «carta no disponible» no muestra sucursal. */
  branchName?: string;
  /** Solo cuando se entró por el QR de una mesa activa. */
  tableLabel?: string | null;
}) {
  return (
    <header className="relative overflow-hidden">
      {CONFETTI.map((position) => (
        <span key={position} aria-hidden="true" className={`pointer-events-none absolute rotate-45 ${position}`} />
      ))}
      <div className="relative mx-auto max-w-3xl px-4 pt-16 pb-10 text-center sm:px-6 sm:pt-24 sm:pb-14">
        <h1 className="carta-title font-display text-balance text-[var(--carta-green)] [overflow-wrap:anywhere]">
          {organizationName}
        </h1>
        {branchName || tableLabel ? (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
            {branchName ? (
              <p className="flex items-center gap-2 text-base text-muted">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="size-[1.125rem] shrink-0 text-[var(--carta-terra)]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" />
                  <circle cx="12" cy="9.5" r="2.5" />
                </svg>
                <span className="[overflow-wrap:anywhere]">Sucursal {branchName}</span>
              </p>
            ) : null}
            {tableLabel ? (
              <p
                data-testid="mesa"
                className="inline-block rounded-full bg-[var(--carta-green)] px-4 py-1.5 text-base font-semibold text-white [overflow-wrap:anywhere]"
              >
                {tableLabel}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}

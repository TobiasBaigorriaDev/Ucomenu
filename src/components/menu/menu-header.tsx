export function MenuHeader({
  organizationName,
  branchName,
  tableLabel,
}: {
  organizationName: string;
  branchName: string;
  /** Solo cuando se entró por el QR de una mesa activa. */
  tableLabel?: string | null;
}) {
  return (
    <header className="tile-band text-white">
      <div className="mx-auto max-w-xl px-4 pt-12 pb-8">
        <h1 className="font-display text-[2.5rem] leading-[1.05] text-balance break-words">{organizationName}</h1>
        <p className="mt-3 text-base text-white/85">Sucursal {branchName}</p>
        {tableLabel ? (
          <p data-testid="mesa" className="mt-3 inline-block border border-white/70 px-3 py-1 text-base font-semibold break-words">
            {tableLabel}
          </p>
        ) : null}
      </div>
    </header>
  );
}

export function MenuUnavailable({ organizationName }: { organizationName: string }) {
  return (
    <>
      <header className="tile-band text-white">
        <div className="mx-auto max-w-xl px-4 pt-12 pb-8">
          <h1 className="font-display text-[2.5rem] leading-[1.05] text-balance break-words">{organizationName}</h1>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 py-16">
        <p className="font-display text-2xl">Carta temporalmente no disponible</p>
        <p className="mt-3 leading-relaxed text-muted">
          El local está actualizando su servicio. Consultá al personal si querés ver la carta ahora.
        </p>
      </main>
    </>
  );
}

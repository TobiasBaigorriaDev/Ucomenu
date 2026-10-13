export function MenuHeader({ organizationName, branchName }: { organizationName: string; branchName: string }) {
  return (
    <header className="tile-band text-white">
      <div className="mx-auto max-w-xl px-4 pt-12 pb-8">
        <h1 className="font-display text-[2.5rem] leading-[1.05] text-balance break-words">{organizationName}</h1>
        <p className="mt-3 text-base text-white/85">Sucursal {branchName}</p>
      </div>
    </header>
  );
}

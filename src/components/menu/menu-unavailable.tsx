import { MenuHeader } from "@/components/menu/menu-header";

export function MenuUnavailable({ organizationName }: { organizationName: string }) {
  return (
    <div className="carta">
      <MenuHeader organizationName={organizationName} />
      <main className="mx-auto max-w-3xl px-4 pb-16 text-center sm:px-6">
        <p className="font-display text-2xl">Carta temporalmente no disponible</p>
        <p className="mx-auto mt-3 max-w-[52ch] leading-relaxed text-muted">
          El local está actualizando su servicio. Consultá al personal si querés ver la carta ahora.
        </p>
      </main>
    </div>
  );
}

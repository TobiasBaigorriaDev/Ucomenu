import { MenuHeader } from "@/components/menu/menu-header";
import type { UnavailableReason } from "@/lib/public-menu";
import { cartaFontClass } from "./carta-fonts";

/** «No disponible» de la carta: la cuenta en pausa (por defecto) o una sucursal desactivada, que se dice sin culpar a la cuenta. */
export function MenuUnavailable({ organizationName, reason = "suspended" }: { organizationName: string; reason?: UnavailableReason }) {
  const inactiveBranch = reason === "branch_inactive";
  return (
    <div className={`${cartaFontClass} carta`}>
      <MenuHeader organizationName={organizationName} />
      <main className="mx-auto max-w-3xl px-4 pb-16 text-center sm:px-6">
        <p className="font-display text-2xl" data-testid="carta-no-disponible">
          {inactiveBranch ? "Esta sucursal no está disponible" : "Carta temporalmente no disponible"}
        </p>
        <p className="mx-auto mt-3 max-w-[52ch] leading-relaxed text-muted">
          {inactiveBranch
            ? "Esta sucursal no está atendiendo por ahora. Consultá al personal si querés ver la carta ahora."
            : "El local está actualizando su servicio. Consultá al personal si querés ver la carta ahora."}
        </p>
      </main>
    </div>
  );
}

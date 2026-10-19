import { MenuHeader } from "@/components/menu/menu-header";
import type { Lang } from "@/lib/idiomas/idiomas";
import { TEXTOS } from "@/lib/idiomas/textos";
import type { UnavailableReason } from "@/lib/public-menu";
import { cartaFontClass } from "./carta-fonts";

/** «No disponible» de la carta: la cuenta en pausa (por defecto) o una sucursal desactivada, que se dice sin culpar a la cuenta. */
export function MenuUnavailable({ organizationName, reason = "suspended", lang = "es" }: { organizationName: string; reason?: UnavailableReason; lang?: Lang }) {
  const inactiveBranch = reason === "branch_inactive";
  const t = TEXTOS[lang].unavailable;
  return (
    <div lang={lang} className={`${cartaFontClass} carta`}>
      <MenuHeader organizationName={organizationName} lang={lang} />
      <main className="mx-auto max-w-3xl px-4 pb-16 text-center sm:px-6">
        <p className="font-display text-2xl" data-testid="carta-no-disponible">
          {inactiveBranch ? t.inactiveTitle : t.suspendedTitle}
        </p>
        <p className="mx-auto mt-3 max-w-[52ch] leading-relaxed text-muted">
          {inactiveBranch ? t.inactiveBody : t.suspendedBody}
        </p>
      </main>
    </div>
  );
}

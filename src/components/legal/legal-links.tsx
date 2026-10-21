import Link from "next/link";
import type { Lang } from "@/lib/idiomas/idiomas";
import { TEXTOS } from "@/lib/idiomas/textos";

export const LEGAL_PAGES = [
  { href: "/terminos", key: "terms" },
  { href: "/privacidad", key: "privacy" },
  { href: "/alergenos", key: "allergens" },
] as const;

/**
 * Enlaces a los tres textos legales. Se usa en el pie de la portada, del login, de la carta y de los propios textos. Los
 * rótulos siguen el idioma de la carta; los textos a los que llevan están solo en español (piden revisión legal).
 *
 * `replace`: entre los propios textos legales los enlaces reemplazan la entrada del historial, para que «Volver» salga de los
 * textos y vuelva a donde estaba la persona (la carta) en un solo paso, sin recorrer cada texto que miró.
 */
export function LegalLinks({ className = "", lang = "es", replace = false }: { className?: string; lang?: Lang; replace?: boolean }) {
  const legal = TEXTOS[lang].legal;
  return (
    <nav aria-label={legal.nav} className={className}>
      <ul className="flex flex-wrap gap-x-5 text-sm">
        {LEGAL_PAGES.map((page) => (
          <li key={page.href}>
            <Link href={page.href} replace={replace} className="inline-flex min-h-11 items-center underline underline-offset-2">
              {legal[page.key]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

import Link from "next/link";

export const LEGAL_PAGES = [
  { href: "/terminos", label: "Términos de uso" },
  { href: "/privacidad", label: "Privacidad" },
  { href: "/alergenos", label: "Aviso de alérgenos" },
] as const;

/** Enlaces a los tres textos legales. Se usa en el pie de la portada, del login, de la carta y de los propios textos. */
export function LegalLinks({ className = "" }: { className?: string }) {
  return (
    <nav aria-label="Información legal" className={className}>
      <ul className="flex flex-wrap gap-x-5 text-sm">
        {LEGAL_PAGES.map((page) => (
          <li key={page.href}>
            <Link href={page.href} className="inline-flex min-h-11 items-center underline underline-offset-2">
              {page.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

import Link from "next/link";
import { LANG_NAME, type Lang } from "@/lib/idiomas/idiomas";
import { TEXTOS } from "@/lib/idiomas/textos";
import { hrefDeIdioma } from "@/lib/llamados/visita";

/**
 * Selector de idioma de la carta. Son enlaces a la misma página con `?lang=`: funcionan sin JavaScript y la elección vive
 * en la dirección (no se guarda nada en el dispositivo). Solo aparece si el local ofrece más de un idioma. Cada idioma se
 * nombra en sí mismo y lleva su `lang`, para que un lector de pantalla lo pronuncie bien. En la mesa conserva la visita (`visit`, el `?v=`
 * de la URL): si no, cambiar de idioma contaría como escanear de nuevo y devolvería los botones de llamado tras un «Reiniciar QR».
 */
export function LanguageSwitcher({ languages, current, visit }: { languages: Lang[]; current: Lang; visit?: string }) {
  if (languages.length < 2) return null;
  return (
    <nav aria-label={TEXTOS[current].languageLabel} data-testid="selector-idioma" className="mx-auto flex max-w-3xl justify-end px-4 pt-4 sm:px-6">
      <ul className="flex flex-wrap justify-end gap-2">
        {languages.map((lang) => (
          <li key={lang}>
            <Link
              href={hrefDeIdioma(lang, visit)}
              replace
              scroll={false}
              lang={lang}
              hrefLang={lang}
              aria-current={lang === current ? "true" : undefined}
              className="carta-chip inline-flex min-h-11 items-center rounded-full border border-[var(--carta-green)] px-4 text-sm font-medium text-[var(--carta-green)] hover:bg-[var(--carta-sand)] aria-[current=true]:bg-[var(--carta-green)] aria-[current=true]:text-[var(--on-accent)]"
            >
              {LANG_NAME[lang]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

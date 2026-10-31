import type { Lang } from "@/lib/idiomas/idiomas";
import { TEXTOS } from "@/lib/idiomas/textos";
import { instagramUrl, whatsappUrl } from "@/lib/identidad/voz";

/** Logos de las apps en una grilla de 24, a un solo color (`currentColor`): siguen la paleta del local y su contraste. */
function InstagramLogo({ className }: { className: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="5.2" />
      <circle cx="12" cy="12" r="4.1" />
      <circle cx="17.4" cy="6.6" r="0.6" fill="currentColor" />
    </svg>
  );
}

function WhatsappLogo({ className }: { className: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.39-1.48-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.07.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35Z" />
      <path d="M12.05 21.78h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.82 9.82 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.88 9.88ZM20.46 3.49A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.17-3.48-8.42Z" />
    </svg>
  );
}

/**
 * Instagram y WhatsApp del local, arriba de la carta y con el logo de cada app. Los enlaces los arma el servidor con identificadores ya
 * validados (`voz.ts`); abren en otra pestaña sin pasar la dirección de la carta. Cada uno es un objetivo táctil de 44 px como mínimo.
 */
export function SocialLinks({ instagram, whatsapp, lang, className = "" }: { instagram?: string | null; whatsapp?: string | null; lang: Lang; className?: string }) {
  if (!instagram && !whatsapp) return null;
  const c = TEXTOS[lang].contact;
  const link = "carta-chip redes-link inline-flex min-h-11 items-center gap-2 rounded-full border-[1.5px] border-current px-4 text-sm font-semibold hover:bg-current/10";
  return (
    <p data-testid="redes" className={`flex flex-wrap items-center gap-2 ${className}`}>
      {instagram ? (
        <a href={instagramUrl(instagram)} target="_blank" rel="noopener noreferrer" aria-label={c.instagram(instagram)} data-testid="contacto-instagram" className={link}>
          <InstagramLogo className="size-5 shrink-0" />
          <span className="[overflow-wrap:anywhere]">@{instagram}</span>
        </a>
      ) : null}
      {whatsapp ? (
        <a href={whatsappUrl(whatsapp)} target="_blank" rel="noopener noreferrer" aria-label={c.whatsapp} data-testid="contacto-whatsapp" className={link}>
          <WhatsappLogo className="size-5 shrink-0" />
          <span>WhatsApp</span>
        </a>
      ) : null}
    </p>
  );
}

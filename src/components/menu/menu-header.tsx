import "./carta.css";
import Image from "next/image";
import type { Lang } from "@/lib/idiomas/idiomas";
import { TEXTOS } from "@/lib/idiomas/textos";
import type { Layout } from "@/lib/identidad/layouts";
import { THEMES, type Theme } from "@/lib/identidad/temas";
import { posterFontSize } from "./poster";
import { TemaIcono } from "./tema-icono";

/**
 * Foto de portada: proporción fija (sin saltos de diseño), recorte centrado y `priority` porque suele ser lo primero que se ve. La vista
 * previa del panel puede pasar una foto recién elegida (`blob:`), que el optimizador no puede leer: esa va sin optimizar.
 */
function CoverPhoto({ src, alt, className }: { src: string; alt: string; className: string }) {
  return (
    <div className={`relative overflow-hidden bg-[var(--carta-sand)] ${className}`}>
      <Image src={src} alt={alt} fill priority unoptimized={src.startsWith("blob:")} sizes="(min-width: 768px) 768px, 100vw" className="object-cover" />
    </div>
  );
}

function PinIcon({ className }: { className: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
}

/**
 * Cabecera del estilo «afiche»: un bloque lleno del color principal del local, a todo el ancho, con el logo sobre una placa del
 * fondo de la carta (el logo se ve sobre el mismo color que en los otros estilos) y el nombre en la condensada, tan grande como
 * entre. Debajo, una franja con la sucursal y la mesa cerrada por un filete grueso de tinta.
 */
function PosterHeader({ organizationName, branchName, tableLabel, logo, lang, theme, tagline, cover }: { organizationName: string; branchName?: string; tableLabel?: string | null; logo?: string | null; lang: Lang; theme: Theme | null; tagline?: string | null; cover?: string | null }) {
  const t = TEXTOS[lang];
  return (
    <header className="mb-6 sm:mb-10">
      {cover ? <CoverPhoto src={cover} alt={t.coverAlt(organizationName)} className="aspect-[16/8] w-full border-b-[3px] border-ink sm:aspect-[16/6]" /> : null}
      <div className="bg-[var(--carta-green)] text-[var(--on-accent)]">
        <div className="mx-auto max-w-3xl px-4 pt-6 pb-5 sm:px-6 sm:pt-10 sm:pb-8">
          {theme ? (
            <p data-testid="tema-saludo" className="mb-5 inline-flex max-w-full items-center gap-2 bg-[var(--carta-blush)] px-3 py-1.5 text-sm font-bold text-ink">
              <TemaIcono name={THEMES[theme].motifs[0]} className="size-4 shrink-0 text-[var(--carta-terra)]" />
              <span className="[overflow-wrap:anywhere]">{THEMES[theme].greeting[lang]}</span>
            </p>
          ) : null}
          {logo ? (
            <div className="mb-4 w-fit bg-porcelain p-2 sm:mb-5">
              <Image src={logo} alt={t.logoAlt(organizationName)} width={192} height={192} className="size-16 object-contain sm:size-20" />
            </div>
          ) : null}
          <div className="@container">
            <h1 className="font-display leading-[0.85] text-balance [overflow-wrap:anywhere]" style={{ fontSize: posterFontSize(organizationName, { min: 3, max: 10 }) }}>
              {organizationName}
            </h1>
          </div>
          {tagline ? <p data-testid="lema" className="mt-3 max-w-prose text-base font-bold [overflow-wrap:anywhere] sm:text-lg">{tagline}</p> : null}
        </div>
      </div>
      {branchName || tableLabel ? (
        <div className="border-b-[3px] border-ink">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-5 gap-y-2 px-4 py-3 sm:px-6">
            {branchName ? (
              <p className="flex items-center gap-2 text-sm font-bold tracking-[0.1em] uppercase">
                <PinIcon className="size-[1.125rem] shrink-0 text-[var(--carta-terra)]" />
                <span className="[overflow-wrap:anywhere]">{t.branch(branchName)}</span>
              </p>
            ) : null}
            {tableLabel ? (
              <p data-testid="mesa" className="inline-block bg-ink px-3 py-1 text-base font-bold text-porcelain uppercase [overflow-wrap:anywhere]">
                {tableLabel}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </header>
  );
}

/**
 * Cabecera del estilo «hoja»: una barra oscura como la de un visor de PDF, con el nombre del local (el único `h1` de la página; el
 * título grande vive dentro de la hoja, decorativo), el lema del local, la sucursal y la mesa. Sin portada ni bloque de color: la hoja
 * es lo que importa (el panel lo avisa al elegir una portada).
 */
function SheetToolbar({ organizationName, branchName, tableLabel, lang, theme, tagline }: { organizationName: string; branchName?: string; tableLabel?: string | null; lang: Lang; theme: Theme | null; tagline?: string | null }) {
  const t = TEXTOS[lang];
  return (
    <header className="bg-ink text-porcelain">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 sm:px-6">
        <h1 className="min-w-0 flex-1 basis-40 text-base leading-tight font-semibold [overflow-wrap:anywhere]">{organizationName}</h1>
        {tagline ? <p data-testid="lema" className="w-full text-sm [overflow-wrap:anywhere]">{tagline}</p> : null}
        {branchName ? <p className="text-sm [overflow-wrap:anywhere]">{t.branch(branchName)}</p> : null}
        {tableLabel ? (
          <p data-testid="mesa" className="inline-block bg-porcelain px-2.5 py-0.5 text-sm font-semibold text-ink [overflow-wrap:anywhere]">
            {tableLabel}
          </p>
        ) : null}
        <p className="w-full text-xs md:hidden">{t.sheetHint}</p>
        {theme ? (
          <p data-testid="tema-saludo" className="inline-flex w-full max-w-full items-center gap-2 text-sm">
            <TemaIcono name={THEMES[theme].motifs[0]} className="size-4 shrink-0" />
            <span className="[overflow-wrap:anywhere]">{THEMES[theme].greeting[lang]}</span>
          </p>
        ) : null}
      </div>
    </header>
  );
}

/**
 * Cabecera editorial: logo y nombre del local lado a lado, en display grande y alineados a la izquierda; debajo, un
 * filete y la línea de sucursal y mesa (datos reales, no una etiqueta decorativa).
 */
export function MenuHeader({
  organizationName,
  branchName,
  tableLabel,
  logo,
  lang = "es",
  theme = null,
  layout,
  tagline = null,
  cover = null,
}: {
  organizationName: string;
  /** La pantalla de «carta no disponible» no muestra sucursal. */
  branchName?: string;
  /** Solo cuando se entró por el QR de una mesa activa. */
  tableLabel?: string | null;
  logo?: string | null;
  lang?: Lang;
  /** Tema de fecha especial vigente: suma un saludo corto arriba del nombre. */
  theme?: Theme | null;
  layout?: Layout;
  /** Lema del local (voz del local): una línea de texto plano bajo el nombre. */
  tagline?: string | null;
  /** Foto de portada del local: va arriba de todo, sin texto encima (el contraste del nombre no depende de la foto). */
  cover?: string | null;
}) {
  const t = TEXTOS[lang];
  if (layout === "hoja") return <SheetToolbar organizationName={organizationName} branchName={branchName} tableLabel={tableLabel} lang={lang} theme={theme} tagline={tagline} />;
  if (layout === "afiche") return <PosterHeader organizationName={organizationName} branchName={branchName} tableLabel={tableLabel} logo={logo} lang={lang} theme={theme} tagline={tagline} cover={cover} />;
  return (
    <header>
      {cover ? (
        <div className="mx-auto max-w-3xl px-4 pt-4 sm:px-6 sm:pt-8">
          <CoverPhoto src={cover} alt={t.coverAlt(organizationName)} className="carta-pieza aspect-[16/9] rounded-3xl" />
        </div>
      ) : null}
      <div className={`carta-cabecera mx-auto max-w-3xl px-4 pb-8 sm:px-6 sm:pb-12 ${cover ? "pt-6 sm:pt-8" : "pt-10 sm:pt-16"}`}>
        {theme ? (
          <p data-testid="tema-saludo" className="carta-pildora mb-5 inline-flex max-w-full items-center gap-2 rounded-full bg-[var(--carta-blush)] px-4 py-1.5 text-sm font-semibold text-ink">
            <TemaIcono name={THEMES[theme].motifs[0]} className="size-4 shrink-0 text-[var(--carta-terra)]" />
            <span className="[overflow-wrap:anywhere]">{THEMES[theme].greeting[lang]}</span>
          </p>
        ) : null}
        <div className="flex items-center gap-4 sm:gap-6">
          {logo ? (
            <Image
              src={logo}
              alt={t.logoAlt(organizationName)}
              width={192}
              height={192}
              className="size-16 shrink-0 object-contain sm:size-24"
            />
          ) : null}
          <h1
            className={`carta-title ${logo ? "carta-title-con-logo " : ""}min-w-0 font-display text-balance text-[var(--carta-green)] [overflow-wrap:anywhere]`}
          >
            {organizationName}
          </h1>
        </div>
        {tagline ? <p data-testid="lema" className="mt-4 max-w-prose text-lg leading-snug text-muted [overflow-wrap:anywhere] sm:text-xl">{tagline}</p> : null}
        {branchName || tableLabel ? (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-x-5 gap-y-3 border-t-[1.5px] border-ink pt-3">
            {branchName ? (
              <p className="flex items-center gap-2 text-base text-muted">
                <PinIcon className="size-[1.125rem] shrink-0 text-[var(--carta-terra)]" />
                <span className="[overflow-wrap:anywhere]">{t.branch(branchName)}</span>
              </p>
            ) : null}
            {tableLabel ? (
              <p
                data-testid="mesa"
                className="carta-pildora inline-block rounded-full bg-[var(--carta-green)] px-4 py-1.5 text-base font-semibold text-[var(--on-accent)] [overflow-wrap:anywhere]"
              >
                {tableLabel}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}

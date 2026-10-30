import Image from "next/image";
import { DIETARY_TAGS } from "@/lib/carta/dietary";
import type { Lang } from "@/lib/idiomas/idiomas";
import { TEXTOS } from "@/lib/idiomas/textos";
import type { MenuSection as Section } from "@/lib/menu";
import { MenuSection } from "./menu-section";
import { DIETARY_ABBR, usedDietaryTags } from "./sheet";
import { SheetFit } from "./sheet-fit";

export type SheetTitle = { name: string; logo?: string | null };

/**
 * La carta de estilo «hoja»: una página de PDF de ancho fijo con el título del local arriba (decorativo: el `h1` está en la barra) y
 * todas las categorías en 2 columnas que se llenan de arriba abajo; cada fila y cada título evitan partirse entre columnas. Debajo,
 * la leyenda de las siglas que aparecen. `SheetFit` la escala para verla entera y la persona amplía. Lo usan la carta pública y la
 * vista previa del panel.
 */
export function SheetView({ sections, title, lang }: { sections: Section[]; title?: SheetTitle; lang: Lang }) {
  const t = TEXTOS[lang];
  const used = usedDietaryTags(sections, DIETARY_TAGS);
  return (
    <SheetFit>
      {title ? (
        <div aria-hidden="true" className="mb-6 flex items-start justify-between gap-6">
          <p className="min-w-0 font-display text-[3.25rem] leading-[0.95] text-[var(--carta-terra)] [overflow-wrap:anywhere]">{title.name}</p>
          {title.logo ? <Image src={title.logo} alt="" width={160} height={160} className="size-20 shrink-0 object-contain" /> : null}
        </div>
      ) : null}
      <div className="sheet-columns columns-2 gap-x-8">
        {sections.map((section, i) => <MenuSection key={section.category.id} section={section} index={i} lang={lang} layout="hoja" />)}
      </div>
      {used.length ? (
        <p aria-hidden="true" className="mt-1 flex flex-wrap gap-x-4 gap-y-1 border-t border-ink/20 pt-2 text-[0.6875rem] text-muted">
          {used.map((tag) => (
            <span key={tag}>
              <span className="font-bold text-[var(--carta-green)]">{DIETARY_ABBR[tag]}</span> {t.dietary[tag]}
            </span>
          ))}
        </p>
      ) : null}
    </SheetFit>
  );
}

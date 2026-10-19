import { DIETARY_TAGS } from "@/lib/carta/dietary";
import type { Lang } from "@/lib/idiomas/idiomas";
import { TEXTOS } from "@/lib/idiomas/textos";

export function DietaryLabels({ tags, lang }: { tags?: string[]; lang: Lang }) {
  const declared = DIETARY_TAGS.filter((tag) => tags?.includes(tag));
  if (!declared.length) return null;
  const t = TEXTOS[lang].dietary;
  return (
    <ul aria-label={t.list} className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm font-medium text-[var(--carta-green)]">
      {declared.map((tag) => <li key={tag}>{t[tag]}</li>)}
    </ul>
  );
}

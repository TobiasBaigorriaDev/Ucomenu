import { DIETARY_LABEL, DIETARY_TAGS } from "@/lib/carta/dietary";

export function DietaryLabels({ tags }: { tags?: string[] }) {
  const declared = DIETARY_TAGS.filter((tag) => tags?.includes(tag));
  if (!declared.length) return null;
  return (
    <ul aria-label="Etiquetas dietarias declaradas por el local" className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm font-medium text-[var(--carta-green)]">
      {declared.map((tag) => <li key={tag}>{DIETARY_LABEL[tag]}</li>)}
    </ul>
  );
}

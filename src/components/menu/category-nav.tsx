import type { MenuSection } from "@/lib/menu";

export function categoryAnchor(categoryId: string): string {
  return `cat-${categoryId}`;
}

/** Salto directo a cada categoría. Se queda fijo arriba mientras se baja por la carta. */
export function CategoryNav({ sections }: { sections: MenuSection[] }) {
  return (
    <nav
      aria-label="Categorías de la carta"
      className="sticky top-0 z-10 border-b border-ink/15 bg-porcelain/95 backdrop-blur"
    >
      <ul className="mx-auto flex max-w-xl gap-6 overflow-x-auto px-4 [scrollbar-width:none]">
        {sections.map(({ category }) => (
          <li key={category.id} className="shrink-0">
            <a
              href={`#${categoryAnchor(category.id)}`}
              className="block py-3.5 text-[0.95rem] font-semibold text-ink decoration-cobalt decoration-2 underline-offset-[0.55rem] hover:underline"
            >
              {category.name}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

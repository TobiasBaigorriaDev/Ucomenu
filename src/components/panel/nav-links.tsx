"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavGlyph, type NavIcon } from "./nav-icons";

export type NavItem = { href: string; label: string; exact?: boolean; icon?: NavIcon; group?: string };

/**
 * Navegación del área. Una sola `<nav>`: en celular son chips que se desplazan de costado (rosa en reposo, verde la
 * sección actual, como la barra de categorías de la carta) y en escritorio la lista vertical del riel. La página actual
 * lleva `aria-current`. Los rótulos de grupo son solo visuales.
 */
export function NavLinks({ items, label }: { items: NavItem[]; label: string }) {
  const pathname = usePathname();

  return (
    <nav aria-label={label} className="panel-chips -mx-4 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0">
      <ul className="flex min-w-max gap-2 py-1 lg:min-w-0 lg:flex-col lg:gap-1 lg:py-0">
        {items.map((item, index) => {
          const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const newGroup = item.group && item.group !== items[index - 1]?.group;
          return (
            <li key={item.href} className="shrink-0 lg:shrink">
              {newGroup ? (
                <span aria-hidden className="hidden px-3 pt-4 pb-1 text-[0.8125rem] font-semibold text-white/75 lg:block">
                  {item.group}
                </span>
              ) : null}
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`panel-nav-link inline-flex min-h-11 items-center gap-3 rounded-full px-4 text-[0.9375rem] font-medium whitespace-nowrap lg:flex lg:rounded-2xl lg:px-3 ${
                  active
                    ? "bg-brand text-white lg:bg-porcelain lg:text-ink"
                    : "bg-blush text-ink hover:bg-sand lg:bg-transparent lg:text-white lg:hover:bg-white/10"
                }`}
              >
                {item.icon ? <NavGlyph name={item.icon} className="hidden size-5 shrink-0 lg:block" /> : null}
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

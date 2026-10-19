import type { MenuOption, MenuOptionGroup, MenuProduct, MenuSection } from "@/lib/menu";
import { BASE_LANG, TRANSLATED_LANGS, type Lang } from "./idiomas";
import { hasTranslation, translated, type Translations } from "./traducciones";

/**
 * Idiomas que ofrece la carta: el español y los que tengan al menos un texto traducido en lo que se publica. No hay un
 * interruptor aparte: el local ofrece un idioma al cargar su primera traducción (ficha carta-en-varios-idiomas).
 */
export function offeredLanguages(sections: MenuSection[]): Lang[] {
  const found = new Set<Lang>([BASE_LANG]);
  const look = (translations: Translations | undefined) => {
    for (const lang of TRANSLATED_LANGS) if (hasTranslation(translations, lang)) found.add(lang);
  };
  for (const { category, products } of sections) {
    look(category.translations);
    for (const product of products) {
      look(product.translations);
      for (const group of product.option_groups ?? []) {
        look(group.translations);
        for (const option of group.options) look(option.translations);
      }
    }
  }
  return [BASE_LANG, ...TRANSLATED_LANGS].filter((lang): lang is Lang => found.has(lang as Lang));
}

function localizeOption({ translations, ...option }: MenuOption, lang: Lang): Omit<MenuOption, "translations"> {
  return { ...option, name: translated(option.name, translations, lang, "name") };
}

function localizeGroup({ translations, options, ...group }: MenuOptionGroup, lang: Lang): MenuOptionGroup {
  return { ...group, name: translated(group.name, translations, lang, "name"), options: options.map((option) => localizeOption(option, lang)) };
}

function localizeProduct({ translations, option_groups, ...product }: MenuProduct, lang: Lang): MenuProduct {
  return {
    ...product,
    name: translated(product.name, translations, lang, "name"),
    description: translated(product.description, translations, lang, "description"),
    ...(option_groups ? { option_groups: option_groups.map((group) => localizeGroup(group, lang)) } : {}),
  };
}

/**
 * Las secciones con los textos en `lang`; lo que no tiene traducción queda en español. El orden no cambia (se decidió con
 * el español) y las traducciones se quitan del resultado: la carta no manda al navegador textos de otros idiomas.
 */
export function localizeSections(sections: MenuSection[], lang: Lang): MenuSection[] {
  return sections.map(({ category: { translations, ...category }, products }) => ({
    category: { ...category, name: translated(category.name, translations, lang, "name") },
    products: products.map((product) => localizeProduct(product, lang)),
  }));
}

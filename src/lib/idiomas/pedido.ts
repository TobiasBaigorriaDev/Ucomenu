import { headers } from "next/headers";
import type { PublicMenu } from "@/lib/public-menu";
import { LANGS, resolveLang, type Lang } from "./idiomas";
import { localizeSections } from "./localizar";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Idioma de este pedido de la carta pública: el de `?lang=` si el local lo ofrece, si no el del navegador (`Accept-Language`)
 * y si no el español. Sin cookies ni almacenamiento: ver `resolveLang`. Leer la cabecera hace dinámica la página, como ya era.
 */
export async function requestLang(searchParams: SearchParams, available: readonly Lang[]): Promise<Lang> {
  return resolveLang({ param: searchParams.lang, acceptLanguage: (await headers()).get("accept-language"), available });
}

/** Para las pantallas sin carta («no disponible», no encontrada): no hay traducciones que consultar, vale cualquier idioma. */
export function requestLangForNotice(searchParams: SearchParams): Promise<Lang> {
  return requestLang(searchParams, LANGS);
}

/** La carta con sus textos en el idioma del pedido. */
export async function localizedMenu(menu: PublicMenu, searchParams: SearchParams): Promise<{ menu: PublicMenu; lang: Lang }> {
  const lang = await requestLang(searchParams, menu.languages);
  return { menu: { ...menu, sections: localizeSections(menu.sections, lang) }, lang };
}

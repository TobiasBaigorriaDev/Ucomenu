import type { Metadata } from "next";
import Link from "next/link";
import { getEntitlements, requireMembership } from "@/lib/auth/session";
import { writeBlockNotice } from "@/lib/carta/messages";
import { getTranslationProvider } from "@/lib/idiomas/gemini";
import { isTranslatedLang, LANG_NAME, TRANSLATED_LANGS, type TranslatedLang } from "@/lib/idiomas/idiomas";
import { loadTranslationTree, translationProgress } from "@/lib/idiomas/panel";
import { createSessionClient } from "@/lib/supabase/server";
import { TranslationsForm } from "./traducciones-form";

export const metadata: Metadata = { title: "Traducciones de la carta" };

export default async function TraduccionesPage({ params, searchParams }: PageProps<"/panel/[org]/carta/traducciones">) {
  const { org } = await params;
  const { idioma } = await searchParams;
  const { membership } = await requireMembership(org, `/panel/${org}/carta/traducciones`);
  const lang: TranslatedLang = isTranslatedLang(idioma) ? idioma : TRANSLATED_LANGS[0];

  const db = await createSessionClient();
  const [tree, ent] = await Promise.all([loadTranslationTree(db, membership.org.id), getEntitlements(membership.org.id)]);
  const canWrite = ent?.canWrite === true;
  const notice = writeBlockNotice(ent);
  const progress = translationProgress(tree, lang);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:px-10 lg:py-12">
      <Link href={`/panel/${membership.org.slug}/carta`} className="inline-flex min-h-11 items-center text-base text-cobalt underline underline-offset-2">
        Volver a la carta
      </Link>
      <h1 className="font-display text-4xl leading-tight">Traducciones de la carta</h1>
      <p className="mt-2 max-w-prose text-base text-muted">
        Escribí cómo se llama cada categoría, plato y opción en otro idioma. Lo que dejes vacío se muestra en español. El selector de
        idioma aparece en la carta apenas cargues el primer texto en ese idioma. Los textos legales siguen en español.
      </p>
      <p className="mt-2 max-w-prose text-base text-muted" data-testid="aviso-traducciones-obsoletas">
        Si cambiás en español el nombre o la descripción de un plato, o el nombre de una variante o un adicional, sus traducciones
        se borran al guardar: así la carta nunca muestra en otro idioma un texto que ya no es el vigente (por ejemplo, un
        ingrediente que cambió). Volvé a traducirlo después.
      </p>
      {notice ? (
        <p className="mt-3 max-w-prose text-base font-medium" data-testid="carta-bloqueada">
          {notice}
        </p>
      ) : null}

      <nav aria-label="Idioma a traducir" className="mt-6">
        <ul className="flex flex-wrap gap-2">
          {TRANSLATED_LANGS.map((code) => (
            <li key={code}>
              <Link
                href={`/panel/${membership.org.slug}/carta/traducciones?idioma=${code}`}
                aria-current={code === lang ? "page" : undefined}
                className="inline-flex min-h-11 items-center rounded-full border border-ink/40 px-4 text-base font-medium text-ink hover:bg-ink/5 aria-[current=page]:border-cobalt aria-[current=page]:bg-cobalt aria-[current=page]:text-white"
              >
                {LANG_NAME[code]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <p className="mt-3 text-base" data-testid="progreso-traduccion">
        Traducido al {LANG_NAME[lang]}:{" "}
        <span className="font-medium tabular-nums">
          {progress.done} de {progress.total}
        </span>{" "}
        textos
      </p>

      {tree.length === 0 ? (
        <p className="mt-8 max-w-prose text-lg text-muted">Todavía no hay nada para traducir. Cargá primero las categorías y los platos.</p>
      ) : (
        <TranslationsForm key={lang} orgSlug={membership.org.slug} lang={lang} tree={tree} canWrite={canWrite} canSuggest={getTranslationProvider() !== null} />
      )}
    </main>
  );
}

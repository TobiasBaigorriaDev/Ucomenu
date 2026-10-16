import Link from "next/link";
import type { ReactNode } from "react";
import { LEGAL_UPDATED_AT } from "@/lib/legal";
import { LegalLinks } from "./legal-links";

/** Marco común de los textos legales: título, fecha de actualización, cuerpo y enlaces a los otros dos. */
export function LegalDocument({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <p className="text-sm text-muted">
        <Link href="/" className="font-display text-cobalt underline-offset-2 hover:underline">
          UcoMenu
        </Link>
      </p>
      <h1 className="mt-4 font-display text-4xl leading-tight text-balance">{title}</h1>
      <p className="mt-2 text-sm text-muted">Actualizado el {LEGAL_UPDATED_AT}</p>
      <p className="mt-6 text-lg leading-relaxed">{intro}</p>
      <div className="mt-8 grid gap-8">{children}</div>
      <LegalLinks className="mt-12 border-t border-ink/15 pt-6" />
    </main>
  );
}

/** Una sección numerada del texto: `<h2>` y párrafos o listas. */
export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-2xl leading-snug">{title}</h2>
      <div className="mt-3 grid gap-3 leading-relaxed text-pretty [&_li]:mt-1.5 [&_ul]:list-disc [&_ul]:pl-5">{children}</div>
    </section>
  );
}

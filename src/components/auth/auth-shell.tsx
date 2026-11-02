import type { ReactNode } from "react";
import { cartaFontClass } from "@/components/menu/carta-fonts";
import { LegalLinks } from "@/components/legal/legal-links";
import { Mark } from "@/components/panel/mark";
import { platformStyle } from "@/lib/identidad/palettes";

/**
 * Marco de las pantallas de acceso. Todavía no se sabe de qué local es la persona, así que usa el lenguaje del panel con la paleta de
 * UcoNext (la misma de SuperAdmin) y la tipografía de la carta: una celda de marca y una celda con el formulario.
 */
export function AuthShell({ title, lead, heading, children }: { title: string; lead: string; heading: string; children: ReactNode }) {
  return (
    <div className={`${cartaFontClass} panel`} style={platformStyle()}>
      <div className="mx-auto grid min-h-screen max-w-5xl content-center gap-4 px-4 py-6 sm:px-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-5 lg:px-10 lg:py-12">
        <header className="relative flex min-h-48 flex-col justify-between gap-10 overflow-hidden rounded-3xl bg-brand-deep p-6 text-white lg:min-h-[32rem] lg:p-8">
          <Mark className="absolute -top-6 -right-8 h-28 w-auto text-white/10 lg:-top-10 lg:-right-12 lg:h-56" />
          <p className="relative flex items-center gap-2.5 font-display text-[1.625rem] leading-none">
            <Mark className="h-4 w-7 shrink-0 text-white" />
            UcoMenú
          </p>
          <div className="relative">
            <p className="font-display text-[clamp(2.25rem,1.5rem+4vw,3.5rem)] leading-[0.98] tracking-[-0.015em] text-balance">{title}</p>
            <p className="mt-3 max-w-[32ch] text-base leading-relaxed text-white/85">{lead}</p>
          </div>
        </header>
        <main id="contenido" className="panel-cell flex flex-col justify-center lg:p-8">
          <h1 className="font-display">{heading}</h1>
          {children}
          <LegalLinks className="mt-4 text-muted" />
        </main>
      </div>
    </div>
  );
}

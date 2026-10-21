"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { primaryButtonClass, secondaryButtonClass } from "@/components/panel/styles";

export type EnlaceDeSalida = { href: string; label: string };

type Props = {
  title: string;
  children: ReactNode;
  /** Muestra «Reintentar»: solo en los límites de error (`error.tsx`). */
  onRetry?: () => void;
  /** Adónde seguir: siempre al menos uno, para que nadie quede sin salida. */
  links?: EnlaceDeSalida[];
  /**
   * `marco`: dentro del marco de `/panel`, `/sala` o `/admin` (el menú sigue a la vista). `pagina`: pantalla completa, para
   * lo público y para lo que falla por encima del marco.
   */
  donde: "marco" | "pagina";
};

/** Pantalla de error o de «no encontrado», con el mismo aspecto que el resto de cada zona. */
export function PantallaDeEstado({ title, children, onRetry, links = [], donde }: Props) {
  if (donde === "marco") {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:px-10 lg:py-12">
        <h1 className="font-display text-4xl leading-tight">{title}</h1>
        <p className="mt-3 max-w-prose text-lg leading-relaxed text-muted">{children}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          {onRetry ? (
            <button type="button" onClick={onRetry} className={primaryButtonClass}>
              Reintentar
            </button>
          ) : null}
          {links.map((link, index) => (
            <Link key={link.href} href={link.href} className={onRetry || index > 0 ? secondaryButtonClass : primaryButtonClass}>
              {link.label}
            </Link>
          ))}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4 py-16">
      <h1 className="font-display text-4xl leading-tight text-cobalt">{title}</h1>
      <p className="mt-4 text-lg leading-relaxed text-muted">{children}</p>
      <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2">
        {onRetry ? (
          <button type="button" onClick={onRetry} className="rounded-md bg-cobalt px-5 py-3 text-base font-semibold text-white">
            Reintentar
          </button>
        ) : null}
        {links.map((link) => (
          <Link key={link.href} href={link.href} className="inline-flex min-h-11 items-center text-base text-cobalt underline underline-offset-2">
            {link.label}
          </Link>
        ))}
      </div>
    </main>
  );
}

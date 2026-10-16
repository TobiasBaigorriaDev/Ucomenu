"use client";

import Image from "next/image";
import { useState } from "react";

/**
 * Miniatura de un plato en la lista. Si no hay foto, o si no carga (archivo borrado, Storage caído), muestra un
 * marcador neutro con un cubierto: no finge ser una foto. Tamaño fijo para que la lista no salte al cargar.
 * La foto se sirve reducida y en WebP (`/_next/image`): `width` es el lado mayor del marco (`sm:size-24` = 96 px) y el
 * navegador pide 96 px o 192 px según su densidad de pantalla. Ver ficha rendimiento-carta-publica.
 */
export function DishPhoto({ src, name }: { src: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  const frame = "size-20 shrink-0 overflow-hidden rounded-2xl bg-[var(--carta-sand)] sm:size-24";

  if (!src || failed) {
    return (
      <div aria-hidden="true" className={`${frame} grid place-items-center text-muted/60`}>
        <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10" />
          <path d="M17 21V3c-2 1.5-3 4-3 7 0 2 1 3 3 3" />
        </svg>
      </div>
    );
  }

  return (
    <div className={frame}>
      <Image
        ref={(img) => {
          // Un error anterior a la hidratación no dispara `onError`: se lo detecta acá.
          if (img?.complete && img.naturalWidth === 0) queueMicrotask(() => setFailed(true));
        }}
        src={src}
        alt={`Foto de ${name}`}
        width={96}
        height={96}
        loading="lazy"
        onError={() => setFailed(true)}
        className="size-full object-cover"
      />
    </div>
  );
}

import Image from "next/image";
import type { Imagen } from "./imagenes";

/** Teléfono con marco CSS alrededor de una captura real. El ancho lo fija `--w` (en CSS); `sizes` le dice al navegador cuánto baja. */
export function Phone({ img, className = "", sizes, priority = false }: { img: Imagen; className?: string; sizes: string; priority?: boolean }) {
  return (
    <div className={`mk-phone ${className}`}>
      <div className="mk-phone-screen">
        <Image src={img.src} alt={img.alt} width={img.w} height={img.h} sizes={sizes} priority={priority} quality={75} />
      </div>
    </div>
  );
}

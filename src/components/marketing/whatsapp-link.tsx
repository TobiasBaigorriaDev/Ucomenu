import type { ReactNode } from "react";
import { whatsappUrl } from "@/lib/marketing/contacto";

/** Enlace que abre WhatsApp con un mensaje prellenado. Se abre en otra pestaña, y se avisa a quien usa lector de pantalla. */
export function WhatsappLink({ children, className = "", mensaje }: { children: ReactNode; className?: string; mensaje?: string }) {
  return (
    <a href={whatsappUrl(mensaje)} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
      <span className="sr-only"> (se abre WhatsApp)</span>
    </a>
  );
}

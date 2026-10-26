import type { ReactNode } from "react";
import { LEGAL_ENTITY, contactEmail } from "@/lib/legal";

/**
 * Datos que el usuario todavía no decidió (ficha informacion-alimentaria-y-textos-legales): se muestran como pendientes a la vista
 * en lugar de inventarlos o de omitirlos en silencio. `docs/produccion.md` bloquea la salida a producción mientras haya alguno.
 */
export function LegalPending({ children }: { children: ReactNode }) {
  return (
    <strong data-testid="pendiente-legal" className="rounded bg-sand px-1.5 py-0.5 font-semibold">
      [Pendiente de definir antes del lanzamiento: {children}]
    </strong>
  );
}

/** Quién opera UcoMenu: razón social, CUIT y domicilio, o el aviso de que faltan. */
export function LegalEntityText() {
  if (!LEGAL_ENTITY) return <LegalPending>razón social, CUIT y domicilio de quien opera UcoMenu</LegalPending>;
  return (
    <>
      {LEGAL_ENTITY.name}, CUIT {LEGAL_ENTITY.taxId}, con domicilio en {LEGAL_ENTITY.address}
    </>
  );
}

/** El canal de contacto: el correo como enlace, o el aviso de que falta. */
export function LegalContactText() {
  const email = contactEmail();
  if (!email) return <LegalPending>correo de contacto</LegalPending>;
  return (
    <a href={`mailto:${email}`} className="underline underline-offset-2">
      {email}
    </a>
  );
}

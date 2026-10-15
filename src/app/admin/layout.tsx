import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/panel/app-shell";
import { requirePlatformAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Área del SuperAdmin. El layout también exige el rol como segunda barrera: si una página futura olvidara su propia
 * comprobación, igual no se renderizaría para quien no es SuperAdmin en la carga inicial. Un layout NO se re-ejecuta al
 * navegar entre páginas hijas: cada página y cada acción vuelven a exigirlo. Quien no es SuperAdmin recibe el 404 general
 * de la aplicación, sin este marco (el 404 de una página sube hasta el `not-found` de la raíz).
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requirePlatformAdmin("/admin");
  return <AppShell area="admin">{children}</AppShell>;
}

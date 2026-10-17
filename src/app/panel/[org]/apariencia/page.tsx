import type { Metadata } from "next";
import { getEntitlements, requireOwner } from "@/lib/auth/session";
import { loadIdentity } from "@/lib/identidad/identity";
import { logoUrl } from "@/lib/identidad/logos";
import { createSessionClient } from "@/lib/supabase/server";
import { LogoForm, PaletteForm } from "./appearance-forms";

export const metadata: Metadata = { title: "Apariencia" };

export default async function AparienciaPage({ params }: PageProps<"/panel/[org]/apariencia">) {
  const { org } = await params;
  const { membership } = await requireOwner(org, `/panel/${org}/apariencia`);
  const db = await createSessionClient();
  const [identity, ent] = await Promise.all([loadIdentity(db, membership.org.id), getEntitlements(membership.org.id)]);
  const canWrite = ent?.canWrite === true;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="font-display text-4xl leading-tight">Apariencia</h1>
      <p className="mt-2 max-w-prose text-base text-muted">El logo y los colores identifican a tu local en la carta de todas tus sucursales.</p>
      {!canWrite ? <p className="mt-4 font-medium">Podés ver tu apariencia, pero no editarla mientras la cuenta no permita cambios.</p> : null}
      <section aria-labelledby="colores" className="mt-8 border-t border-ink/15 pt-6">
        <h2 id="colores" className="font-display text-2xl">Colores de la carta</h2>
        <p className="mt-2 text-base text-muted">Elegí una paleta. La vista previa cambia al seleccionarla; publicala cuando estés conforme.</p>
        <PaletteForm orgSlug={org} name={membership.org.name} palette={identity.menu_palette} canWrite={canWrite} />
      </section>
      <section aria-labelledby="logo" className="mt-10 border-t border-ink/15 pt-6">
        <h2 id="logo" className="font-display text-2xl">Logo del local</h2>
        <p className="mt-2 text-base text-muted">Se muestra completo, junto al nombre del local. PNG, JPEG o WebP, hasta 2 MB. Si tiene fondo transparente, se conserva.</p>
        <LogoForm orgSlug={org} name={membership.org.name} currentUrl={logoUrl(identity.logo_path)} canWrite={canWrite} />
      </section>
    </main>
  );
}

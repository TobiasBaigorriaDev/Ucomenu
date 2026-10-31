import type { Metadata } from "next";
import { getEntitlements, requireOwner } from "@/lib/auth/session";
import { readLook } from "@/lib/identidad/apariencia";
import { loadIdentity } from "@/lib/identidad/identity";
import { isLayout } from "@/lib/identidad/layouts";
import { coverUrl, logoUrl } from "@/lib/identidad/logos";
import { isPalette } from "@/lib/identidad/palettes";
import { themeStatus } from "@/lib/identidad/temas";
import { readVoice } from "@/lib/identidad/voz";
import { createSessionClient } from "@/lib/supabase/server";
import { AparienciaStudio } from "./apariencia-studio";

export const metadata: Metadata = { title: "Apariencia" };

export default async function AparienciaPage({ params }: PageProps<"/panel/[org]/apariencia">) {
  const { org } = await params;
  const { membership } = await requireOwner(org, `/panel/${org}/apariencia`);
  const db = await createSessionClient();
  const [identity, ent] = await Promise.all([loadIdentity(db, membership.org.id), getEntitlements(membership.org.id)]);
  const canWrite = ent?.canWrite === true;
  const look = readLook(identity);

  return (
    <main className="mx-auto max-w-7xl px-4 2xl:max-w-[96rem] py-8 sm:px-8 lg:px-10 lg:py-12">
      <h1 className="font-display text-4xl leading-tight">Apariencia</h1>
      <p className="mt-2 max-w-prose text-base text-muted">El logo, los colores, la tipografía, el estilo, los datos y las fechas especiales identifican a tu local en la carta de todas tus sucursales. Probá lo que quieras: la vista previa muestra los cambios antes de guardarlos.</p>
      {!canWrite ? <p className="mt-4 font-medium">Podés ver tu apariencia, pero no editarla mientras la cuenta no permita cambios.</p> : null}
      <AparienciaStudio
        orgSlug={org}
        name={membership.org.name}
        canWrite={canWrite}
        logoUrl={logoUrl(identity.logo_path)}
        coverUrl={coverUrl(identity.cover_path)}
        saved={{
          style: {
            palette: isPalette(identity.menu_palette) ? identity.menu_palette : "oliva",
            layout: isLayout(identity.menu_layout) ? identity.menu_layout : "bento",
            font: look.font, shape: look.shape, density: look.density, ambient: look.ambient,
          },
          theme: identity.menu_theme,
          themeFrom: identity.menu_theme_from,
          themeUntil: identity.menu_theme_until,
          voice: readVoice(identity),
        }}
        themeStatus={themeStatus({ theme: identity.menu_theme, from: identity.menu_theme_from, until: identity.menu_theme_until }, new Date())}
      />
    </main>
  );
}

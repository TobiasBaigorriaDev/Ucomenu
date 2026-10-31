import type { Metadata } from "next";
import { getEntitlements, requireOwner } from "@/lib/auth/session";
import { readLook } from "@/lib/identidad/apariencia";
import { loadIdentity } from "@/lib/identidad/identity";
import { isLayout } from "@/lib/identidad/layouts";
import { coverUrl, logoUrl } from "@/lib/identidad/logos";
import { createSessionClient } from "@/lib/supabase/server";
import { themeStatus } from "@/lib/identidad/temas";
import { readVoice } from "@/lib/identidad/voz";
import { LayoutForm, LogoForm, PaletteForm, ThemeForm } from "./appearance-forms";
import { AmbientForm, CoverForm, FontForm, ShapeForm, VoiceForm } from "./look-forms";

export const metadata: Metadata = { title: "Apariencia" };

export default async function AparienciaPage({ params }: PageProps<"/panel/[org]/apariencia">) {
  const { org } = await params;
  const { membership } = await requireOwner(org, `/panel/${org}/apariencia`);
  const db = await createSessionClient();
  const [identity, ent] = await Promise.all([loadIdentity(db, membership.org.id), getEntitlements(membership.org.id)]);
  const canWrite = ent?.canWrite === true;
  const look = readLook(identity);
  const common = { orgSlug: org, name: membership.org.name, palette: identity.menu_palette, logo: logoUrl(identity.logo_path), layout: identity.menu_layout, look, canWrite };

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:px-10 lg:py-12">
      <h1 className="font-display text-4xl leading-tight">Apariencia</h1>
      <p className="mt-2 max-w-prose text-base text-muted">El logo, los colores, la tipografía, el estilo, los datos y las fechas especiales identifican a tu local en la carta de todas tus sucursales.</p>
      {!canWrite ? <p className="mt-4 font-medium">Podés ver tu apariencia, pero no editarla mientras la cuenta no permita cambios.</p> : null}
      <section aria-labelledby="colores" className="panel-cell mt-8">
        <h2 id="colores" className="font-display text-2xl">Colores de la carta</h2>
        <p className="mt-2 text-base text-muted">Elegí una paleta. La vista previa cambia al seleccionarla; publicala cuando estés conforme.</p>
        <PaletteForm orgSlug={org} name={membership.org.name} palette={identity.menu_palette} logo={logoUrl(identity.logo_path)} layout={isLayout(identity.menu_layout) ? identity.menu_layout : "bento"} look={look} canWrite={canWrite} />
      </section>
      <section aria-labelledby="estilo" className="panel-cell mt-6">
        <h2 id="estilo" className="font-display text-2xl">Estilo de la carta</h2>
        <p className="mt-2 text-base text-muted">Cómo se muestran las categorías y los platos. Los datos, las fotos y los colores son los mismos; cambia la composición.</p>
        <LayoutForm orgSlug={org} name={membership.org.name} palette={identity.menu_palette} logo={logoUrl(identity.logo_path)} layout={identity.menu_layout} look={look} canWrite={canWrite} />
      </section>
      <section aria-labelledby="tipografia" className="panel-cell mt-6">
        <h2 id="tipografia" className="font-display text-2xl">Tipografía</h2>
        <p className="mt-2 text-base text-muted">La voz de los títulos: el nombre del local y las categorías. El resto del texto no cambia.</p>
        <FontForm {...common} />
      </section>
      <section aria-labelledby="forma" className="panel-cell mt-6">
        <h2 id="forma" className="font-display text-2xl">Forma y densidad</h2>
        <p className="mt-2 text-base text-muted">Esquinas redondeadas o rectas, bordes marcados y más o menos espacio entre platos.</p>
        <ShapeForm {...common} />
      </section>
      <section aria-labelledby="ambientacion" className="panel-cell mt-6">
        <h2 id="ambientacion" className="font-display text-2xl">Ambientación</h2>
        <p className="mt-2 text-base text-muted">Una textura suave de fondo y adornos propios en el pie de la carta, todo el año.</p>
        <AmbientForm {...common} />
      </section>
      <section aria-labelledby="fecha-especial" className="panel-cell mt-6">
        <h2 id="fecha-especial" className="font-display text-2xl">Fecha especial</h2>
        <p className="mt-2 text-base text-muted">Un detalle opcional para San Valentín, Navidad, Halloween y otras fechas: un patrón suave de fondo, un saludo y adornos. No cambia tus colores ni tus platos.</p>
        <ThemeForm orgSlug={org} name={membership.org.name} palette={identity.menu_palette} logo={logoUrl(identity.logo_path)} layout={identity.menu_layout} look={look} theme={identity.menu_theme} from={identity.menu_theme_from} until={identity.menu_theme_until} status={themeStatus({ theme: identity.menu_theme, from: identity.menu_theme_from, until: identity.menu_theme_until }, new Date())} canWrite={canWrite} />
      </section>
      <section aria-labelledby="datos" className="panel-cell mt-6">
        <h2 id="datos" className="font-display text-2xl">Datos del local</h2>
        <p className="mt-2 text-base text-muted">Un lema, tus horarios y tus redes para que la carta hable de tu local. Todo es opcional.</p>
        <VoiceForm {...common} voice={readVoice(identity)} />
      </section>
      <section aria-labelledby="logo" className="panel-cell mt-6">
        <h2 id="logo" className="font-display text-2xl">Logo del local</h2>
        <p className="mt-2 text-base text-muted">Se muestra completo, junto al nombre del local. PNG, JPEG o WebP, hasta 2 MB. Si tiene fondo transparente, se conserva.</p>
        <LogoForm orgSlug={org} name={membership.org.name} currentUrl={logoUrl(identity.logo_path)} canWrite={canWrite} />
      </section>
      <section aria-labelledby="portada" className="panel-cell mt-6">
        <h2 id="portada" className="font-display text-2xl">Portada</h2>
        <p className="mt-2 text-base text-muted">Una foto de ambiente arriba de tu carta. Es opcional: sin foto, la carta se ve como siempre.</p>
        <CoverForm {...common} currentUrl={coverUrl(identity.cover_path)} />
      </section>
    </main>
  );
}

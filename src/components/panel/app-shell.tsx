import Image from "next/image";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { cartaFontClass } from "@/components/menu/carta-fonts";
import type { Role } from "@/lib/entitlements";
import { paletteStyle, platformStyle } from "@/lib/identidad/palettes";
import { logoUrl } from "@/lib/identidad/logos";
import { LogoutForm } from "./logout-form";
import { Mark } from "./mark";
import { NavLinks, type NavItem } from "./nav-links";
import "./panel.css";

export const ROLE_LABEL: Record<Role, string> = { owner: "Dueño", staff: "Personal" };

const SECTIONS_LABEL = { panel: "Secciones del panel", sala: "Secciones de la sala", admin: "Secciones de SuperAdmin" } as const;

type Props = {
  area: "panel" | "sala" | "admin";
  /** Organización activa. Sin ella (selector), la cabecera muestra solo la marca. */
  org?: { slug: string; name: string; menu_palette?: string | null; logo_path?: string | null };
  role?: Role;
  hasSeveralOrgs?: boolean;
  /** Clases de las variables de fuente. Por defecto, las de la carta; `/admin` pasa las propias (`admin-fonts.ts`). */
  fontClass?: string;
  children: ReactNode;
};

const accountLinkClass =
  "inline-flex min-h-11 items-center rounded-full px-3 text-[0.9375rem] font-medium underline underline-offset-4 hover:bg-ink/5 lg:rounded-2xl lg:no-underline lg:hover:bg-white/10";

/**
 * Marco común de `/panel`, `/sala` y `/admin`: riel lateral en escritorio (cabecera con chips en celular) y lienzo de papel.
 * El panel del Dueño se tiñe con la paleta que eligió el local (la misma de su carta); SuperAdmin usa la de UcoNext.
 * La navegación se arma según el rol, pero ocultar un enlace no protege nada: cada página vuelve a comprobar el rol
 * en el servidor.
 */
export function AppShell({ area, org, role, hasSeveralOrgs, fontClass = cartaFontClass, children }: Props) {
  const items: NavItem[] = [];
  if (org) {
    if (area === "panel") {
      items.push({ href: `/panel/${org.slug}`, label: "Resumen", exact: true, icon: "resumen", group: "Tu local" });
      items.push({ href: `/panel/${org.slug}/carta`, label: "Carta", icon: "carta", group: "Tu local" });
      items.push({ href: `/panel/${org.slug}/mesas`, label: "Mesas", icon: "mesas", group: "Tu local" });
      items.push({ href: `/panel/${org.slug}/llamados`, label: "Llamados", icon: "llamados", group: "Tu local" });
      if (role === "owner") {
        items.push({ href: `/panel/${org.slug}/apariencia`, label: "Apariencia", icon: "apariencia", group: "Gestión" });
        items.push({ href: `/panel/${org.slug}/sucursales`, label: "Sucursales", icon: "sucursales", group: "Gestión" });
        items.push({ href: `/panel/${org.slug}/suscripcion`, label: "Suscripción", icon: "suscripcion", group: "Gestión" });
        items.push({ href: `/panel/${org.slug}/personal`, label: "Personal", icon: "personal", group: "Gestión" });
      }
      items.push({ href: `/sala/${org.slug}`, label: "Sala en vivo", icon: "sala", group: "Servicio" });
    } else {
      items.push({ href: `/sala/${org.slug}`, label: "Sala en vivo", exact: true, icon: "sala" });
      items.push({ href: `/panel/${org.slug}`, label: "Panel", icon: "panel" });
    }
  } else if (area === "admin") {
    items.push({ href: "/admin", label: "Organizaciones", exact: true, icon: "organizaciones" });
    items.push({ href: "/admin/nueva", label: "Nueva organización", icon: "nueva" });
  }

  const style: CSSProperties = org ? paletteStyle(org.menu_palette) : platformStyle();
  const logo = logoUrl(org?.logo_path);

  return (
    <div
      className={`${fontClass} panel ${area === "admin" ? "panel-platform" : ""} print:block lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]`}
      style={style}
    >
      <a
        href="#contenido"
        className="fixed top-2 left-2 z-50 -translate-y-20 rounded-full bg-brand px-4 py-2 text-sm font-medium text-white focus:translate-y-0"
      >
        Saltar al contenido
      </a>
      <header className="panel-rail flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-b border-ink/15 px-4 pt-4 pb-3 lg:sticky lg:top-0 lg:h-screen lg:flex-col lg:flex-nowrap lg:items-stretch lg:justify-start lg:gap-0 lg:overflow-y-auto lg:border-0 lg:bg-brand-deep lg:p-5 lg:text-white print:hidden">
        <div className="min-w-0 flex-1 lg:flex-none">
          {org ? (
            <div className="flex min-w-0 items-center gap-3 lg:flex-col lg:items-start lg:gap-4">
              {logo ? (
                <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white p-1.5 lg:size-16">
                  <Image src={logo} alt="" width={96} height={96} unoptimized className="size-full object-contain" />
                </span>
              ) : null}
              <Link href={`/${area}/${org.slug}`} className="min-w-0 font-display text-[1.625rem] leading-none text-ink [overflow-wrap:anywhere] lg:text-[2rem] lg:text-white">
                {org.name}
              </Link>
            </div>
          ) : (
            <Link href={`/${area}`} className="flex items-center gap-2.5 font-display text-[1.625rem] leading-none text-brand lg:text-[2rem] lg:text-white">
              <Mark className="h-4 w-7 shrink-0 text-brand lg:text-white" />
              UcoMenu
            </Link>
          )}
          {role ? (
            <p className="mt-2 text-sm text-muted lg:text-white/80">
              <span className="inline-flex items-center rounded-full bg-blush px-2.5 py-0.5 font-medium text-ink lg:bg-white/15 lg:text-white">
                {ROLE_LABEL[role]}
              </span>
              {hasSeveralOrgs ? (
                <>
                  {" "}
                  <Link href={`/${area}`} className="inline-flex min-h-11 items-center px-1 underline underline-offset-4 lg:min-h-9">
                    Cambiar de local
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
          {area === "admin" ? (
            <p className="mt-2 text-sm">
              <span className="inline-flex items-center rounded-full bg-blush px-2.5 py-0.5 font-medium text-ink lg:bg-white/15 lg:text-white">
                SuperAdmin
              </span>
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-1 lg:order-3 lg:mt-auto lg:flex-col lg:items-stretch lg:border-t lg:border-white/15 lg:pt-3">
          <Link href="/cuenta" className={accountLinkClass}>
            Mi cuenta
          </Link>
          <LogoutForm buttonClassName={`${accountLinkClass} lg:w-full`} />
        </div>
        {items.length > 0 ? (
          <div className="mt-3 w-full lg:order-2 lg:mt-6 lg:w-auto">
            <NavLinks items={items} label={SECTIONS_LABEL[area]} />
          </div>
        ) : null}
      </header>
      <div id="contenido" tabIndex={-1} className="min-w-0 outline-none">
        {children}
      </div>
    </div>
  );
}

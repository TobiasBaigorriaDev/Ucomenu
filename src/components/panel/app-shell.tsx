import Link from "next/link";
import type { ReactNode } from "react";
import { logoutAction } from "@/lib/auth/actions";
import type { Role } from "@/lib/entitlements";
import { NavLinks, type NavItem } from "./nav-links";

export const ROLE_LABEL: Record<Role, string> = { owner: "Dueño", staff: "Personal" };

type Props = {
  area: "panel" | "sala";
  /** Organización activa. Sin ella (selector), la cabecera muestra solo la marca. */
  org?: { slug: string; name: string };
  role?: Role;
  hasSeveralOrgs?: boolean;
  children: ReactNode;
};

/**
 * Marco común de `/panel` y `/sala`: franja de azulejos, nombre del local, navegación y salida.
 * La navegación se arma según el rol, pero ocultar un enlace no protege nada: cada página
 * vuelve a comprobar el rol en el servidor.
 */
export function AppShell({ area, org, role, hasSeveralOrgs, children }: Props) {
  const items: NavItem[] = [];
  if (org) {
    if (area === "panel") {
      items.push({ href: `/panel/${org.slug}`, label: "Resumen", exact: true });
      items.push({ href: `/panel/${org.slug}/carta`, label: "Carta" });
      if (role === "owner") {
        items.push({ href: `/panel/${org.slug}/suscripcion`, label: "Suscripción" });
        items.push({ href: `/panel/${org.slug}/personal`, label: "Personal" });
      }
      items.push({ href: `/sala/${org.slug}`, label: "Sala en vivo" });
    } else {
      items.push({ href: `/sala/${org.slug}`, label: "Sala en vivo", exact: true });
      items.push({ href: `/panel/${org.slug}`, label: "Panel" });
    }
  }

  return (
    <div className="min-h-screen">
      <div aria-hidden className="tile-band h-2" />
      <header className="mx-auto max-w-3xl px-4 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            {org ? (
              <Link href={`/${area}/${org.slug}`} className="font-display text-[1.75rem] leading-tight break-words text-ink">
                {org.name}
              </Link>
            ) : (
              <Link href={`/${area}`} className="font-display text-[1.75rem] leading-tight text-cobalt">
                UcoMenu
              </Link>
            )}
            {role ? (
              <p className="mt-0.5 text-sm text-muted">
                {ROLE_LABEL[role]}
                {hasSeveralOrgs ? (
                  <>
                    {" – "}
                    <Link href={`/${area}`} className="underline underline-offset-2">
                      Cambiar de local
                    </Link>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-1 text-base">
            <Link href="/cuenta" className="inline-flex min-h-11 items-center px-2 text-ink underline underline-offset-2">
              Mi cuenta
            </Link>
            <form action={logoutAction}>
              <button type="submit" className="inline-flex min-h-11 items-center px-2 text-ink underline underline-offset-2">
                Salir
              </button>
            </form>
          </div>
        </div>
        {items.length > 0 ? (
          <div className="mt-3">
            <NavLinks items={items} label={area === "panel" ? "Secciones del panel" : "Secciones de la sala"} />
          </div>
        ) : null}
      </header>
      {children}
    </div>
  );
}

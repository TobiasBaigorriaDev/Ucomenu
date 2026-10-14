import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getEntitlements, getMemberships, requireMembership, requireUser } from "@/lib/auth/session";
import { moraNotice } from "@/lib/entitlements";
import { AppShell, ROLE_LABEL } from "./app-shell";
import { MoraBanner } from "./mora-banner";

/**
 * Layout de un local dentro de `/panel/{slug}` o `/sala/{slug}`: valida la membresía y arma la cabecera
 * y el aviso de mora. Un layout no se re-ejecuta al navegar entre páginas hijas: cada página debe
 * volver a exigir su propio nivel de acceso.
 */
export async function OrgArea({ area, slug, children }: { area: "panel" | "sala"; slug: string; children: ReactNode }) {
  const { membership, memberships } = await requireMembership(slug, `/${area}/${slug}`);
  const notice = moraNotice(await getEntitlements(membership.org.id), membership.role);

  return (
    <AppShell area={area} org={membership.org} role={membership.role} hasSeveralOrgs={memberships.length > 1}>
      {notice ? <MoraBanner notice={notice} /> : null}
      {children}
    </AppShell>
  );
}

/**
 * Entrada de `/panel` y `/sala`: sin locales muestra un aviso, con uno entra directo y con varios
 * muestra el selector. La organización activa vive en la URL, no en una cookie.
 */
export async function OrgEntry({ area }: { area: "panel" | "sala" }) {
  const user = await requireUser(`/${area}`);
  const memberships = await getMemberships(user.id);

  if (memberships.length === 1) redirect(`/${area}/${memberships[0].org.slug}`);

  return (
    <AppShell area={area}>
      <main className="mx-auto max-w-3xl px-4 py-10">
        {memberships.length === 0 ? (
          <>
            <h1 className="font-display text-4xl leading-tight">Tu cuenta no tiene ningún local</h1>
            <p className="mt-4 max-w-prose text-lg leading-relaxed text-muted">
              Ingresaste como {user.email}, pero esta cuenta todavía no está asociada a un local. Pedile al dueño que te dé de
              alta, o contactá a UcoMenu.
            </p>
          </>
        ) : (
          <>
            <h1 className="font-display text-4xl leading-tight">¿A qué local entrás?</h1>
            <ul className="mt-6 border-t border-ink/15">
              {memberships.map(({ org, role }) => (
                <li key={org.id} className="border-b border-ink/15">
                  <Link href={`/${area}/${org.slug}`} className="flex min-h-14 items-baseline gap-3 py-3 text-lg">
                    <span className="font-medium break-words">{org.name}</span>
                    <span aria-hidden className="leader" />
                    <span className="text-base text-muted">{ROLE_LABEL[role]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </AppShell>
  );
}

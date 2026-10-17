import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getEntitlements, getMemberships, requireMembership, requireUser } from "@/lib/auth/session";
import { moraNotice } from "@/lib/entitlements";
import { toneFor } from "@/components/menu/tones";
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
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-8 lg:px-10 lg:py-12">
        {memberships.length === 0 ? (
          <>
            <h1 className="font-display">Tu cuenta no tiene ningún local</h1>
            <p className="mt-4 max-w-prose text-lg leading-relaxed text-muted">
              Ingresaste como {user.email}, pero esta cuenta todavía no está asociada a un local. Pedile al dueño que te dé de
              alta, o contactá a UcoMenu.
            </p>
          </>
        ) : (
          <>
            <h1 className="font-display">¿A qué local entrás?</h1>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {memberships.map(({ org, role }, index) => (
                <li key={org.id}>
                  <Link href={`/${area}/${org.slug}`} className={`flex min-h-24 flex-col justify-between gap-6 rounded-3xl p-4 ${toneFor(index)}`}>
                    <span className="font-display text-2xl leading-tight break-words">{org.name}</span>
                    <span className="text-base">{ROLE_LABEL[role]}</span>
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

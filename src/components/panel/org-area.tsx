import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getEntitlements, getMemberships, requireKitchen, requireMembership, requireUser } from "@/lib/auth/session";
import { moraNotice } from "@/lib/entitlements";
import { createSessionClient } from "@/lib/supabase/server";
import { WhatsappLink } from "@/components/marketing/whatsapp-link";
import { toneFor } from "@/components/menu/tones";
import { AppShell, ROLE_LABEL } from "./app-shell";
import { LlamadosBanner } from "./llamados-banner";
import { MoraBanner } from "./mora-banner";
import { TonosDeAviso } from "./tonos-de-aviso";

/** El panel y la sala son de Dueño y Personal: el cocinero solo tiene `/cocina`. */
const visibleIn = <T extends { role: string }>(area: "panel" | "sala" | "cocina", memberships: T[]): T[] =>
  area === "cocina" ? memberships : memberships.filter((m) => m.role !== "cook");

/**
 * Layout de un local dentro de `/panel/{slug}`, `/sala/{slug}` o `/cocina/{slug}`: valida la membresía y arma la cabecera
 * y el aviso de mora. Un layout no se re-ejecuta al navegar entre páginas hijas: cada página debe
 * volver a exigir su propio nivel de acceso.
 */
export async function OrgArea({ area, slug, children }: { area: "panel" | "sala" | "cocina"; slug: string; children: ReactNode }) {
  const { membership, memberships } = await (area === "cocina" ? requireKitchen : requireMembership)(slug, `/${area}/${slug}`);
  const ent = await getEntitlements(membership.org.id);
  const notice = moraNotice(ent, membership.role);
  // En el panel, quien edita la carta se entera arriba de que una mesa llamó (la sala en vivo tiene su propia lista).
  const showCalls = area === "panel" && ent?.features.includes("waiter_call") === true;

  return (
    <AppShell area={area} org={membership.org} role={membership.role} hasSeveralOrgs={visibleIn(area, memberships).length > 1}>
      <TonosDeAviso call={membership.org.call_tone} ready={membership.org.ready_tone} vibration={membership.org.vibration} />
      {showCalls ? <LlamadosBanner slug={membership.org.slug} /> : null}
      {notice ? <MoraBanner notice={notice} /> : null}
      {children}
    </AppShell>
  );
}

/** ¿Tiene membresías, aunque su local no se vea (dado de baja)? `unknown` si la base no respondió: no se afirma nada. */
async function membershipPresence(userId: string): Promise<"none" | "some" | "unknown"> {
  const session = await createSessionClient();
  const { data, error } = await session.from("memberships").select("id").eq("user_id", userId).limit(1);
  if (error) return "unknown";
  return data.length === 0 ? "none" : "some";
}

/**
 * Entrada de `/panel`, `/sala` y `/cocina`: sin locales lleva a crear uno (o muestra un aviso), con uno entra directo y con varios
 * muestra el selector. La organización activa vive en la URL, no en una cookie. Quien solo es cocinero y entra al panel
 * o a la sala va a su pantalla.
 */
export async function OrgEntry({ area }: { area: "panel" | "sala" | "cocina" }) {
  const user = await requireUser(`/${area}`);
  const all = await getMemberships(user.id);
  const memberships = visibleIn(area, all);
  if (memberships.length === 0 && all.length > 0) redirect(all.length === 1 ? `/cocina/${all[0].org.slug}` : "/cocina");
  const presence = all.length === 0 ? await membershipPresence(user.id) : "some";
  // Sin ninguna membresía, también por fuera de lo visible (un local dado de baja no aparece): es alguien que recién se registró.
  if (area === "panel" && presence === "none") redirect("/crear-local");

  if (memberships.length === 1) redirect(`/${area}/${memberships[0].org.slug}`);

  return (
    <AppShell area={area}>
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-8 lg:px-10 lg:py-12">
        {memberships.length === 0 && presence === "some" ? (
          <>
            <h1 className="font-display">Tu local fue dado de baja</h1>
            <p className="mt-4 max-w-prose text-lg leading-relaxed text-muted">
              Ingresaste como {user.email}. El local de esta cuenta está dado de baja y por eso no aparece acá. Para reactivarlo,{" "}
              <WhatsappLink className="text-cobalt underline underline-offset-2" mensaje="Hola, quiero reactivar mi local en UcoMenú.">
                escribinos por WhatsApp
              </WhatsappLink>
              .
            </p>
          </>
        ) : memberships.length === 0 ? (
          <>
            <h1 className="font-display">Tu cuenta no tiene ningún local</h1>
            <p className="mt-4 max-w-prose text-lg leading-relaxed text-muted">
              Ingresaste como {user.email}, pero esta cuenta todavía no está asociada a un local. Si trabajás en uno, pedile al dueño que te dé de alta.
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

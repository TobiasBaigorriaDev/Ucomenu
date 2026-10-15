import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { parseEntitlements, type Entitlements, type Role } from "@/lib/entitlements";
import { isPlatformAdmin } from "@/lib/admin/organizations";
import { createSessionClient } from "@/lib/supabase/server";

/**
 * Identidad y autorización de las áreas con sesión. Regla de oro (ADR 0005 y ficha acceso-del-personal):
 *  - la identidad sale de `getUser()` (valida contra Auth), nunca de `getSession()` ni de la cookie;
 *  - el rol y la pertenencia salen de `memberships`, en cada pedido, nunca del JWT.
 *
 * IMPORTANTE: en el App Router un layout NO se vuelve a ejecutar al navegar entre páginas hijas.
 * Por eso cada `page.tsx` y cada server action llama a `requireMembership`/`requireOwner`;
 * el layout solo las usa para armar la cabecera.
 */

export type OrgMembership = {
  role: Role;
  org: { id: string; slug: string; name: string };
};

export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.getUser();
  return error || !data.user ? null : data.user;
});

/** Membresías de la persona, ordenadas por nombre de organización. */
export const getMemberships = cache(async (userId: string): Promise<OrgMembership[]> => {
  const supabase = await createSessionClient();
  const own = await supabase.from("memberships").select("role, organization_id").eq("user_id", userId);
  if (own.error) throw new Error(`No se pudieron leer las membresías: ${own.error.message}`);
  if (own.data.length === 0) return [];

  const orgs = await supabase
    .from("organizations")
    .select("id, slug, name")
    .in(
      "id",
      own.data.map((m) => m.organization_id),
    );
  if (orgs.error) throw new Error(`No se pudieron leer las organizaciones: ${orgs.error.message}`);

  const byId = new Map(orgs.data.map((o) => [o.id, o]));
  return own.data
    .flatMap((m): OrgMembership[] => {
      const org = byId.get(m.organization_id);
      return org && (m.role === "owner" || m.role === "staff") ? [{ role: m.role, org }] : [];
    })
    .sort((a, b) => a.org.name.localeCompare(b.org.name, "es"));
});

export function loginUrl(next: string): string {
  return `/login?next=${encodeURIComponent(next)}`;
}

/** Exige sesión válida. Sin ella, redirige al login y vuelve a `next` después. */
export async function requireUser(next: string): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect(loginUrl(next));
  return user;
}

/**
 * Exige sesión y membresía vigente en la organización `slug`. Quien no es miembro (o el slug no existe)
 * recibe el mismo 404: no se revela qué organizaciones existen.
 */
export async function requireMembership(slug: string, next: string) {
  const user = await requireUser(next);
  const memberships = await getMemberships(user.id);
  const membership = memberships.find((m) => m.org.slug === slug);
  if (!membership) notFound();
  return { user, membership, memberships };
}

/** Como `requireMembership`, pero solo para el Dueño. El Staff vuelve al inicio de su panel, sin ver nada. */
export async function requireOwner(slug: string, next: string) {
  const result = await requireMembership(slug, next);
  if (result.membership.role !== "owner") redirect(`/panel/${slug}`);
  return result;
}

/**
 * Exige sesión y que la persona sea SuperAdmin (`platform_admins`, comprobado con su propia sesión y RLS en cada
 * pedido, nunca con el JWT). Cualquier otra persona recibe el mismo 404 que una ruta inexistente: no se revela `/admin`.
 */
export async function requirePlatformAdmin(next: string): Promise<User> {
  const user = await requireUser(next);
  const session = await createSessionClient();
  if (!(await isPlatformAdmin({ session, actorId: user.id }))) notFound();
  return user;
}

/** Estado de la cuenta (`org_entitlements`). `null` si la base no lo devuelve (falla cerrado en la UI). */
export const getEntitlements = cache(async (orgId: string): Promise<Entitlements | null> => {
  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc("org_entitlements", { p_org: orgId });
  if (error) return null;
  return parseEntitlements(data);
});

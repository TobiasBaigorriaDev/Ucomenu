import type { Metadata } from "next";
import { getEntitlements, requireOwner } from "@/lib/auth/session";
import { listMembers } from "@/lib/personnel";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSessionClient } from "@/lib/supabase/server";
import { CreateMemberForm } from "./create-member-form";
import { MemberRow } from "./member-row";

export const metadata: Metadata = { title: "Personal" };

/** Solo Dueño. La comprobación es del servidor: el Staff que abra esta URL vuelve al inicio sin ver nada. */
export default async function PersonnelPage({ params }: PageProps<"/panel/[org]/personal">) {
  const { org } = await params;
  const { user, membership } = await requireOwner(org, `/panel/${org}/personal`);
  const ent = await getEntitlements(membership.org.id);

  // Sucursales activas para asignarlas a Staff y cocina (ficha personal-por-sucursal). Si no se pueden leer, no se ofrece asignar.
  const branchRows = await (await createSessionClient())
    .from("branches")
    .select("id, name")
    .eq("organization_id", membership.org.id)
    .eq("is_active", true)
    .order("name")
    .order("id");
  const branches = branchRows.error ? [] : branchRows.data;

  let members = null;
  try {
    const result = await listMembers(
      { session: await createSessionClient(), admin: createAdminClient(), actorId: user.id },
      membership.org.id,
    );
    members = result.ok ? result.data : null;
  } catch {
    members = null; // sin SUPABASE_SERVICE_ROLE_KEY u otra falla: se informa abajo, sin romper la página
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:px-10 lg:py-12">
      <h1 className="font-display text-4xl leading-tight">Personal</h1>

      <section aria-labelledby="equipo" className="panel-cell mt-8">
        <h2 id="equipo" className="font-display text-2xl">
          Tu equipo
        </h2>
        {members ? (
          <ul className="mt-3 panel-list">
            {members.map((member) => (
              <MemberRow key={member.membershipId} member={member} orgSlug={membership.org.slug} branches={branches} />
            ))}
          </ul>
        ) : (
          <p role="alert" className="mt-3 max-w-prose text-danger">
            No pudimos cargar el equipo. Probá de nuevo en unos minutos.
          </p>
        )}
      </section>

      <section aria-labelledby="alta" className="panel-cell mt-6">
        <h2 id="alta" className="font-display text-2xl">
          Sumar a alguien
        </h2>
        <p className="mt-2 max-w-prose leading-relaxed text-muted">
          Creás la cuenta con una contraseña inicial y la persona ya puede ingresar con su email.
        </p>
        <CreateMemberForm orgSlug={membership.org.slug} canWrite={ent?.canWrite ?? false} />
      </section>
    </main>
  );
}

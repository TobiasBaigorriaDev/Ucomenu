import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import "@/components/panel/panel.css";
import { isPlatformAdmin } from "@/lib/admin/organizations";
import { requireUser } from "@/lib/auth/session";
import { authMethods, mustChoosePassword } from "@/lib/registro/registro";
import { createSessionClient } from "@/lib/supabase/server";
import { CreateLocalForm } from "./create-local-form";

export const metadata: Metadata = { title: "Creá tu local", robots: { index: false, follow: false } };

/** Último paso del registro (ADR 0053). Quien ya es Dueño vuelve al panel: esta vía da una sola prueba. */
export default async function CrearLocalPage() {
  const user = await requireUser("/crear-local");
  const session = await createSessionClient();
  if (await isPlatformAdmin({ session, actorId: user.id })) redirect("/admin");

  const owned = await session.from("memberships").select("id").eq("user_id", user.id).eq("role", "owner").limit(1);
  if (owned.data && owned.data.length > 0) redirect("/panel");

  const { data } = await session.auth.getClaims();

  return (
    <AuthShell title="Tu carta lista hoy." lead="14 días gratis con el plan Pro. Sin tarjeta de crédito." heading="Creá tu local">
      <p className="mt-3 text-base break-words text-muted">Cuenta: {user.email}</p>
      <div className="mt-6">
        <CreateLocalForm choosePassword={mustChoosePassword(authMethods(data?.claims?.amr))} />
      </div>
    </AuthShell>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import "@/components/panel/panel.css";
import { requireUser } from "@/lib/auth/session";
import { authMethods, cameFromEmailLink } from "@/lib/registro/registro";
import { createSessionClient } from "@/lib/supabase/server";
import { NewPasswordForm } from "./new-password-form";

export const metadata: Metadata = { title: "Contraseña nueva", robots: { index: false, follow: false } };

/** Elegir una contraseña desde un enlace por correo. Con otra sesión, se cambia en Mi cuenta escribiendo la actual. */
export default async function NuevaContrasenaPage() {
  const user = await requireUser("/cuenta/nueva-contrasena");
  const { data } = await (await createSessionClient()).auth.getClaims();
  if (!cameFromEmailLink(authMethods(data?.claims?.amr))) redirect("/cuenta");

  return (
    <AuthShell title="Tu carta, tus mesas y tu sala." lead={`Cuenta: ${user.email ?? ""}`} heading="Elegí una contraseña nueva">
      <div className="mt-6">
        <NewPasswordForm />
      </div>
    </AuthShell>
  );
}

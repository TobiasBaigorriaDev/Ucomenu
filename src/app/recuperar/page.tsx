import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { EmailLinkForm } from "@/components/auth/email-link-form";
import "@/components/panel/panel.css";
import { getCurrentUser } from "@/lib/auth/session";
import { turnstileState } from "@/lib/auth/turnstile";
import { requestRecoveryAction } from "@/lib/registro/actions";

export const metadata: Metadata = { title: "Recuperar mi contraseña", robots: { index: false, follow: false } };

export default async function RecuperarPage() {
  // Lee la sesión para que la página sea dinámica: la clave de Turnstile es de cada entorno, no del build.
  await getCurrentUser();
  const turnstile = turnstileState();

  return (
    <AuthShell title="Tu carta, tus mesas y tu sala." lead="Ingreso del dueño y del personal del local." heading="Recuperá tu contraseña">
      <p className="mt-3 max-w-prose text-base text-muted">Te mandamos un enlace a tu correo para elegir una nueva.</p>
      <div className="mt-6">
        <EmailLinkForm action={requestRecoveryAction} siteKey={turnstile.status === "on" ? turnstile.siteKey : null} submitLabel="Enviarme el enlace" />
      </div>
      <p className="mt-8 text-sm text-muted">
        <Link href="/login" className="text-cobalt underline underline-offset-2">
          Volver a ingresar
        </Link>
      </p>
    </AuthShell>
  );
}

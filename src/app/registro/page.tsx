import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { EmailLinkForm } from "@/components/auth/email-link-form";
import { GoogleButton } from "@/components/auth/google-button";
import "@/components/panel/panel.css";
import { getCurrentUser, postLoginPath } from "@/lib/auth/session";
import { turnstileState } from "@/lib/auth/turnstile";
import { requestSignupAction } from "@/lib/registro/actions";

export const metadata: Metadata = {
  title: "Probá UcoMenú gratis",
  description: "Creá la carta digital de tu local y probá el plan Pro 14 días, sin tarjeta de crédito.",
};

/** Registro autoservicio (ADR 0053). Solo pide el email: la contraseña se elige después de confirmarlo. */
export default async function RegistroPage() {
  const user = await getCurrentUser();
  if (user) redirect(await postLoginPath(user.id, null));
  const turnstile = turnstileState();

  return (
    <AuthShell title="Tu carta lista hoy." lead="14 días gratis con el plan Pro. Sin tarjeta de crédito." heading="Creá tu cuenta">
      <p className="mt-3 max-w-prose text-base text-muted">Te mandamos un enlace a tu correo para confirmar que es tuyo.</p>
      <div className="mt-6">
        <EmailLinkForm action={requestSignupAction} siteKey={turnstile.status === "on" ? turnstile.siteKey : null} submitLabel="Enviarme el enlace" />
      </div>
      <GoogleButton />
      <p className="mt-8 text-sm text-muted">
        ¿Ya tenés cuenta?{" "}
        <Link href="/login" className="text-cobalt underline underline-offset-2">
          Ingresá
        </Link>
      </p>
    </AuthShell>
  );
}

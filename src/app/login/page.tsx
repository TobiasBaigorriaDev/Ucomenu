import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { GoogleButton } from "@/components/auth/google-button";
import "@/components/panel/panel.css";
import { getCurrentUser, postLoginPath } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/validation";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Ingresar", robots: { index: false, follow: false } };

/** Ingreso de dueños y personal. */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const raw = params.next;
  const next = safeNext(Array.isArray(raw) ? raw[0] : raw);

  // Quien ya tiene sesión no necesita el formulario.
  const user = await getCurrentUser();
  if (user) redirect(await postLoginPath(user.id, next));

  return (
    <AuthShell title="Tu carta, tus mesas y tu sala." lead="Ingreso del dueño y del personal del local." heading="Ingresá a tu cuenta">
      {params.aviso === "google" ? (
        <p role="alert" className="mt-4 max-w-prose text-base font-medium text-danger">
          No pudimos completar el ingreso con Google. Probá de nuevo.
        </p>
      ) : null}
      <div className="mt-6">
        <LoginForm next={next} />
      </div>
      <GoogleButton />
      <p className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
        <Link href="/recuperar" className="inline-flex min-h-11 items-center text-cobalt underline underline-offset-2">
          Olvidé mi contraseña
        </Link>
        <Link href="/registro" className="inline-flex min-h-11 items-center text-cobalt underline underline-offset-2">
          Crear una cuenta
        </Link>
      </p>
    </AuthShell>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/panel/app-shell";
import { getMemberships, requireUser } from "@/lib/auth/session";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Mi cuenta", robots: { index: false, follow: false } };

export default async function AccountPage() {
  const user = await requireUser("/cuenta");
  const memberships = await getMemberships(user.id);
  const home = memberships.length === 1 ? `/panel/${memberships[0].org.slug}` : "/panel";

  return (
    <AppShell area="panel">
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:px-10 lg:py-12">
        <h1 className="font-display text-4xl leading-tight">Mi cuenta</h1>
        <p className="mt-3 text-lg">
          Ingresaste como <span className="font-medium break-all">{user.email}</span>.
        </p>

        <section aria-labelledby="clave" className="mt-8">
          <h2 id="clave" className="font-display text-2xl">
            Cambiar mi contraseña
          </h2>
          <ChangePasswordForm />
        </section>

        <p className="mt-10">
          <Link href={home} className="text-cobalt underline underline-offset-2">
            Volver al panel
          </Link>
        </p>
      </main>
    </AppShell>
  );
}

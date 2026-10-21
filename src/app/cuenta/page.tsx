import type { Metadata } from "next";
import Link from "next/link";
import { adminFontClass } from "@/components/panel/admin-fonts";
import { AppShell } from "@/components/panel/app-shell";
import { isPlatformAdmin } from "@/lib/admin/organizations";
import { getMemberships, requireUser } from "@/lib/auth/session";
import { createSessionClient } from "@/lib/supabase/server";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Mi cuenta", robots: { index: false, follow: false } };

/**
 * Mi cuenta. El marco y el enlace de retorno dependen de quién es la persona: un SuperAdmin vuelve a `/admin` y ve el marco de
 * `/admin` (comprobado con su propia sesión y RLS, como `requirePlatformAdmin`); el resto, al panel de su local (directo con
 * uno, al selector con varios). Un SuperAdmin que además trabaja en un local conserva un segundo enlace a su panel. Nada
 * redirige fuera de `/cuenta`: todos pueden cambiar su contraseña acá.
 */
export default async function AccountPage() {
  const user = await requireUser("/cuenta");
  const [memberships, platformAdmin] = await Promise.all([
    getMemberships(user.id),
    createSessionClient().then((session) => isPlatformAdmin({ session, actorId: user.id })),
  ]);
  const home = memberships.length === 1 ? `/panel/${memberships[0].org.slug}` : "/panel";

  return (
    <AppShell area={platformAdmin ? "admin" : "panel"} fontClass={platformAdmin ? adminFontClass : undefined}>
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

        <p className="mt-10 flex flex-wrap gap-x-6 gap-y-2">
          {platformAdmin ? (
            <>
              <Link href="/admin" className="inline-flex min-h-11 items-center text-cobalt underline underline-offset-2">
                Volver a la administración
              </Link>
              {memberships.length > 0 ? (
                <Link href={home} className="inline-flex min-h-11 items-center text-cobalt underline underline-offset-2">
                  {memberships.length === 1 ? "Ir al panel de mi local" : "Ir a mis locales"}
                </Link>
              ) : null}
            </>
          ) : (
            <Link href={home} className="inline-flex min-h-11 items-center text-cobalt underline underline-offset-2">
              Volver al panel
            </Link>
          )}
        </p>
      </main>
    </AppShell>
  );
}

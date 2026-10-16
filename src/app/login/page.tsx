import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser, postLoginPath } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/validation";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Ingresar", robots: { index: false, follow: false } };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const raw = params.next;
  const next = safeNext(Array.isArray(raw) ? raw[0] : raw);

  // Quien ya tiene sesión no necesita el formulario.
  const user = await getCurrentUser();
  if (user) redirect(await postLoginPath(user.id, next));

  return (
    <>
      <header className="tile-band text-white">
        <div className="mx-auto max-w-md px-4 pt-14 pb-8">
          <p className="font-display text-[2.5rem] leading-none">UcoMenu</p>
          <p className="mt-3 text-base text-white/85">Ingreso del dueño y del personal del local</p>
        </div>
      </header>
      <main className="mx-auto max-w-md px-4 py-8">
        <h1 className="font-display text-3xl leading-tight">Ingresá a tu cuenta</h1>
        <div className="mt-6">
          <LoginForm next={next} />
        </div>
        <p className="mt-8 max-w-prose text-sm leading-relaxed text-muted">
          ¿Olvidaste tu contraseña? Pedile al dueño del local que te la cambie. Si sos el dueño, contactá a UcoMenu.
        </p>
      </main>
    </>
  );
}

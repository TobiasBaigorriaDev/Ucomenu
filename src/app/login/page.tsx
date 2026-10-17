import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cartaFontClass } from "@/components/menu/carta-fonts";
import { LegalLinks } from "@/components/legal/legal-links";
import { Mark } from "@/components/panel/mark";
import "@/components/panel/panel.css";
import { getCurrentUser, postLoginPath } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/validation";
import { platformStyle } from "@/lib/identidad/palettes";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Ingresar", robots: { index: false, follow: false } };

/**
 * Ingreso de dueños y personal. Todavía no se sabe de qué local es la persona, así que usa el lenguaje del panel con la
 * paleta de UcoNext (la misma de SuperAdmin) y la tipografía de la carta: una celda de marca y una celda con el formulario.
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const raw = params.next;
  const next = safeNext(Array.isArray(raw) ? raw[0] : raw);

  // Quien ya tiene sesión no necesita el formulario.
  const user = await getCurrentUser();
  if (user) redirect(await postLoginPath(user.id, next));

  return (
    <div className={`${cartaFontClass} panel`} style={platformStyle()}>
      <div className="mx-auto grid min-h-screen max-w-5xl content-center gap-4 px-4 py-6 sm:px-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-5 lg:px-10 lg:py-12">
        <header className="relative flex min-h-48 flex-col justify-between gap-10 overflow-hidden rounded-3xl bg-brand-deep p-6 text-white lg:min-h-[32rem] lg:p-8">
          <Mark className="absolute -top-6 -right-8 h-28 w-auto text-white/10 lg:-top-10 lg:-right-12 lg:h-56" />
          <p className="relative flex items-center gap-2.5 font-display text-[1.625rem] leading-none">
            <Mark className="h-4 w-7 shrink-0 text-white" />
            UcoMenu
          </p>
          <div className="relative">
            <p className="font-display text-[clamp(2.25rem,1.5rem+4vw,3.5rem)] leading-[0.98] tracking-[-0.015em] text-balance">
              Tu carta, tus mesas y tu sala.
            </p>
            <p className="mt-3 max-w-[32ch] text-base leading-relaxed text-white/85">Ingreso del dueño y del personal del local.</p>
          </div>
        </header>
        <main id="contenido" className="panel-cell flex flex-col justify-center lg:p-8">
          <h1 className="font-display">Ingresá a tu cuenta</h1>
          <div className="mt-6">
            <LoginForm next={next} />
          </div>
          <p className="mt-8 max-w-prose text-sm leading-relaxed text-muted">
            ¿Olvidaste tu contraseña? Pedile al dueño del local que te la cambie. Si sos el dueño, contactá a UcoMenu.
          </p>
          <LegalLinks className="mt-4 text-muted" />
        </main>
      </div>
    </div>
  );
}

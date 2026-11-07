import { NextResponse, type NextRequest } from "next/server";
import { postLoginPath } from "@/lib/auth/session";
import { siteBaseUrl } from "@/lib/cobro/mercadopago";
import { claimProvisionedMailbox } from "@/lib/registro/buzon-sesion";
import { createSessionClient } from "@/lib/supabase/server";

/** Vuelta del ingreso con Google (ADR 0053): cambia el código por la sesión, con el verificador PKCE de la cookie. */
export async function GET(request: NextRequest) {
  const base = siteBaseUrl() ?? request.nextUrl.origin;
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/login?aviso=google", base));

  const session = await createSessionClient();
  const { data, error } = await session.auth.exchangeCodeForSession(code);
  if (error || !data.user) return NextResponse.redirect(new URL("/login?aviso=google", base));

  // Si Auth unió Google a una cuenta que creó un Dueño, la contraseña del Dueño se reemplaza (ficha cuentas-creadas-por-duenos).
  if ((await claimProvisionedMailbox(session, data.user)) === "failed") return NextResponse.redirect(new URL("/login?aviso=google", base));

  return NextResponse.redirect(new URL(await postLoginPath(data.user.id, null, session), base));
}

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { sessionCookieOptions } from "@/lib/supabase/cookie-options";

/**
 * Renueva la sesión de Supabase en cada pedido de las áreas con login, para que las páginas
 * (que no pueden escribir cookies) reciban siempre un token vigente.
 *
 * NO autoriza nada: quién puede ver qué lo decide cada página en el servidor, con `getUser()` y
 * la membresía (ver `src/lib/auth/session.ts`). Un proxy no alcanza como única defensa.
 */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, sessionCookieOptions(options));
        }
        // Una respuesta que escribe cookies de sesión nunca debe cachearse en un CDN.
        for (const [header, valor] of Object.entries(headers)) response.headers.set(header, valor);
      },
    },
  });

  await supabase.auth.getClaims();
  return response;
}

export const config = {
  matcher: ["/login", "/cuenta", "/panel/:path*", "/sala/:path*"],
};

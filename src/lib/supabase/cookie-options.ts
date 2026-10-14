/**
 * Opciones de las cookies de sesión. No hay cliente de Supabase en el navegador (el login y
 * los cambios son server actions), así que ningún script necesita leerlas: `httpOnly`.
 */
export function sessionCookieOptions<T extends object>(options: T) {
  return {
    ...options,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

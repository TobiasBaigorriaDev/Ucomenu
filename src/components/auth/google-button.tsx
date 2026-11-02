import { secondaryButtonClass } from "@/components/panel/styles";
import { googleLoginAction } from "@/lib/registro/actions";

/** Se muestra solo donde el proveedor está configurado: `GOOGLE_LOGIN_ENABLED=1`, junto con el cliente OAuth en Auth. */
export function GoogleButton() {
  if (process.env.GOOGLE_LOGIN_ENABLED !== "1") return null;
  return (
    <form action={googleLoginAction} className="mt-6 border-t border-ink/15 pt-6">
      <button type="submit" className={secondaryButtonClass}>
        Continuar con Google
      </button>
    </form>
  );
}

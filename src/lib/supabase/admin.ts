import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Cliente con la clave de servicio (`service_role`): se salta RLS y puede administrar Auth.
 *
 * Reglas (ficha acceso-del-personal):
 *  - Solo el servidor. La variable NO lleva el prefijo NEXT_PUBLIC_ y este módulo es `server-only`.
 *  - Solo lo usa `src/lib/personnel.ts`, que antes comprueba con el cliente de la persona (RLS)
 *    que quien pide es `owner` de la organización. Nunca se usa para leer datos "en nombre" de nadie
 *    sin esa comprobación.
 *  - Excepción acotada (ADR 0020): `src/lib/push/notify-call.ts` lo usa, sin sesión de nadie, solo para llamar a
 *    `push_targets_for_call` y `drop_push_subscriptions` tras crearse un llamado. Esas funciones validan adentro
 *    (token de mesa, pendiente reciente) y son las únicas con acceso a las suscripciones.
 *  - Excepción acotada (ADR 0047): `src/app/panel/[org]/analitica/actions.ts` lo usa solo para llamar a `claim_analytics_summary`,
 *    `release_analytics_summary_claim` y `save_analytics_summary`, tras `requireOwner` y con el resumen ya validado. Las funciones
 *    vuelven a comprobar que quien pidió sea Dueño con el plan; ningún rol de la API puede ejecutarlas (así el Dueño no escribe por la
 *    API un texto que no pasó la validación ni esquiva el tiempo mínimo entre generaciones).
 *  - Excepción acotada (ADR 0052): `src/app/panel/[org]/suscripcion/actions.ts` y `src/app/api/mercadopago/webhook/route.ts` lo usan solo
 *    para las funciones `system_*` del cobro con Mercado Pago (crear la intención de pago, guardar su link, registrar un pago ya verificado
 *    contra la API de Mercado Pago y marcar un reembolso). La primera la llama tras `requireOwner` y la base vuelve a comprobar que sea
 *    Dueño; la segunda, sin sesión, solo tras validar la firma del aviso y leer el pago desde la API de Mercado Pago. Ningún rol de la API
 *    puede ejecutarlas, y el importe y la vigencia los calcula la base.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY: la gestión de personal no está configurada en este entorno.");
  }

  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

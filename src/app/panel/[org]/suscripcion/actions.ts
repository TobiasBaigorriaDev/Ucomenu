"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/session";
import { createCobroDb } from "@/lib/cobro/base";
import { startPayment, verifyIntentPayments } from "@/lib/cobro/cobrar";
import { parseQuote, startErrorMessage } from "@/lib/cobro/cotizacion";
import { getMercadoPagoClient, mercadoPagoConfig, resolveApiBase, siteBaseUrl } from "@/lib/cobro/mercadopago";
import type { FormState } from "@/lib/form-state";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSessionClient } from "@/lib/supabase/server";

/**
 * Pagar la suscripción con Mercado Pago (ficha cobro-con-link-de-mercado-pago, ADR 0052). Solo el Dueño: `requireOwner` prueba la
 * sesión y la base vuelve a comprobar que sea Dueño de ESA organización antes de crear nada. El navegador no manda importe, plan ni
 * período: manda solo el local, y todo lo demás lo decide la base. La clave de servicio se usa únicamente para las funciones
 * `system_*` de este flujo (ninguna rol de la API puede ejecutarlas).
 */

async function ownerFor(formData: FormData) {
  const slug = formData.get("org");
  if (typeof slug !== "string") throw new Error("Falta el local.");
  const { user, membership } = await requireOwner(slug, `/panel/${slug}/suscripcion`);
  return { user, org: membership.org };
}

/** «Pagar»: crea (o reutiliza) el link y manda al Dueño a Mercado Pago. */
export async function payAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { user, org } = await ownerFor(formData);
  const result = await startPayment({
    db: createCobroDb(createAdminClient()),
    mp: getMercadoPagoClient(),
    apiBase: mercadoPagoConfig()?.apiBase ?? resolveApiBase(undefined),
    siteUrl: siteBaseUrl(),
    orgId: org.id,
    slug: org.slug,
    userId: user.id,
  });
  if (!result.ok) return { error: startErrorMessage(result.error) };
  // Fuera del flujo normal de React: `redirect` lanza, así que va al final y sin try/catch.
  redirect(result.url);
}

/** «Ya pagué, verificar»: busca en Mercado Pago los pagos de la intención pendiente y registra los aprobados (idempotente). */
export async function verifyAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { org } = await ownerFor(formData);
  const mp = getMercadoPagoClient();
  if (!mp) return { error: "El pago en línea todavía no está disponible. Contactá a UcoMenú." };

  // Las intenciones salen de la lectura del Dueño (la base ya comprobó que lo sea): el navegador no manda ningún id.
  const db = await createSessionClient();
  const { data, error } = await db.rpc("owner_payment_quote", { p_org: org.id });
  const quote = error ? null : parseQuote(data);
  if (!quote) return { error: "No pudimos leer el estado de tu pago. Probá de nuevo en unos minutos." };
  if (quote.unpaid.length === 0) return { message: "No hay ningún pedido de pago para verificar. Si ya pagaste y tu suscripción está al día, no hace falta nada más." };

  let result;
  try {
    result = await verifyIntentPayments(createCobroDb(createAdminClient()), mp, quote.unpaid.map((intent) => intent.id));
  } catch (cause) {
    console.error(`[mercadopago] no se pudo verificar el pago: ${cause instanceof Error ? cause.message : String(cause)}`);
    return { error: "No pudimos consultar Mercado Pago. Probá de nuevo en unos minutos." };
  }
  if (result.pending) return { message: "Todavía no vemos el pago aprobado en Mercado Pago. Puede tardar unos minutos; probá de nuevo más tarde." };

  // Con el pago ya registrado el bloque «pendiente» deja de existir y se llevaría el mensaje: el resultado viaja en la dirección y lo
  // muestra la página (`?pago=`), igual que cuando se vuelve de Mercado Pago.
  revalidatePath(`/panel/${org.slug}`);
  const base = `/panel/${org.slug}/suscripcion`;
  redirect(`${base}?pago=${result.registered > 0 ? "registrado" : result.review > 0 ? "revision" : "ya_registrado"}`);
}

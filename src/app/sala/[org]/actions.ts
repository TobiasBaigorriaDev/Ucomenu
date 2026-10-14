"use server";

import { revalidatePath } from "next/cache";
import { requireMembership } from "@/lib/auth/session";
import { attendCall, type AttendResult } from "@/lib/sala/pending";
import { createSessionClient } from "@/lib/supabase/server";

/**
 * «Atendido». Vuelve a exigir sesión y membresía del local pedido (el `slug` viaja desde la pantalla, pero la
 * autoridad es la membresía de la persona) y escribe con su cliente: la política de la base decide si puede atender
 * (su organización, plan y cuenta al día). La hora y la persona que atiende las pone la base.
 */
export async function attendCallAction(slug: string, callId: string): Promise<AttendResult> {
  const { membership } = await requireMembership(slug, `/sala/${slug}`);
  const result = await attendCall(await createSessionClient(), membership.org.id, callId);
  if (result.status === "attended") revalidatePath(`/sala/${slug}`);
  return result;
}

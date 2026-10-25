"use server";

import { revalidatePath } from "next/cache";
import { requireMembership } from "@/lib/auth/session";
import { createSessionClient } from "@/lib/supabase/server";

export async function resetAllTableTurnsAction(slug: string): Promise<{ count: number } | { error: string }> {
  const { membership } = await requireMembership(slug, `/sala/${slug}/mesas`);
  try {
    const db = await createSessionClient();
    const { data, error } = await db.rpc("reset_all_table_turns", { p_org: membership.org.id });
    if (error || typeof data !== "number") return { error: "No pudimos confirmar el reinicio. Recargá las mesas antes de reintentar." };
    revalidatePath(`/sala/${slug}/mesas`);
    return { count: data };
  } catch {
    return { error: "No pudimos confirmar el resultado. Recargá las mesas antes de reintentar." };
  }
}

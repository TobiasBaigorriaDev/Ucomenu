import { createClient } from "@supabase/supabase-js";
import { purgeAuditLogWhere, purgeOrgRecordsWhere } from "./purge-price-history";

/**
 * Limpieza previa de las pruebas de RLS. Si una corrida anterior se interrumpió (o su limpieza final no alcanzó a
 * correr, p. ej. por el tiempo de un `afterAll` con la base fría), quedan organizaciones `tt-*` y usuarios `rls-*`.
 * Esos restos rompen la corrida siguiente: los `slug` se repiten y `catalog.rls.test.ts` compara la lista exacta de
 * organizaciones visibles. Acá se borran antes de empezar. Solo toca datos con prefijo de prueba, contra el
 * Supabase LOCAL (las variables salen de `.env.local` y `.env.test.local`, que carga `vitest.rls.config.mts`).
 */
export default async function setup() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return; // las propias pruebas fallan con un mensaje claro sobre las variables

  // Nunca contra un proyecto remoto.
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\b/.test(url)) {
    throw new Error(`La limpieza de las pruebas de RLS solo corre contra el Supabase local (URL: ${url}).`);
  }

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // Una organización con historial de precios o pagos no se puede borrar (RESTRICT) y ambos solo se agregan: se purgan primero.
  purgeOrgRecordsWhere("o.slug like 'tt-%'");

  // La auditoría de SuperAdmin tampoco se borra sola: se purgan los movimientos de las organizaciones de prueba.
  purgeAuditLogWhere("after->>'slug' like 'tt-%'");

  // Primero las organizaciones (borrarlas en cascada está permitido; el último Dueño no se puede borrar antes).
  const orgs = await db.from("organizations").delete().like("slug", "tt-%");
  if (orgs.error) console.warn(`No se pudieron limpiar organizaciones de prueba: ${orgs.error.message}`);

  const users = await db.auth.admin.listUsers({ perPage: 1000 });
  for (const user of users.data?.users ?? []) {
    if (user.email?.startsWith("rls-")) await db.auth.admin.deleteUser(user.id);
  }
}

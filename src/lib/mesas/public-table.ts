import { cache } from "react";
import { createPublicClient } from "@/lib/supabase/public-client";
import { parseResolvedTable, type ResolvedTable } from "./tables";
import { isToken } from "./url";

/**
 * Resuelve el token de un QR de mesa para la ruta pública `/t/{token}`. Entra como `anon`: la tabla `tables`
 * no se puede leer, solo se llama a `resolve_table_qr`. Envuelta en `cache` para que `generateMetadata` y la
 * página compartan una sola consulta por pedido. `null` = no existe (token desconocido, regenerado o inválido).
 */
export const resolveTable = cache(async (token: string): Promise<ResolvedTable | null> => {
  // Descarta tokens imposibles sin ir a la base.
  if (!isToken(token)) return null;

  const { data, error } = await createPublicClient().rpc("resolve_table_qr", { p_token: token });
  if (error) throw new Error(`No se pudo resolver el QR: ${error.message}`);
  return parseResolvedTable(data);
});

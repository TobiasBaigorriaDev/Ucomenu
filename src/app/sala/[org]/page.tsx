import { redirect } from "next/navigation";

/**
 * La lista de llamados vive ahora dentro de «Mesas» (ficha mesas-con-llamados): esta ruta queda para lo que ya apunta acá (el manifiesto
 * de la app, el enlace de las notificaciones y los favoritos).
 */
export default async function SalaPage({ params }: PageProps<"/sala/[org]">) {
  const { org } = await params;
  redirect(`/sala/${encodeURIComponent(org)}/mesas`);
}

import type { Metadata } from "next";
import { requireMembership } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Sala en vivo" };

export default async function SalaPage({ params }: PageProps<"/sala/[org]">) {
  const { org } = await params;
  const { membership } = await requireMembership(org, `/sala/${org}`);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="font-display text-4xl leading-tight">Sala en vivo</h1>
      <p className="mt-4 max-w-prose text-lg leading-relaxed text-muted">
        Acá van a aparecer los llamados de las mesas de {membership.org.name} en tiempo real. Todavía no hay mesas
        configuradas.
      </p>
    </main>
  );
}

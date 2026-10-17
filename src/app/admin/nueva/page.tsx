import type { Metadata } from "next";
import { defaultPeriodDate } from "@/lib/admin/validation";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { CreateOrganizationForm } from "./create-organization-form";

export const metadata: Metadata = { title: "Nueva organización" };

export default async function NewOrganizationPage() {
  await requirePlatformAdmin("/admin/nueva");

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:px-10 lg:py-12">
      <h1 className="font-display text-4xl leading-tight">Nueva organización</h1>
      <p className="mt-3 max-w-prose leading-relaxed text-muted">
        Crea la organización, la cuenta de su Dueño, su suscripción y su primera sucursal en un solo paso. Queda registrado quién lo
        hizo. La carta y las mesas las arma después el Dueño.
      </p>
      <CreateOrganizationForm defaultPeriodEnd={defaultPeriodDate(new Date())} />
    </main>
  );
}

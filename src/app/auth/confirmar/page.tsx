import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import "@/components/panel/panel.css";
import { parseLinkType, parseTokenHash } from "@/lib/registro/registro";
import { ConfirmForm } from "./confirm-form";

export const metadata: Metadata = { title: "Confirmar", robots: { index: false, follow: false }, referrer: "no-referrer" };

/** Destino de los enlaces por correo. No gasta el token al abrirse: lo hace el botón (ADR 0053, decisión 3). */
export default async function ConfirmarPage({ searchParams }: PageProps<"/auth/confirmar">) {
  const params = await searchParams;
  const tokenHash = parseTokenHash(params.token_hash);
  const type = parseLinkType(params.type);

  return (
    <AuthShell title="Tu carta, tus mesas y tu sala." lead="Un paso más y seguís." heading={type === "recovery" ? "Elegí una contraseña nueva" : "Confirmá tu email"}>
      {tokenHash && type ? (
        <div className="mt-6">
          <ConfirmForm tokenHash={tokenHash} type={type} />
        </div>
      ) : (
        <p role="alert" className="mt-4 max-w-prose text-base font-medium text-danger">
          Este enlace no es válido. Pedí otro desde{" "}
          <Link href="/registro" className="underline underline-offset-2">
            el registro
          </Link>
          .
        </p>
      )}
    </AuthShell>
  );
}

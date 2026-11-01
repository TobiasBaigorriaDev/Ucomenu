import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { secondaryButtonClass } from "@/components/panel/styles";
import { describeQuote, returnNotice, startErrorMessage, type PaymentQuote } from "@/lib/cobro/cotizacion";
import { formatDateWithYear } from "@/lib/entitlements";
import { payAction, verifyAction } from "./actions";

/**
 * Pagar la suscripción con Mercado Pago (ficha cobro-con-link-de-mercado-pago). El importe que se muestra es el que calcula la base;
 * el botón no manda ningún importe (solo el local). Se muestra solo si el servidor tiene Mercado Pago configurado.
 */
export function PaySection({ slug, quote, returned }: { slug: string; quote: PaymentQuote; returned: unknown }) {
  const notice = returnNotice(returned);
  const hiddenOrg = <input type="hidden" name="org" value={slug} />;

  return (
    <section aria-labelledby="pagar-titulo" className="mt-8 rounded-3xl border border-ink/20 p-5 sm:p-6" data-testid="pagar">
      <h2 id="pagar-titulo" className="font-display text-3xl leading-tight">
        Pagar con Mercado Pago
      </h2>

      {notice ? (
        <p role="status" className={`mt-3 max-w-prose text-base font-medium ${notice.tone === "warning" ? "text-danger" : "text-ink"}`} data-testid="pagar-aviso">
          {notice.text}
        </p>
      ) : null}

      {quote.available ? (
        <Available quote={quote} hiddenOrg={hiddenOrg} />
      ) : quote.reason === "already_covered" ? (
        <p className="mt-3 max-w-prose text-base text-muted" data-testid="pagar-cubierto">
          {startErrorMessage({ notAvailable: quote.reason })}
        </p>
      ) : null}

      {quote.pending ? (
        <div className="mt-5 border-t border-ink/15 pt-4" data-testid="pagar-pendiente">
          <p className="max-w-prose text-base text-muted">
            Tenés un link de pago pendiente hasta el {formatDateWithYear(quote.pending.expiresAt)}. Si ya pagaste y tu suscripción no cambió, verificalo acá.
          </p>
          <ActionForm action={verifyAction} className="mt-3">
            {hiddenOrg}
            <SubmitButton className={secondaryButtonClass} pendingLabel="Verificando…">
              Ya pagué, verificar
            </SubmitButton>
          </ActionForm>
        </div>
      ) : null}
    </section>
  );
}

function Available({ quote, hiddenOrg }: { quote: Extract<PaymentQuote, { available: true }>; hiddenOrg: React.ReactNode }) {
  const { total, period, lines } = describeQuote(quote);
  return (
    <>
      <p className="mt-3 font-display text-4xl leading-tight tabular-nums" data-testid="pagar-total">
        {total} <span className="text-xl font-normal text-muted">{period}</span>
      </p>
      <ul className="mt-2 text-base text-muted" data-testid="pagar-desglose">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <ActionForm action={payAction} className="mt-4">
        {hiddenOrg}
        <SubmitButton pendingLabel="Abriendo Mercado Pago…">Pagar con Mercado Pago</SubmitButton>
      </ActionForm>
      <p className="mt-3 max-w-prose text-sm text-muted">
        Vas a pagar en Mercado Pago, con el medio que prefieras. Cuando se aprueba, tu suscripción se renueva sola: el nuevo período suma a lo que ya tenías.
      </p>
    </>
  );
}

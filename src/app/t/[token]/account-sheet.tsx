"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { formatAsOf, type AccountResult } from "@/lib/cuenta/account";
import type { Lang } from "@/lib/idiomas/idiomas";
import { TEXTOS } from "@/lib/idiomas/textos";
import { formatArs } from "@/lib/money";
import { viewAccountAction } from "./actions";
import { PropinaSugerida } from "@/components/propina-sugerida";

type Load = { phase: "loading" } | { phase: "done"; result: AccountResult };

/**
 * «Ver mi cuenta» (ficha cuenta-del-comensal, ADR 0044): una hoja modal con lo anotado en la mesa de quien pidió la cuenta. Lee al abrirse y
 * cada vez que se toca «Actualizar» (no hay copia local ni caché). Un ticket vencido o un turno reiniciado se avisa igual que en los
 * llamados («escaneá de nuevo»). Lleva siempre la leyenda: no es una factura. Quien la monta decide cuándo existe.
 */
export function AccountSheet({ token, ticket, lang, onClose, onExpired }: { token: string; ticket: string; lang: Lang; onClose: () => void; onExpired: () => void }) {
  const t = TEXTOS[lang].account;
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [round, setRound] = useState(0);

  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (element && !element.open) element.showModal();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const fetchAccount = useCallback(async (): Promise<AccountResult> => {
    try {
      return await viewAccountAction(token, ticket);
    } catch {
      return { status: "error" };
    }
  }, [token, ticket]);

  useEffect(() => {
    let current = true;
    void fetchAccount().then((result) => {
      if (!current) return;
      setLoad({ phase: "done", result });
      if (result.status === "expired") onExpired();
    });
    return () => {
      current = false;
    };
  }, [fetchAccount, round, onExpired]);

  const result = load.phase === "done" ? load.result : null;

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      data-testid="hoja-cuenta"
      onClose={onClose}
      className="carta-dialog m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-3xl border-0 bg-porcelain p-0 text-ink backdrop:bg-ink/50 sm:m-auto sm:max-w-lg sm:rounded-3xl"
    >
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="font-display text-3xl leading-tight break-words">
            {t.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.close}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-ink/50 px-4 py-2 text-base font-medium text-ink hover:bg-ink/5"
          >
            {t.close}
          </button>
        </div>

        {result === null ? (
          <p role="status" className="mt-4 text-lg text-muted" data-testid="cuenta-cargando">
            {t.loading}
          </p>
        ) : null}

        {result?.status === "error" ? (
          <p role="alert" className="mt-4 rounded-2xl border-2 border-ink px-4 py-3 text-lg font-medium" data-testid="cuenta-error">
            {t.error}
          </p>
        ) : null}

        {result?.status === "expired" ? (
          <p role="status" className="mt-4 text-lg" data-testid="cuenta-vencida">
            {TEXTOS[lang].call.expired}
          </p>
        ) : null}

        {result?.status === "empty" ? (
          <p role="status" className="mt-4 text-lg" data-testid="cuenta-vacia">
            {t.empty}
          </p>
        ) : null}

        {result?.status === "ok" ? (
          <section className="mt-3" data-testid="cuenta" aria-label={t.title}>
            <p className="text-base text-muted">
              <span data-testid="cuenta-mesa">{result.account.tableLabel}</span> · {result.account.orgName}
            </p>
            <ul className="mt-3 divide-y divide-ink/15 rounded-3xl border border-ink/25 bg-ink/5" data-testid="cuenta-lineas">
              {result.account.lines.map((line, index) => (
                <li key={index} className="flex items-start justify-between gap-3 px-4 py-3" data-testid="cuenta-linea">
                  <div className="min-w-0">
                    <p className="text-lg leading-snug break-words">
                      {line.quantity} × {line.name}
                    </p>
                    {line.options.length > 0 ? <p className="text-base text-muted break-words">{line.options.join(" · ")}</p> : null}
                    {line.quantity > 1 ? <p className="text-sm text-muted">{t.each(formatArs(line.unitCents))}</p> : null}
                  </div>
                  <p className="shrink-0 text-lg font-semibold">{formatArs(line.lineCents)}</p>
                </li>
              ))}
            </ul>
            <p className="mt-4 flex items-baseline justify-between gap-3 text-lg" data-testid="cuenta-total" data-centavos={result.account.totalCents}>
              <span>
                {result.account.tip ? t.consumed : t.total} · {t.dishes(result.account.dishes)}
              </span>
              <strong className="font-display text-3xl leading-none">{formatArs(result.account.totalCents)}</strong>
            </p>
            <PropinaSugerida tip={result.account.tip} labels={t} />
            <p className="mt-4 rounded-2xl border-2 border-ink px-4 py-2 text-center text-base font-bold tracking-wide uppercase" data-testid="cuenta-leyenda">
              {t.legend}
            </p>
            <p className="mt-3 text-sm text-muted">{t.note}</p>
            <p className="mt-1 text-sm text-muted" data-testid="cuenta-hora">
              {t.asOf(formatAsOf(result.account.asOf, result.account.timeZone, lang))}
            </p>
          </section>
        ) : null}

        <button
          type="button"
          disabled={result === null}
          onClick={() => {
            setLoad({ phase: "loading" });
            setRound((n) => n + 1);
          }}
          data-testid="cuenta-actualizar"
          className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-full border border-ink/50 px-4 py-2 text-base font-medium text-ink hover:bg-ink/5 disabled:opacity-60"
        >
          {t.refresh}
        </button>
      </div>
    </dialog>
  );
}

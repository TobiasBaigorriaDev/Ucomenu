"use client";

import { useState } from "react";
import { formatArs } from "@/lib/money";
import { isStaleOperation, MAX_REASON, normalizeReason, OPERATE_TEXT, reasonProblem, type OperateFailure, type OperateResult } from "@/lib/sala/operar";
import { closeOrderAction, voidOrderAction } from "./actions";
import { Sheet } from "./sheet";
import { buttonClass, dangerPrimaryClass, errorBoxClass, fieldClass, primaryClass } from "./ui";

/**
 * Cerrar o anular el pedido de la mesa. Cerrar es lo normal (la mesa queda libre; se avisa si hay platos sin entregar, pero decide el
 * mozo). Anular descarta el pedido y exige un motivo. Los dos funcionan aunque el plan o la cuenta ya no permitan pedidos (ADR 0041).
 * Al terminar vuelve a «Mesas».
 */
export function CloseSheet({
  slug,
  orderId,
  summary,
  onClose,
  onDone,
  onStale,
}: {
  slug: string;
  orderId: string;
  summary: { dishes: number; totalCents: number; undelivered: number };
  onClose: () => void;
  onDone: () => void;
  onStale: () => void;
}) {
  const [mode, setMode] = useState<"menu" | "void">("menu");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"close" | "void" | null>(null);
  const [error, setError] = useState<OperateFailure | null>(null);

  const issue = reasonProblem(reason);
  const canVoid = busy === null && issue === null && normalizeReason(reason) !== null;

  async function run(kind: "close" | "void") {
    setBusy(kind);
    setError(null);
    try {
      const result: OperateResult =
        kind === "close" ? await closeOrderAction(slug, { orderId }) : await voidOrderAction(slug, { orderId, reason: normalizeReason(reason) });
      if (result.status === "done") {
        onDone();
        return;
      }
      setError(result.reason);
      if (isStaleOperation(result.reason)) onStale();
    } catch {
      setError("unexpected");
      onStale();
    } finally {
      setBusy(null);
    }
  }

  const failure = error ? (
    <p role="alert" data-testid="cierre-error" className={`mb-3 ${errorBoxClass}`}>
      {OPERATE_TEXT[error]}
    </p>
  ) : null;

  return (
    <Sheet
      title={mode === "menu" ? "Cerrar o anular el pedido" : "Anular el pedido"}
      testId="hoja-cierre"
      busy={busy !== null}
      onClose={onClose}
      closeLabel="Cerrar sin cambios"
      footer={
        mode === "menu" ? (
          <>
            {failure}
            <button type="button" onClick={() => run("close")} disabled={busy !== null} data-testid="cerrar-pedido" className={`${primaryClass} w-full`}>
              {busy === "close" ? "Cerrando…" : "Cerrar pedido"}
            </button>
            <button type="button" onClick={() => setMode("void")} disabled={busy !== null} data-testid="ir-a-anular" className={`${buttonClass} mt-2 w-full`}>
              Anular pedido…
            </button>
          </>
        ) : (
          <>
            {failure}
            <button type="button" onClick={() => run("void")} disabled={!canVoid} data-testid="anular-pedido" className={`${dangerPrimaryClass} w-full`}>
              {busy === "void" ? "Anulando…" : "Anular pedido"}
            </button>
            <button type="button" onClick={() => setMode("menu")} disabled={busy !== null} className={`${buttonClass} mt-2 w-full`}>
              Volver
            </button>
          </>
        )
      }
    >
      <p className="mt-2 text-lg" data-testid="cierre-resumen">
        {summary.dishes === 0 ? "Sin platos vigentes" : summary.dishes === 1 ? "1 plato" : `${summary.dishes} platos`} · <strong>{formatArs(summary.totalCents)}</strong>
      </p>

      {mode === "menu" ? (
        <>
          <p className="mt-2 text-base text-muted">Al cerrar, la mesa queda libre para un pedido nuevo. Esto no es una factura.</p>
          {summary.undelivered > 0 ? (
            <p className="mt-3 rounded-2xl bg-grace-bg px-4 py-3 text-base text-grace-ink ring-1 ring-inset ring-grace-edge" data-testid="sin-entregar">
              <strong>
                {summary.undelivered === 1 ? "Hay 1 plato sin entregar." : `Hay ${summary.undelivered} platos sin entregar.`}
              </strong>{" "}
              Podés cerrar igual.
            </p>
          ) : null}
        </>
      ) : (
        <>
          <p className="mt-2 text-base text-muted">Anular descarta el pedido y deja la mesa libre. Queda registrado con el motivo y no se puede deshacer.</p>
          <label className="mt-4 block text-lg font-semibold" htmlFor="anular-motivo">
            Motivo de la anulación
          </label>
          <input
            id="anular-motivo"
            type="text"
            value={reason}
            maxLength={MAX_REASON + 40}
            disabled={busy !== null}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Se fueron antes de que saliera, error de mesa…"
            autoComplete="off"
            className={`${fieldClass} mt-1`}
          />
          {issue ? <p className="mt-1 text-sm font-semibold text-suspended-ink">{issue === "too_long" ? `Hasta ${MAX_REASON} caracteres.` : "Tiene que ser una sola línea, sin caracteres especiales."}</p> : null}
        </>
      )}
    </Sheet>
  );
}

"use client";

import { useState } from "react";
import { RESET_TEXT, type ResetFailure } from "@/lib/sala/turno";
import { resetTableTurnAction } from "./actions";
import { Sheet } from "./sheet";
import { errorBoxClass, primaryClass } from "./ui";

/**
 * Reiniciar el turno de la mesa (ADR 0044). Sirve cuando el pedido no se cerró desde la app (cobraron de palabra) o para cortar a mano el
 * acceso de quienes escanearon antes. El QR impreso no cambia. Pide confirmación porque quien tiene la cuenta abierta en el celular tendrá
 * que escanear de nuevo.
 */
export function ResetSheet({ slug, tableId, label, onClose }: { slug: string; tableId: string; label: string; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ResetFailure | null>(null);
  const [done, setDone] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const result = await resetTableTurnAction(slug, { tableId });
      if (result.status === "done") setDone(true);
      else setError(result.reason);
    } catch {
      setError("unexpected");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="Reiniciar el QR de la mesa"
      testId="hoja-reinicio"
      busy={busy}
      onClose={onClose}
      closeLabel="Cerrar sin reiniciar"
      footer={
        done ? (
          <button type="button" onClick={onClose} data-testid="reinicio-listo" className={`${primaryClass} w-full`}>
            Listo
          </button>
        ) : (
          <>
            {error ? (
              <p role="alert" data-testid="reinicio-error" className={`mb-3 ${errorBoxClass}`}>
                {RESET_TEXT[error]}
              </p>
            ) : null}
            <button type="button" onClick={run} disabled={busy} data-testid="confirmar-reinicio" className={`${primaryClass} w-full`}>
              {busy ? "Reiniciando…" : "Reiniciar QR"}
            </button>
          </>
        )
      }
    >
      {done ? (
        <p className="mt-2 text-lg" role="status" data-testid="reinicio-hecho">
          Listo: <strong>{label}</strong> arranca un turno nuevo. Quien escanee ahora ve la carta como siempre.
        </p>
      ) : (
        <>
          <p className="mt-2 text-lg">
            Esto empieza un turno nuevo en <strong>{label}</strong>. Quien tenga la cuenta abierta en el celular va a tener que escanear de nuevo el QR.
          </p>
          <p className="mt-2 text-base text-muted">El QR impreso no cambia y el pedido no se toca. Cerrar o anular el pedido ya hace esto solo.</p>
        </>
      )}
    </Sheet>
  );
}

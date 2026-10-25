"use client";

import { useState } from "react";
import { Sheet } from "./[mesa]/anotar/sheet";
import { buttonClass, primaryClass } from "./[mesa]/anotar/ui";
import { resetAllTableTurnsAction } from "./reset-all-actions";

export function ResetAllButton({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [count, setCount] = useState<number | null>(null);
  async function run() {
    setBusy(true);
    setError("");
    try {
      const result = await resetAllTableTurnsAction(slug);
      if ("error" in result) setError(result.error);
      else setCount(result.count);
    } catch {
      setError("No pudimos confirmar el resultado. Recargá las mesas antes de reintentar.");
    } finally {
      setBusy(false);
    }
  }
  return <>
    <button className={`${buttonClass} mt-4`} type="button" onClick={() => { setCount(null); setError(""); setOpen(true); }}>Reiniciar todos los QR</button>
    {open ? <Sheet title="Reiniciar todos los QR" testId="reinicio-todos" busy={busy} onClose={() => setOpen(false)} closeLabel="Cerrar sin reiniciar"
      footer={count === null
        ? <button className={`${primaryClass} w-full`} type="button" disabled={busy} onClick={run}>{busy ? "Reiniciando…" : "Sí, reiniciar todas las mesas"}</button>
        : <button className={`${primaryClass} w-full`} type="button" onClick={() => setOpen(false)}>Listo</button>}>
      {count === null ? <>
        <p className="mt-3 text-lg">Vas a terminar las visitas de todas las mesas de este local, en todas sus sucursales. Los clientes tendrán que escanear de nuevo para llamar al mozo o ver la cuenta.</p>
        <p className="mt-2 text-base text-muted">El QR impreso no cambia. Los pedidos y sus importes se conservan.</p>
      </> : <p className="mt-3 text-lg" role="status">Listo: se reiniciaron {count} mesas. Los clientes ya pueden escanear de nuevo.</p>}
      {error ? <p className="mt-3 text-base text-danger" role="alert">{error}</p> : null}
    </Sheet> : null}
  </>;
}

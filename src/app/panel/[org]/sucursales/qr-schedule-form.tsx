"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { setQrResetTimesAction } from "./actions";

export function QrScheduleForm({ orgSlug, id, name, times, timeZone, canWrite }: {
  orgSlug: string; id: string; name: string; times: string[]; timeZone: string; canWrite: boolean;
}) {
  const [rows, setRows] = useState(times.map((time, index) => ({ key: index, time })));
  const [nextKey, setNextKey] = useState(times.length);
  return <details className="mt-4 border-t border-ink/15 pt-4">
    <summary className="min-h-11 cursor-pointer text-base font-medium">Reinicios automáticos de QR · {name}</summary>
    <ActionForm action={setQrResetTimesAction} className="mt-3 max-w-lg">
      {() => <fieldset disabled={!canWrite} className="grid gap-3">
        <input type="hidden" name="org" value={orgSlug} />
        <input type="hidden" name="id" value={id} />
        <p className="text-base text-muted" id={`qr-help-${id}`}>Todos los días, en la hora de esta sucursal ({timeZone}). Elegí momentos en que el negocio esté cerrado. Por defecto: 05:00.</p>
        {rows.map((row, index) => <div className="flex flex-wrap items-end gap-2" key={row.key}>
          <label className="grid gap-1 text-base font-medium" htmlFor={`qr-time-${id}-${row.key}`}>
            Horario {index + 1}
            <input className="min-h-11 rounded-lg border border-ink/30 bg-white px-3 py-2" id={`qr-time-${id}-${row.key}`} type="time" name="reset_time" required step={60} value={row.time}
              aria-describedby={`qr-help-${id}`} onChange={(e) => setRows(rows.map((r) => r.key === row.key ? { ...r, time: e.target.value } : r))} />
          </label>
          <button type="button" className="min-h-11 px-3 text-base underline underline-offset-2" aria-label={`Quitar horario ${index + 1}`} onClick={() => setRows(rows.filter((r) => r.key !== row.key))}>Quitar</button>
        </div>)}
        {rows.length === 0 ? <p role="status" className="text-base">Sin horarios: al guardar, el reinicio automático queda desactivado.</p> : null}
        <div><button type="button" disabled={rows.length >= 24} className="min-h-11 rounded-full border border-ink/40 px-4 py-2 text-base font-medium disabled:opacity-50"
          onClick={() => { setRows([...rows, { key: nextKey, time: "" }]); setNextKey(nextKey + 1); }}>Agregar horario</button></div>
        <p className="text-sm text-muted">Los clientes tendrán que escanear de nuevo para llamar o ver la cuenta. No cambia el QR impreso ni cierra pedidos. Puede tardar alrededor de un minuto; si el servicio se interrumpe, el reinicio pendiente se ejecuta al volver.</p>
        <div><SubmitButton pendingLabel="Guardando…">Guardar horarios</SubmitButton></div>
      </fieldset>}
    </ActionForm>
  </details>;
}

"use client";

import { useState } from "react";
import { formatArs } from "@/lib/money";
import { LINE_STATUS_TEXT, MAX_NOTE, MAX_QUANTITY, noteProblem, normalizeNote, type AnotarLine } from "@/lib/sala/anotar";
import { lineCents } from "@/lib/sala/mesas";
import {
  canEditLine,
  isStaleOperation,
  lineMoves,
  MAX_REASON,
  MOVE_LABEL,
  needsReason,
  normalizeReason,
  OPERATE_TEXT,
  reasonProblem,
  type LineTarget,
  type OperateFailure,
  type OperateResult,
} from "@/lib/sala/operar";
import { setLineStatusAction, updateLineAction } from "./actions";
import { Sheet } from "./sheet";
import { buttonClass, dangerClass, dangerPrimaryClass, errorBoxClass, fieldClass, primaryClass, smallPrimaryClass } from "./ui";

/**
 * Una línea del pedido con lo que se puede hacer con ella en su estado: avanzar (en cocina → entregado), modificar (solo anotadas) y
 * cancelar (siempre con confirmación; con motivo obligatorio si ya se entregó). La base decide; si otra persona ya cambió la línea, se
 * dice y se recarga el pedido.
 */
export function LineCard({ slug, line, canOperate, onStale }: { slug: string; line: AnotarLine; canOperate: boolean; onStale: () => void }) {
  const [busy, setBusy] = useState<LineTarget | null>(null);
  const [error, setError] = useState<OperateFailure | null>(null);
  const [sheet, setSheet] = useState<"edit" | "cancel" | null>(null);

  const cancelled = line.status === "cancelled";
  const moves = canOperate ? lineMoves(line.status) : [];
  const advances = moves.filter((target) => target !== "cancelled");
  const canCancel = moves.includes("cancelled");
  const canEdit = canOperate && canEditLine(line.status);

  /** Aplica el resultado: lo no válido se muestra; lo que indica un pedido que cambió, además, recarga. */
  function settle(result: OperateResult): boolean {
    if (result.status === "done") {
      setError(null);
      return true;
    }
    setError(result.reason);
    if (isStaleOperation(result.reason)) onStale();
    return false;
  }

  async function advance(target: LineTarget) {
    setBusy(target);
    setError(null);
    try {
      settle(await setLineStatusAction(slug, { itemId: line.id, status: target }));
    } catch {
      settle({ status: "failed", reason: "unexpected" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <li data-testid="linea" data-estado={line.status} className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-lg font-medium break-words ${cancelled ? "text-muted line-through" : ""}`}>
            {line.quantity} × {line.productName}
          </p>
          {line.options.length > 0 ? <p className="text-base text-muted break-words">{line.options.map((option) => option.name).join(", ")}</p> : null}
          {line.note ? <p className="text-base break-words">«{line.note}»</p> : null}
          <p className="text-sm text-muted" data-testid="linea-estado">
            {LINE_STATUS_TEXT[line.status]}
            {cancelled && line.cancelReason ? ` · ${line.cancelReason}` : ""}
          </p>
        </div>
        <p className={`shrink-0 text-lg ${cancelled ? "text-muted line-through" : ""}`}>{formatArs(lineCents(line))}</p>
      </div>

      {canEdit || advances.length > 0 || canCancel ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {advances.map((target, index) => (
            <button
              key={target}
              type="button"
              disabled={busy !== null}
              onClick={() => advance(target)}
              aria-label={`${target === "in_kitchen" ? "Pasar a cocina" : "Marcar entregado"}: ${line.productName}`}
              className={index === 0 ? smallPrimaryClass : buttonClass}
            >
              {busy === target ? "Guardando…" : MOVE_LABEL[target]}
            </button>
          ))}
          {canEdit ? (
            <button type="button" disabled={busy !== null} onClick={() => setSheet("edit")} aria-label={`Modificar: ${line.productName}`} className={buttonClass}>
              Modificar
            </button>
          ) : null}
          {canCancel ? (
            <button type="button" disabled={busy !== null} onClick={() => setSheet("cancel")} aria-label={`Cancelar línea: ${line.productName}`} className={dangerClass}>
              Cancelar
            </button>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" data-testid="linea-error" className={`mt-3 ${errorBoxClass}`}>
          {OPERATE_TEXT[error]}
        </p>
      ) : null}

      {sheet === "edit" ? <EditSheet slug={slug} line={line} onClose={() => setSheet(null)} onStale={onStale} /> : null}
      {sheet === "cancel" ? <CancelSheet slug={slug} line={line} onClose={() => setSheet(null)} onStale={onStale} /> : null}
    </li>
  );
}

/** Modificar cantidad y observación de una línea anotada. El plato y las opciones no se cambian: se cancela y se anota otra. */
function EditSheet({ slug, line, onClose, onStale }: { slug: string; line: AnotarLine; onClose: () => void; onStale: () => void }) {
  const [quantity, setQuantity] = useState(line.quantity);
  const [note, setNote] = useState(line.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<OperateFailure | null>(null);

  const noteIssue = noteProblem(note);
  const changed = quantity !== line.quantity || normalizeNote(note) !== line.note;
  const canSave = !busy && changed && noteIssue === null && quantity >= 1 && quantity <= MAX_QUANTITY;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const result = await updateLineAction(slug, { itemId: line.id, quantity, note: normalizeNote(note) });
      if (result.status === "done") {
        onClose();
        return;
      }
      setError(result.reason);
      if (isStaleOperation(result.reason)) onStale();
    } catch {
      setError("unexpected");
      onStale();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={`Modificar ${line.productName}`}
      testId="hoja-editar"
      busy={busy}
      onClose={onClose}
      closeLabel="Cerrar sin guardar"
      footer={
        <>
          {error ? (
            <p role="alert" data-testid="editar-error" className={`mb-3 ${errorBoxClass}`}>
              {OPERATE_TEXT[error]}
            </p>
          ) : null}
          <button type="button" onClick={save} disabled={!canSave} data-testid="editar-guardar" className={`${primaryClass} w-full`}>
            {busy ? "Guardando…" : "Guardar cambios"}
          </button>
        </>
      }
    >
      {line.options.length > 0 ? <p className="mt-1 text-base text-muted">{line.options.map((option) => option.name).join(", ")}</p> : null}
      <p className="mt-2 text-sm text-muted">Para cambiar el plato o sus opciones, cancelá la línea y anotá otra.</p>

      <div className="mt-5 flex items-center gap-3">
        <span id="editar-cantidad-etiqueta" className="text-lg font-medium">
          Cantidad
        </span>
        <button type="button" className={`${buttonClass} min-w-12`} aria-label="Una menos" disabled={busy || quantity <= 1} onClick={() => setQuantity((current) => Math.max(1, current - 1))}>
          −
        </button>
        <output aria-labelledby="editar-cantidad-etiqueta" data-testid="editar-cantidad" className="min-w-8 text-center font-display text-3xl leading-none">
          {quantity}
        </output>
        <button type="button" className={`${buttonClass} min-w-12`} aria-label="Una más" disabled={busy || quantity >= MAX_QUANTITY} onClick={() => setQuantity((current) => Math.min(MAX_QUANTITY, current + 1))}>
          +
        </button>
      </div>

      <label className="mt-5 block text-lg font-semibold" htmlFor="editar-observacion">
        Observación
      </label>
      <input
        id="editar-observacion"
        type="text"
        value={note}
        maxLength={MAX_NOTE + 40}
        disabled={busy}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Sin cebolla, bien cocido…"
        autoComplete="off"
        className={`${fieldClass} mt-1`}
      />
      {noteIssue ? (
        <p className="mt-1 text-sm font-semibold text-suspended-ink">{noteIssue === "too_long" ? `Hasta ${MAX_NOTE} caracteres.` : "Tiene que ser una sola línea, sin caracteres especiales."}</p>
      ) : null}
    </Sheet>
  );
}

/** Cancelar una línea: siempre se confirma; el motivo es opcional, salvo en una línea ya entregada (obligatorio). */
function CancelSheet({ slug, line, onClose, onStale }: { slug: string; line: AnotarLine; onClose: () => void; onStale: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<OperateFailure | null>(null);

  const required = needsReason(line.status, "cancelled");
  const issue = reasonProblem(reason);
  const canConfirm = !busy && issue === null && (!required || normalizeReason(reason) !== null);

  async function confirm() {
    if (!canConfirm) return;
    setBusy(true);
    setError(null);
    try {
      const result = await setLineStatusAction(slug, { itemId: line.id, status: "cancelled", reason: normalizeReason(reason) });
      if (result.status === "done") {
        onClose();
        return;
      }
      setError(result.reason);
      if (isStaleOperation(result.reason)) onStale();
    } catch {
      setError("unexpected");
      onStale();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={`Cancelar ${line.productName}`}
      testId="hoja-cancelar"
      busy={busy}
      onClose={onClose}
      closeLabel="Volver sin cancelar"
      footer={
        <>
          {error ? (
            <p role="alert" data-testid="cancelar-error" className={`mb-3 ${errorBoxClass}`}>
              {OPERATE_TEXT[error]}
            </p>
          ) : null}
          <button type="button" onClick={confirm} disabled={!canConfirm} data-testid="cancelar-confirmar" className={`${dangerPrimaryClass} w-full`}>
            {busy ? "Cancelando…" : "Cancelar esta línea"}
          </button>
        </>
      }
    >
      <p className="mt-2 text-lg">
        {line.quantity} × {line.productName} · {formatArs(lineCents(line))}
      </p>
      <p className="mt-1 text-base text-muted">La línea queda cancelada y deja de sumar al total. No se puede deshacer.</p>
      {required ? <p className="mt-2 text-base font-semibold">Ya se entregó: el motivo es obligatorio.</p> : null}

      <label className="mt-4 block text-lg font-semibold" htmlFor="cancelar-motivo">
        Motivo{required ? "" : " (opcional)"}
      </label>
      <input
        id="cancelar-motivo"
        type="text"
        value={reason}
        maxLength={MAX_REASON + 40}
        disabled={busy}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Se equivocó de plato, llegó frío…"
        autoComplete="off"
        className={`${fieldClass} mt-1`}
      />
      {issue ? <p className="mt-1 text-sm font-semibold text-suspended-ink">{issue === "too_long" ? `Hasta ${MAX_REASON} caracteres.` : "Tiene que ser una sola línea, sin caracteres especiales."}</p> : null}
    </Sheet>
  );
}

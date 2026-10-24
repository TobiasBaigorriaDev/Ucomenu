"use client";

import { useState } from "react";
import { formatArs } from "@/lib/money";
import {
  checkGroups,
  chosenIds,
  FAILURE_TEXT,
  groupHint,
  isStaleFailure,
  MAX_NOTE,
  MAX_QUANTITY,
  noteProblem,
  normalizeNote,
  previewCents,
  type AddFailure,
  type AnotarGroup,
  type AnotarProduct,
} from "@/lib/sala/anotar";
import { addOrderItemAction } from "./actions";
import { Sheet } from "./sheet";
import { buttonClass, errorBoxClass, fieldClass, primaryClass } from "./ui";

/** Un identificador por intento de anotar: repetirlo (cortó la red) no duplica la línea. */
function newKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const signedArs = (cents: number) => (cents === 0 ? "" : cents > 0 ? `+ ${formatArs(cents)}` : `− ${formatArs(-cents)}`);

/** El panel de un plato: cantidad, opciones y observación. Un panel nuevo por plato (`key`), con su propia clave de reintento. */
export function DishSheet({
  slug,
  tableId,
  product,
  onClose,
  onStale,
  onAdded,
}: {
  slug: string;
  tableId: string;
  product: AnotarProduct | null;
  onClose: () => void;
  onStale: () => void;
  onAdded: (text: string) => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<AddFailure | null>(null);
  const [key] = useState(newKey);

  const groups = product?.groups ?? [];
  const checks = checkGroups(groups, selected);
  const missing = checks.filter((check) => check.problem !== null);
  const noteIssue = noteProblem(note);
  const blocked = !product || product.block !== null;
  const canSubmit = !busy && !blocked && missing.length === 0 && noteIssue === null && quantity >= 1 && quantity <= MAX_QUANTITY;

  function pick(group: AnotarGroup, optionId: string, on: boolean) {
    setFailure(null);
    setSelected((current) => {
      const next = new Set(current);
      if (group.max === 1) for (const option of group.options) next.delete(option.id);
      if (on) next.add(optionId);
      else next.delete(optionId);
      return next;
    });
  }

  async function submit() {
    if (!product || !canSubmit) return;
    setBusy(true);
    setFailure(null);
    try {
      const result = await addOrderItemAction(slug, {
        tableId,
        productId: product.id,
        quantity,
        optionIds: chosenIds(groups, selected),
        note: normalizeNote(note),
        clientKey: key,
      });
      if (result.status === "added") {
        onAdded(`${result.replayed ? "Ya estaba anotado" : "Anotado"}: ${quantity} × ${product.name}.`);
        return;
      }
      setFailure(result.reason);
      if (isStaleFailure(result.reason)) onStale();
    } catch {
      setFailure("unexpected");
    } finally {
      setBusy(false);
    }
  }

  const footer = product ? (
    <>
      {failure ? (
        <p role="alert" data-testid="anotar-error" className={`mb-3 ${errorBoxClass}`}>
          {FAILURE_TEXT[failure]}
        </p>
      ) : null}
      {missing.length > 0 ? (
        <p className="mb-3 text-base text-muted" data-testid="faltan">
          Falta elegir: {missing.map((check) => check.group.name).join(", ")}.
        </p>
      ) : null}
      <button type="button" onClick={submit} disabled={!canSubmit} data-testid="anotar-confirmar" className={`${primaryClass} w-full`}>
        {busy ? "Anotando…" : `Anotar · ${formatArs(previewCents(product, quantity, selected))}`}
      </button>
    </>
  ) : undefined;

  return (
    <Sheet title={product ? product.name : "Plato no disponible"} testId="hoja-anotar" busy={busy} onClose={onClose} closeLabel="Cerrar sin anotar" footer={footer}>
      {!product ? (
        <p role="alert" className="mt-4 text-lg">
          Este plato ya no está en la carta de la sucursal. Cerrá y elegí otro.
        </p>
      ) : (
        <>
          <p className="mt-1 text-lg" data-testid="hoja-precio">
            {product.listCents !== null ? <span className="mr-2 text-muted line-through">{formatArs(product.listCents)}</span> : null}
            {formatArs(product.priceCents)}
            {product.promotionName ? <span className="ml-2 text-base text-muted">· {product.promotionName}</span> : null}
          </p>
          {product.description ? <p className="mt-1 text-base text-muted break-words">{product.description}</p> : null}

          <div className="mt-5 flex items-center gap-3">
            <span id="cantidad-etiqueta" className="text-lg font-medium">
              Cantidad
            </span>
            <button
              type="button"
              className={`${buttonClass} min-w-12`}
              aria-label="Una menos"
              disabled={busy || quantity <= 1}
              onClick={() => {
                setFailure(null);
                setQuantity((current) => Math.max(1, current - 1));
              }}
            >
              −
            </button>
            <output aria-labelledby="cantidad-etiqueta" data-testid="cantidad" className="min-w-8 text-center font-display text-3xl leading-none">
              {quantity}
            </output>
            <button
              type="button"
              className={`${buttonClass} min-w-12`}
              aria-label="Una más"
              disabled={busy || quantity >= MAX_QUANTITY}
              onClick={() => {
                setFailure(null);
                setQuantity((current) => Math.min(MAX_QUANTITY, current + 1));
              }}
            >
              +
            </button>
          </div>

          {checks.map(({ group, chosen, problem }) => (
            <fieldset key={group.id} className="mt-5" data-testid="grupo" data-grupo={group.name}>
              <legend className="text-lg font-semibold break-words">{group.name}</legend>
              <p className="text-sm text-muted">
                {groupHint(group)}
                {problem === "required" ? <strong className="text-suspended-ink"> · Falta elegir</strong> : null}
              </p>
              <ul className="mt-2 space-y-1">
                {group.max === 1 && group.min === 0 ? (
                  <li>
                    <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl px-2 hover:bg-ink/5">
                      <input type="radio" name={group.id} checked={chosen === 0} disabled={busy} onChange={() => pick(group, "", false)} className="size-5" />
                      <span className="text-lg">Ninguna</span>
                    </label>
                  </li>
                ) : null}
                {group.options.map((option) => {
                  const on = selected.has(option.id);
                  const single = group.max === 1;
                  return (
                    <li key={option.id}>
                      <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl px-2 hover:bg-ink/5">
                        <input
                          type={single ? "radio" : "checkbox"}
                          name={group.id}
                          checked={on}
                          disabled={busy || (!single && !on && chosen >= group.max)}
                          onChange={(event) => pick(group, option.id, single ? true : event.target.checked)}
                          className="size-5"
                        />
                        <span className="min-w-0 flex-1 text-lg break-words">{option.name}</span>
                        {option.deltaCents !== 0 ? <span className="shrink-0 text-base text-muted">{signedArs(option.deltaCents)}</span> : null}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          ))}

          <label className="mt-5 block text-lg font-semibold" htmlFor="observacion">
            Observación
          </label>
          <input
            id="observacion"
            type="text"
            value={note}
            maxLength={MAX_NOTE + 40}
            disabled={busy}
            onChange={(event) => {
              setFailure(null);
              setNote(event.target.value);
            }}
            placeholder="Sin cebolla, bien cocido…"
            autoComplete="off"
            className={`${fieldClass} mt-1`}
          />
          {noteIssue ? (
            <p className="mt-1 text-sm font-semibold text-suspended-ink">
              {noteIssue === "too_long" ? `Hasta ${MAX_NOTE} caracteres.` : "Tiene que ser una sola línea, sin caracteres especiales."}
            </p>
          ) : null}
        </>
      )}
    </Sheet>
  );
}

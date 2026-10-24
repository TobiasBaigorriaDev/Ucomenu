"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatArs } from "@/lib/money";
import {
  checkGroups,
  chosenIds,
  FAILURE_TEXT,
  filterSections,
  groupHint,
  isStaleFailure,
  LINE_STATUS_TEXT,
  MAX_NOTE,
  MAX_QUANTITY,
  noteProblem,
  normalizeNote,
  previewCents,
  type AddFailure,
  type AnotarData,
  type AnotarGroup,
  type AnotarProduct,
} from "@/lib/sala/anotar";
import { lineCents, orderCents, orderStatusText, summarizeOrder } from "@/lib/sala/mesas";
import { addOrderItemAction } from "./actions";

const buttonClass =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-ink/50 px-4 py-2 text-base font-medium text-ink hover:bg-ink/5 disabled:opacity-60";
const primaryClass =
  "inline-flex min-h-12 items-center justify-center rounded-full bg-cobalt px-6 py-2 text-lg font-medium text-white hover:bg-brand-deep disabled:opacity-60";
const fieldClass = "min-h-12 w-full rounded-2xl border border-ink/30 bg-white px-4 py-2 text-lg text-ink";

/** Sondeo liviano: al volver a la pestaña se recarga el pedido y la carta (otra persona pudo anotar o cambiar algo). */
const REFRESH_MIN_MS = 3_000;

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

export function AnotarScreen({ slug, data, isOwner }: { slug: string; data: AnotarData; isOwner: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lastRefresh = useRef(0);

  // Al volver a la pestaña o recuperar la red se pide el estado de nuevo (el servidor es la fuente; acá no hay copia del pedido).
  useEffect(() => {
    const wake = () => {
      if (document.hidden || Date.now() - lastRefresh.current < REFRESH_MIN_MS) return;
      lastRefresh.current = Date.now();
      router.refresh();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [router]);

  const products = useMemo(() => new Map(data.sections.flatMap((section) => section.products).map((product) => [product.id, product])), [data.sections]);
  const sections = useMemo(() => filterSections(data.sections, query), [data.sections, query]);
  const summary = summarizeOrder("", data.lines);
  const total = orderCents(data.lines);

  const header = (
    <>
      <Link href={`/sala/${slug}/mesas`} className="text-base font-medium underline underline-offset-2">
        ← Mesas
      </Link>
      <h1 className="mt-3 font-display text-4xl leading-tight break-words" data-testid="anotar-mesa">
        {data.table.label}
      </h1>
      {data.multiBranch ? <p className="mt-1 text-base text-muted">Sucursal {data.table.branchName}</p> : null}
    </>
  );

  if (!data.enabled) {
    return (
      <>
        {header}
        <section aria-labelledby="anotar-aviso" data-testid="anotar-deshabilitada" className="panel-cell mt-6 max-w-prose">
          <h2 id="anotar-aviso" className="font-display text-2xl">
            Los pedidos no están disponibles
          </h2>
          <p className="mt-2 text-lg leading-relaxed text-muted">
            {isOwner
              ? "Están incluidos desde el plan Pro y con la cuenta al día. Mientras tanto no se pueden anotar platos."
              : "Por ahora no están disponibles. Avisale al dueño."}
          </p>
        </section>
      </>
    );
  }

  return (
    <>
      {header}

      <section aria-labelledby="pedido-titulo" className="mt-5" data-testid="pedido-mesa">
        <h2 id="pedido-titulo" className="font-display text-2xl">
          Pedido de la mesa
        </h2>
        {data.lines.length === 0 ? (
          <p className="mt-2 text-lg text-muted" data-testid="sin-lineas">
            Todavía no hay nada anotado. Elegí un plato de abajo.
          </p>
        ) : (
          <>
            <p className="mt-1 text-base text-muted" data-testid="pedido-resumen">
              {summary ? orderStatusText(summary) : "Sin platos vigentes"}
            </p>
            <ul className="mt-3 divide-y divide-ink/10 rounded-3xl border border-ink/15 bg-white" data-testid="lineas">
              {data.lines.map((line) => {
                const cancelled = line.status === "cancelled";
                return (
                  <li key={line.id} data-testid="linea" data-estado={line.status} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className={`text-lg font-medium break-words ${cancelled ? "text-muted line-through" : ""}`}>
                        {line.quantity} × {line.productName}
                      </p>
                      {line.options.length > 0 ? (
                        <p className="text-base text-muted break-words">{line.options.map((option) => option.name).join(", ")}</p>
                      ) : null}
                      {line.note ? <p className="text-base break-words">«{line.note}»</p> : null}
                      <p className="text-sm text-muted">{LINE_STATUS_TEXT[line.status]}</p>
                    </div>
                    <p className={`shrink-0 text-lg ${cancelled ? "text-muted line-through" : ""}`}>{formatArs(lineCents(line))}</p>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 flex items-baseline justify-between text-lg" data-testid="pedido-total" data-centavos={total}>
              <span>Total hasta ahora</span>
              <strong className="font-display text-3xl leading-none">{formatArs(total)}</strong>
            </p>
          </>
        )}
      </section>

      <section aria-labelledby="carta-titulo" className="mt-8">
        <h2 id="carta-titulo" className="font-display text-2xl">
          Anotar un plato
        </h2>
        <p role="status" data-testid="anotado" className={notice ? "mt-3 rounded-2xl bg-brand/10 px-4 py-3 text-base text-ink" : "sr-only"}>
          {notice}
        </p>
        <label className="mt-3 block text-base font-medium" htmlFor="buscar-plato">
          Buscar plato
        </label>
        <input
          id="buscar-plato"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
          placeholder="Por nombre o categoría"
          className={`${fieldClass} mt-1`}
        />

        {data.sections.length === 0 ? (
          <p className="panel-cell mt-4 text-lg text-muted" data-testid="carta-vacia">
            La carta de esta sucursal no tiene platos para anotar.
          </p>
        ) : sections.length === 0 ? (
          <p className="mt-4 text-lg text-muted" data-testid="sin-resultados">
            Ningún plato coincide con «{query.trim()}».
          </p>
        ) : (
          <div className="mt-4 space-y-6" data-testid="carta">
            {sections.map((section) => (
              <section key={section.categoryId} aria-label={section.name}>
                <h3 className="text-xl font-semibold break-words">{section.name}</h3>
                <ul className="mt-2 divide-y divide-ink/10 rounded-3xl border border-ink/15 bg-white">
                  {section.products.map((product) => (
                    <li key={product.id}>
                      <button
                        type="button"
                        data-testid="plato"
                        data-plato={product.name}
                        disabled={product.block !== null}
                        onClick={() => {
                          setNotice(null);
                          setOpen(product.id);
                        }}
                        className="flex min-h-14 w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        <span className="min-w-0">
                          <span className="block text-lg font-medium break-words">{product.name}</span>
                          {product.block === "unavailable" ? <span className="block text-sm font-semibold text-suspended-ink">Agotado en esta sucursal</span> : null}
                          {product.block === "options_unfulfillable" ? (
                            <span className="block text-sm font-semibold text-suspended-ink">No se puede anotar: sus opciones obligatorias no tienen suficientes elecciones</span>
                          ) : null}
                          {product.groups.length > 0 && product.block === null ? <span className="block text-sm text-muted">Con opciones</span> : null}
                        </span>
                        <span className="shrink-0 text-right text-lg">
                          {product.listCents !== null ? <span className="block text-sm text-muted line-through">{formatArs(product.listCents)}</span> : null}
                          {formatArs(product.priceCents)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </section>

      {open !== null ? (
        <DishSheet
          key={open}
          slug={slug}
          tableId={data.table.id}
          product={products.get(open) ?? null}
          onClose={() => setOpen(null)}
          onStale={() => router.refresh()}
          onAdded={(text) => {
            setOpen(null);
            setNotice(text);
          }}
        />
      ) : null}
    </>
  );
}

/** El panel de un plato: cantidad, opciones y observación. Un panel nuevo por plato (`key`), con su propia clave de reintento. */
function DishSheet({
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
  const dialog = useRef<HTMLDialogElement>(null);
  const [quantity, setQuantity] = useState(1);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<AddFailure | null>(null);
  const [key] = useState(newKey);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

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

  return (
    <dialog
      ref={dialog}
      aria-labelledby="hoja-titulo"
      data-testid="hoja-anotar"
      onClose={onClose}
      onCancel={(event) => {
        // No se cierra a mitad de un envío: se perdería la respuesta de si se anotó.
        if (busy) event.preventDefault();
      }}
      className="m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-3xl border-0 bg-white p-0 text-ink backdrop:bg-ink/50 sm:m-auto sm:max-w-lg sm:rounded-3xl"
    >
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <h2 id="hoja-titulo" className="font-display text-3xl leading-tight break-words">
            {product ? product.name : "Plato no disponible"}
          </h2>
          <button type="button" onClick={onClose} disabled={busy} className={buttonClass} aria-label="Cerrar sin anotar">
            Cerrar
          </button>
        </div>

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
                        <input
                          type="radio"
                          name={group.id}
                          checked={chosen === 0}
                          disabled={busy}
                          onChange={() => pick(group, "", false)}
                          className="size-5"
                        />
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
      </div>

      {product ? (
        <div className="sticky bottom-0 border-t border-ink/10 bg-white px-5 py-4">
          {failure ? (
            <p role="alert" data-testid="anotar-error" className="mb-3 rounded-2xl bg-suspended-bg px-4 py-3 text-base text-suspended-ink ring-1 ring-inset ring-suspended-edge">
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
        </div>
      ) : null}
    </dialog>
  );
}

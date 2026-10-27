"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatArs } from "@/lib/money";
import type { AnotarData } from "@/lib/sala/anotar";
import { orderCents, orderStatusText, summarizeOrder } from "@/lib/sala/mesas";
import { undeliveredUnits } from "@/lib/sala/operar";
import { CartaSheet } from "./carta-sheet";
import { CloseSheet } from "./close-sheet";
import { DishSheet } from "./dish-sheet";
import { LineCard } from "./line-card";
import { ResetSheet } from "./reset-sheet";
import { buttonClass, dangerPrimaryClass, primaryClass } from "./ui";

/** Al volver a la pestaña se recarga el pedido y la carta; no más seguido que esto. */
const REFRESH_MIN_MS = 3_000;

/**
 * La mesa del mozo: arriba el pedido con lo que se puede hacer con cada línea; abajo una barra fija con el total, «Anotar plato» (abre la
 * carta en una hoja). El cierre se abre desde Mesas. El servidor es la fuente y cada acción recarga la pantalla.
 */
export function AnotarScreen({ slug, data, isOwner, openClose = false }: { slug: string; data: AnotarData; isOwner: boolean; openClose?: boolean }) {
  const router = useRouter();
  const [cartaOpen, setCartaOpen] = useState(false);
  const [dish, setDish] = useState<string | null>(null);
  const [closeOpen, setCloseOpen] = useState(openClose);
  const [resetOpen, setResetOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const lastRefresh = useRef(0);

  const refresh = () => {
    lastRefresh.current = Date.now();
    router.refresh();
  };

  // Al volver a la pestaña o recuperar la red se pide el estado de nuevo (otra persona pudo anotar o cambiar algo).
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
  const summary = summarizeOrder("", data.lines);
  const total = orderCents(data.lines);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/sala/${slug}/mesas`}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-brand px-5 py-3 text-base font-semibold text-white hover:bg-brand-deep"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 shrink-0">
            <path d="m12 19-7-7 7-7M5 12h14" />
          </svg>
          Volver a mesas
        </Link>
      </div>
      <h1 className="mt-3 font-display text-4xl leading-tight break-words" data-testid="anotar-mesa">
        {data.table.label}
      </h1>
      {data.multiBranch ? <p className="mt-1 text-base text-muted">Sucursal {data.table.branchName}</p> : null}
      <button type="button" data-testid="abrir-reinicio" onClick={() => setResetOpen(true)} className={`${buttonClass} mt-3`}>
        Reiniciar QR de la mesa
      </button>

      {!data.enabled ? (
        <section aria-labelledby="anotar-aviso" data-testid="anotar-deshabilitada" className="panel-cell mt-6 max-w-prose">
          <h2 id="anotar-aviso" className="font-display text-2xl">
            Los pedidos no están disponibles
          </h2>
          <p className="mt-2 text-lg leading-relaxed text-muted">
            {isOwner
              ? "Están incluidos desde el plan Pro y con la cuenta al día. Mientras tanto no se pueden anotar platos ni cambiar el pedido."
              : "Por ahora no están disponibles. Avisale al dueño."}
            {data.orderId ? " Sí podés cerrar o anular el pedido que ya estaba abierto." : ""}
          </p>
        </section>
      ) : null}

      {data.enabled || data.orderId ? (
        <section aria-labelledby="pedido-titulo" className="mt-5" data-testid="pedido-mesa">
          <h2 id="pedido-titulo" className="font-display text-2xl">
            Pedido de la mesa
          </h2>
          {data.lines.length === 0 ? (
            <p className="mt-2 text-lg text-muted" data-testid="sin-lineas">
              {data.orderId ? "El pedido está abierto pero no tiene platos vigentes." : "Todavía no hay nada anotado. Tocá «Anotar plato»."}
            </p>
          ) : (
            <>
              <p className="mt-1 text-base text-muted" data-testid="pedido-resumen">
                {summary ? orderStatusText(summary) : "Sin platos vigentes"}
              </p>
              <ul className="mt-3 divide-y divide-ink/10 rounded-3xl border border-ink/15 bg-white" data-testid="lineas">
                {data.lines.map((line) => (
                  <LineCard key={line.id} slug={slug} line={line} canOperate={data.enabled} onStale={refresh} />
                ))}
              </ul>
              {data.orderId ? (
                <Link href={`/sala/${slug}/cuenta/${data.orderId}`} data-testid="ver-precuenta" className={`${buttonClass} mt-3`}>
                  Ver precuenta
                </Link>
              ) : null}
            </>
          )}
          {data.orderId && (!data.enabled || !summary) ? (
            <button type="button" data-testid="abrir-cierre" onClick={() => setCloseOpen(true)} className={`${dangerPrimaryClass} mt-3`}>
              Cerrar o anular pedido…
            </button>
          ) : null}
        </section>
      ) : null}

      {data.enabled || data.orderId ? (
        <div
          data-testid="barra"
          className="sticky bottom-0 z-10 -mx-4 mt-6 border-t border-ink/15 bg-porcelain px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:-mx-8 sm:px-8"
        >
          <p className="flex items-baseline justify-between gap-3 text-lg" data-testid="pedido-total" data-centavos={total}>
            <span>Total hasta ahora</span>
            <strong className="font-display text-3xl leading-none">{formatArs(total)}</strong>
          </p>
          <div className="mt-3 flex gap-3">
            {data.enabled ? (
              <button
                type="button"
                data-testid="abrir-carta"
                onClick={() => {
                  setNotice(null);
                  setCartaOpen(true);
                }}
                className={`${primaryClass} min-w-0 flex-1`}
              >
                Anotar plato
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {cartaOpen ? (
        <CartaSheet
          sections={data.sections}
          notice={notice}
          onPick={(id) => {
            setNotice(null);
            setDish(id);
          }}
          onClose={() => setCartaOpen(false)}
        />
      ) : null}

      {dish !== null ? (
        <DishSheet
          key={dish}
          slug={slug}
          tableId={data.table.id}
          product={products.get(dish) ?? null}
          onClose={() => setDish(null)}
          onStale={refresh}
          onAdded={(text) => {
            setDish(null);
            setNotice(text);
          }}
        />
      ) : null}

      {closeOpen && data.orderId ? (
        <CloseSheet
          slug={slug}
          orderId={data.orderId}
          summary={{ dishes: summary?.dishes ?? 0, totalCents: total, undelivered: undeliveredUnits(data.lines) }}
          onClose={() => { setCloseOpen(false); if (openClose) router.replace(`/sala/${slug}/mesas`); }}
          onStale={refresh}
          onDone={() => router.push(`/sala/${slug}/mesas`)}
        />
      ) : null}

      {resetOpen ? <ResetSheet slug={slug} tableId={data.table.id} label={data.table.label} onClose={() => setResetOpen(false)} /> : null}
    </>
  );
}

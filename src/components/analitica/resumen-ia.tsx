"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { generateSummaryAction } from "@/app/panel/[org]/analitica/actions";
import { secondaryButtonClass } from "@/components/panel/styles";
import type { Summary } from "@/lib/analitica/resumen";

/**
 * «Resumen con IA» de la analítica (ficha resumen-de-analitica-con-ia, ADR 0047): el último resumen guardado del período y el
 * botón para generarlo o actualizarlo. Todo se muestra como texto plano. Aclara que lo escribió una IA, qué se le envió y que los
 * números exactos están en las secciones de abajo.
 */

export type ResumenIaProps = {
  orgSlug: string;
  days: number;
  /** Slug de la sucursal elegida; vacío = todas. */
  branch: string;
  stored: { summary: Summary; providerLabel: string; generatedAtLabel: string } | null;
  /** Hay un servicio de IA configurado en el servidor. */
  available: boolean;
  /** Hay pedidos suficientes para resumir. */
  enoughOrders: boolean;
  minOrders: number;
};

function GenerateButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={secondaryButtonClass} data-testid="resumen-ia-generar">
      {pending ? "Pensando…" : label}
    </button>
  );
}

export function ResumenIa({ orgSlug, days, branch, stored, available, enoughOrders, minOrders }: ResumenIaProps) {
  const [state, formAction] = useActionState(generateSummaryAction, {});
  if (!available && !stored) return null;

  return (
    <section aria-labelledby="resumen-ia-titulo" className="mt-10" data-testid="resumen-ia">
      <h2 id="resumen-ia-titulo" className="font-display text-3xl leading-tight">
        Resumen con IA
      </h2>

      {stored ? (
        <div className="panel-cell mt-3" data-testid="resumen-ia-contenido">
          <p className="max-w-prose text-lg" data-testid="resumen-ia-texto">
            {stored.summary.summary}
          </p>
          {stored.summary.highlights.length > 0 ? (
            <ul className="mt-4 grid max-w-prose gap-3" data-testid="resumen-ia-hallazgos">
              {stored.summary.highlights.map((item, index) => (
                <li key={index}>
                  <p className="font-medium">{item.title}</p>
                  <p className="text-base">{item.detail}</p>
                </li>
              ))}
            </ul>
          ) : null}
          {stored.summary.actions.length > 0 ? (
            <>
              <h3 className="mt-5 text-lg font-medium">Qué podés probar</h3>
              <ul className="mt-2 grid max-w-prose gap-3" data-testid="resumen-ia-acciones">
                {stored.summary.actions.map((item, index) => (
                  <li key={index}>
                    <p className="font-medium">{item.action}</p>
                    <p className="text-base">{item.reason}</p>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <p className="mt-4 text-sm text-muted" data-testid="resumen-ia-pie">
            Generado por IA ({stored.providerLabel}) el {stored.generatedAtLabel}, con las cifras de este período. Puede equivocarse: los números
            exactos están en las secciones de abajo.
          </p>
        </div>
      ) : (
        <p className="mt-3 max-w-prose text-base text-muted" data-testid="resumen-ia-vacio">
          {enoughOrders
            ? "Todavía no generaste un resumen de este período."
            : `Todavía hay pocos pedidos en este período para resumir (hacen falta al menos ${minOrders}).`}
        </p>
      )}

      {available && (enoughOrders || stored) ? (
        <form action={formAction} className="mt-4 grid gap-2">
          <input type="hidden" name="org" value={orgSlug} />
          <input type="hidden" name="dias" value={days} />
          <input type="hidden" name="sucursal" value={branch} />
          <div>
            <GenerateButton label={stored ? "Actualizar resumen" : "Generar resumen"} />
          </div>
          <p className="max-w-prose text-sm text-muted">
            Para armarlo se envían a un servicio de IA las cifras de este período (ventas, franjas, categorías y nombres de platos). No se envían
            motivos de anulación ni datos de comensales.
          </p>
          {state.error ? (
            <p role="alert" className="max-w-prose text-base font-medium text-danger" data-testid="resumen-ia-error">
              {state.error}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}

"use client";

import { useState } from "react";
import { whatsappUrl } from "@/lib/marketing/contacto";
import { PLANES, precioArs, SUCURSAL_ADICIONAL_ARS, type PlanVendido } from "@/lib/marketing/planes";
import { IconCheck } from "./icons";

const basico = PLANES[0];
const pro = PLANES[1];

const INCLUYE: Record<PlanVendido["code"], string[]> = {
  basic: [
    "Carta digital con un QR por cada mesa",
    "Tu logo, 12 paletas y 5 estilos de carta",
    `${basico.maxSucursales} sucursal`,
    `Hasta ${basico.maxMesasPorSucursal} mesas`,
    `Hasta ${basico.maxPlatosActivos} platos activos`,
  ],
  pro: [
    "Todo lo del plan Básico",
    "Llamar al mozo, pedir la cuenta y Mesas en vivo",
    "Pedidos que anota el mozo y pantalla de cocina",
    "Promociones y Happy Hour programados",
    "Analítica con resumen de IA",
    "Videos cortos en tu carta, con me gusta y comentarios (hasta 10 publicados)",
    `Hasta ${pro.maxSucursales} sucursales (y hasta 3 adicionales)`,
    `Hasta ${pro.maxMesasPorSucursal} mesas por sucursal`,
    `Hasta ${pro.maxPlatosActivos} platos activos`,
  ],
};

function Plan({ plan, destacado, anual }: { plan: PlanVendido; destacado?: boolean; anual: boolean }) {
  return (
    <article className={`mk-plan ${destacado ? "mk-plan-pro" : ""}`}>
      <h3>{plan.nombre}</h3>
      <div>
        <p className="mk-precio">
          <strong>{anual ? (plan.anualArs === null ? "Consultar" : `ARS ${plan.anualArs.toLocaleString("es-AR")}`) : precioArs(plan)}</strong>
          <span>{anual ? "por año" : "por mes"}</span>
        </p>
        <p className="mk-nota">{anual ? (plan.anualArs === null ? "Precio anual a confirmar." : `Equivale a ARS ${(plan.anualArs / 12).toLocaleString("es-AR")} por mes.`) : "Pagás mes a mes."}</p>
      </div>
      <ul className="mk-plan-list">
        {INCLUYE[plan.code].map((i) => (
          <li key={i}>
            <IconCheck />
            {i}
          </li>
        ))}
      </ul>
      {destacado ? (
        <a className="mk-btn" href={whatsappUrl()} target="_blank" rel="noopener noreferrer">
          Probalo 14 días gratis<span className="sr-only"> (se abre WhatsApp)</span>
        </a>
      ) : (
        <a className="mk-btn mk-btn-ghost" href={whatsappUrl("Hola, quiero consultar por el plan Básico de UcoMenu.")} target="_blank" rel="noopener noreferrer">
          Consultar por Básico<span className="sr-only"> (se abre WhatsApp)</span>
        </a>
      )}
    </article>
  );
}

export function Precios() {
  const [anual, setAnual] = useState(false);
  return (
    <section className="mk-section" id="precios" aria-labelledby="precios-titulo">
      <div className="mk-wrap">
        <div className="mk-head" style={{ marginBottom: "2rem" }}>
          <h2 className="mk-h2 mk-center" id="precios-titulo">
            Un precio fijo por mes
          </h2>
          <p className="mk-lead mk-center">Probás 14 días con el plan Pro, sin tarjeta de crédito. Después elegís el plan que te sirve.</p>
        </div>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <div className="mk-periodo" role="group" aria-label="Período de pago">
            <button type="button" aria-pressed={!anual} onClick={() => setAnual(false)}>Mensual</button>
            <button type="button" aria-pressed={anual} onClick={() => setAnual(true)}>Anual</button>
          </div>
        </div>
        <div className="mk-planes">
          <Plan plan={basico} anual={anual} />
          <Plan plan={pro} anual={anual} destacado />
        </div>
        <p className="mk-letra-chica">
          Precios en pesos argentinos; se abonan por transferencia o link de pago. En el plan Pro, cada sucursal adicional cuesta ARS{" "}
          {SUCURSAL_ADICIONAL_ARS.toLocaleString("es-AR")} por mes.
        </p>
      </div>
    </section>
  );
}

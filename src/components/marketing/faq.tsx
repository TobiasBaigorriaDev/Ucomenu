import Link from "next/link";
import type { ReactNode } from "react";
import { PLANES, SUCURSAL_ADICIONAL_ARS } from "@/lib/marketing/planes";
import { IconPlus } from "./icons";

const [basico, pro] = PLANES;

const PREGUNTAS: { q: string; a: ReactNode }[] = [
  {
    q: "¿Mis clientes tienen que instalar algo?",
    a: "No. Escanean el QR de la mesa con la cámara del celular y la carta se abre en el navegador. Sin app y sin registrarse.",
  },
  {
    q: "¿Mis clientes pueden pedir y pagar desde la carta?",
    a: "No: la carta es solo de consulta. Con el plan Pro, el mozo anota el pedido en su pantalla y la cocina lo ve; el cliente llama al mozo o pide la cuenta con un toque.",
  },
  {
    q: "¿Puedo cambiar precios y platos yo?",
    a: "Sí, desde el panel, en el celular o en la compu. Un cambio se ve en todos tus QR, sin reimprimir nada.",
  },
  {
    q: "¿Y los alérgenos?",
    a: (
      <>
        Cada plato puede llevar las etiquetas Sin TACC, Vegano o Vegetariano, según lo que declare tu local. No es una certificación ni reemplaza consultar al personal. Más en{" "}
        <Link href="/alergenos">el texto sobre alérgenos</Link>.
      </>
    ),
  },
  {
    q: "¿Cuántas sucursales y mesas puedo tener?",
    a: `Básico: ${basico.maxSucursales} sucursal y hasta ${basico.maxMesasPorSucursal} mesas. Pro: hasta ${pro.maxSucursales} sucursales (más hasta 3 adicionales, ARS ${SUCURSAL_ADICIONAL_ARS.toLocaleString("es-AR")} por mes cada una) y hasta ${pro.maxMesasPorSucursal} mesas por sucursal.`,
  },
  {
    q: "¿Cómo empiezo?",
    a: "Nos escribís por WhatsApp, damos de alta tu local con el plan Pro por 14 días y empezás a cargar tu carta. No pedimos tarjeta de crédito.",
  },
  {
    q: "¿Qué pasa cuando terminan los 14 días?",
    a: "Elegís Básico o Pro y acordamos el pago por transferencia o link de pago. Si elegís un plan menor no perdés nada: tu carta y tus datos se conservan.",
  },
  {
    q: "¿Tengo que comprar algo?",
    a: "No. Alcanza con el celular de cada cliente y un celular o una tablet para que el mozo vea los llamados. Los QR los imprimís vos.",
  },
];

export function Faq() {
  return (
    <section className="mk-section" id="preguntas" aria-labelledby="preguntas-titulo">
      <div className="mk-wrap">
        <div className="mk-head">
          <h2 className="mk-h2 mk-center" id="preguntas-titulo">
            Preguntas frecuentes
          </h2>
        </div>
        <div className="mk-faq">
          {PREGUNTAS.map(({ q, a }) => (
            <details key={q}>
              <summary>
                {q}
                <IconPlus />
              </summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

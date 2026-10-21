"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";

const linkClass = "inline-flex min-h-11 items-center text-base text-cobalt underline underline-offset-2";

const sinCambios = () => () => {};

/**
 * ¿Hay una página anterior de esta misma aplicación a la que volver? La API de navegación solo lista entradas del mismo origen:
 * `canGoBack` es verdadero únicamente si la persona venía de otra pantalla de UcoMenu (la carta, el login…). Sin esa API se usa el
 * largo del historial (una pestaña nueva abierta directo en el texto legal tiene una sola entrada). No se guarda nada en el
 * navegador ni se manda nada al servidor: la carta promete no dejar datos locales, y la dirección de una carta abierta con un QR
 * lleva su token, que no debe viajar en un parámetro ni en un registro.
 */
function hayDondeVolver(): boolean {
  const navegacion = (window as unknown as { navigation?: { canGoBack?: boolean } }).navigation;
  if (typeof navegacion?.canGoBack === "boolean") return navegacion.canGoBack;
  return window.history.length > 1;
}

/**
 * «Volver» a la página anterior (la carta de la que venía la persona) o, si entró directo al texto legal, un enlace a la portada.
 * Primero se dibuja el enlace a la portada (sirve sin JavaScript); ya en el navegador, si hay a dónde volver, pasa a ser «Volver».
 * `router.back()` solo recorre el historial del propio navegador: no hay destinos que alguien pueda pasar por la dirección.
 */
export function LegalBack({ className = "" }: { className?: string }) {
  const router = useRouter();
  const puedeVolver = useSyncExternalStore(sinCambios, hayDondeVolver, () => false);

  return (
    <div className={className}>
      {puedeVolver ? (
        <button type="button" onClick={() => router.back()} className={linkClass}>
          <span aria-hidden="true">←&nbsp;</span>Volver
        </button>
      ) : (
        <Link href="/" className={linkClass}>
          Ir a la portada
        </Link>
      )}
    </div>
  );
}

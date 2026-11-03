"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

type TurnstileApi = {
  render: (element: HTMLElement, options: { sitekey: string; language: string; size: "flexible" }) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/**
 * Comprobación de Cloudflare Turnstile: agrega al formulario el campo `cf-turnstile-response`. Sin `siteKey` no muestra nada. Cada token
 * sirve una vez: `resetKey` lo renueva cuando vuelve una respuesta del servidor.
 */
export function TurnstileWidget({ siteKey, resetKey }: { siteKey: string | null; resetKey: unknown }) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!siteKey || !loaded || !container.current || !window.turnstile) return;
    const api = window.turnstile;
    const id = api.render(container.current, { sitekey: siteKey, language: "es", size: "flexible" });
    widget.current = id;
    return () => {
      widget.current = null;
      api.remove(id);
    };
  }, [siteKey, loaded]);

  useEffect(() => {
    if (widget.current && window.turnstile) window.turnstile.reset(widget.current);
  }, [resetKey]);

  if (!siteKey) return null;
  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={() => setLoaded(true)} />
      <div ref={container} data-testid="turnstile" className="min-h-[65px]" />
    </>
  );
}

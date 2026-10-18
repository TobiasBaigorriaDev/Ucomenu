"use client";

import { activateSound, rememberedAlerts, silenceSound, useSoundState } from "./sonido-llamados";
import { useEffect, useState } from "react";

const buttonClass =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-ink/50 px-4 py-2 text-base font-medium text-ink hover:bg-ink/5 disabled:opacity-60";
const primaryClass =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-cobalt px-5 py-2 text-base font-medium text-white hover:bg-brand-deep disabled:opacity-60";

/**
 * Sonido de los llamados mientras se usa el panel (ficha aviso-push-desde-el-panel). Es el mismo sonido de la sala en vivo:
 * activarlo en una pantalla lo deja activo en la otra mientras no se recargue la página.
 */
export function SonidoControl() {
  const sound = useSoundState();
  const [had, setHad] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setHad(rememberedAlerts()), 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="panel-cell mb-4 flex flex-wrap items-center gap-3 !py-4" data-testid="sonido-llamados">
      {sound === "on" ? (
        <>
          <p className="text-base font-medium" data-testid="sonido-activo">
            Sonido de llamados activado mientras usás el panel
          </p>
          <button type="button" onClick={silenceSound} className={buttonClass}>
            Silenciar sonido
          </button>
        </>
      ) : (
        <>
          <button type="button" onClick={() => void activateSound()} className={primaryClass}>
            Activar sonido de llamados
          </button>
          <p className="max-w-prose text-sm text-muted">
            {sound === "blocked"
              ? "Tu navegador no dejó activar el sonido: vas a ver el cartel de arriba."
              : had
                ? "Vas a volver a tenerlo con tu próximo toque en esta pantalla, o tocá para activarlo ahora."
                : "Suena un pitido cuando una mesa llama, mientras tengas el panel abierto."}
          </p>
        </>
      )}
    </div>
  );
}

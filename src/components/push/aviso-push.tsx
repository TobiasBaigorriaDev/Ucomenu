"use client";

import { usePush } from "./use-push";

/**
 * Bloque «avisarme aunque cierre…» (Web Push; ADR 0020). Lo usan la sala en vivo y el Resumen del panel: el estado es por
 * dispositivo y local, así que activarlo en una pantalla lo deja activado en la otra. Sin clave VAPID en el servidor no
 * se muestra nada.
 */
const buttonClass =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-ink/50 px-4 py-2 text-base font-medium text-ink hover:bg-ink/5 disabled:opacity-60";
const primaryClass =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-cobalt px-5 py-2 text-base font-medium text-white hover:bg-brand-deep disabled:opacity-60";

const COPY = {
  sala: {
    enable: "Avisarme aunque cierre la sala",
    active: "Avisos activados en este dispositivo, aunque cierres la sala",
    help: "Recibí una notificación del sistema cuando alguien llame, aunque cierres la pestaña. En la computadora, Chrome o Edge tienen que seguir abiertos en segundo plano.",
    unsupported: "Este navegador no puede mostrar avisos con la sala cerrada. Probá con Chrome o Edge.",
  },
  panel: {
    enable: "Avisarme cuando llamen a una mesa",
    active: "Avisos de llamados activados en este dispositivo, aunque estés en otra pantalla o cierres el panel",
    help: "Recibí una notificación del sistema cuando alguien llame al mozo o pida la cuenta, estés donde estés. En la computadora, Chrome o Edge tienen que seguir abiertos en segundo plano.",
    unsupported: "Este navegador no puede mostrar avisos de llamados. Probá con Chrome o Edge.",
  },
} as const;

export function AvisoPush({ slug, publicKey, where }: { slug: string; publicKey: string | null; where: "sala" | "panel" }) {
  const push = usePush(slug, publicKey);
  const copy = COPY[where];
  if (!publicKey || push.state === "checking") return null;

  return (
    <div className="panel-cell mb-4 flex flex-wrap items-center gap-3 !py-4" data-testid="aviso-push">
      {push.state === "on" ? (
        <>
          <p className="text-base font-medium" data-testid="push-activo">
            {copy.active}
          </p>
          <button type="button" onClick={push.disable} className={buttonClass}>
            Desactivar avisos
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={push.enable}
            disabled={push.state === "working" || push.state === "unsupported" || push.state === "denied"}
            className={primaryClass}
          >
            {push.state === "working" ? "Un momento…" : copy.enable}
          </button>
          <p className="max-w-prose text-sm text-muted" data-testid="push-ayuda">
            {push.state === "unsupported"
              ? copy.unsupported
              : push.state === "denied"
                ? "Bloqueaste las notificaciones de este sitio. Habilitalas desde el candado de la barra de direcciones y volvé a intentar."
                : copy.help}
          </p>
        </>
      )}
      {push.message ? (
        <p role="alert" className="w-full text-base font-medium text-danger" data-testid="push-error">
          {push.message}
        </p>
      ) : null}
    </div>
  );
}

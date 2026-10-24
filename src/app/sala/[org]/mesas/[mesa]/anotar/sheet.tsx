"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { buttonClass } from "./ui";

/**
 * Una hoja modal (`<dialog>` nativo: foco atrapado, Esc, fondo inerte): hoja inferior en el teléfono y centrada en pantallas grandes.
 * Quien la monta decide cuándo existe; al desmontarse devuelve el foco a lo que la abrió. Con `busy` no se puede cerrar (se perdería la
 * respuesta de lo que se está enviando). Se pueden apilar: la última en abrirse queda arriba.
 */
export function Sheet({
  title,
  testId,
  busy = false,
  onClose,
  closeLabel = "Volver",
  footer,
  children,
}: {
  title: string;
  testId: string;
  busy?: boolean;
  onClose: () => void;
  closeLabel?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (element && !element.open) element.showModal();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      data-testid={testId}
      onClose={onClose}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      className="m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-3xl border-0 bg-white p-0 text-ink backdrop:bg-ink/50 sm:m-auto sm:max-w-lg sm:rounded-3xl"
    >
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="font-display text-3xl leading-tight break-words">
            {title}
          </h2>
          <button type="button" onClick={onClose} disabled={busy} className={buttonClass} aria-label={closeLabel}>
            Volver
          </button>
        </div>
        {children}
      </div>
      {footer ? <div className="sticky bottom-0 border-t border-ink/10 bg-white px-5 py-4">{footer}</div> : null}
    </dialog>
  );
}

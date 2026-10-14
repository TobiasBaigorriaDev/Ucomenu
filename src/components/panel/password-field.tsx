"use client";

import { useId, useState } from "react";
import { inputClass, labelClass, secondaryButtonClass } from "./action-form";

/**
 * Campo de contraseña con «Mostrar». Quien define una contraseña temporal necesita verla para
 * pasársela a la persona; por defecto queda oculta.
 */
export function PasswordField({
  name,
  label,
  autoComplete,
  hint,
}: {
  name: string;
  label: string;
  autoComplete: "new-password" | "current-password";
  hint?: string;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          required
          minLength={autoComplete === "new-password" ? 10 : undefined}
          autoComplete={autoComplete}
          spellCheck={false}
          autoCapitalize="none"
          aria-describedby={hint ? `${id}-hint` : undefined}
          className={inputClass}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          className={`${secondaryButtonClass} shrink-0`}
        >
          {visible ? "Ocultar" : "Mostrar"}
        </button>
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="mt-1 text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

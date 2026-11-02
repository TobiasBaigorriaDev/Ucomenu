"use client";

import Link from "next/link";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { inputClass, labelClass } from "@/components/panel/styles";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/validation";
import { FIRST_BRANCH } from "@/lib/registro/registro";
import { slugFromName } from "@/lib/slug";
import { createOwnLocalAction } from "./actions";

export function CreateLocalForm({ choosePassword }: { choosePassword: boolean }) {
  return (
    <ActionForm action={createOwnLocalAction} className="grid gap-5">
      <Fields choosePassword={choosePassword} />
    </ActionForm>
  );
}

function Fields({ choosePassword }: { choosePassword: boolean }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  // La dirección sigue al nombre hasta que la persona la escribe.
  const [slugEdited, setSlugEdited] = useState(false);

  return (
    <>
      <div>
        <label htmlFor="local-nombre" className={labelClass}>
          Nombre del local
        </label>
        <input
          id="local-nombre"
          name="name"
          required
          maxLength={80}
          autoComplete="organization"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (!slugEdited) setSlug(slugFromName(event.target.value));
          }}
          className={`${inputClass} mt-1`}
        />
      </div>
      <div>
        <label htmlFor="local-direccion" className={labelClass}>
          Dirección de tu carta
        </label>
        <input
          id="local-direccion"
          name="slug"
          required
          maxLength={64}
          autoCapitalize="none"
          spellCheck={false}
          value={slug}
          onChange={(event) => {
            setSlug(event.target.value);
            setSlugEdited(true);
          }}
          aria-describedby="local-direccion-ayuda"
          className={`${inputClass} mt-1`}
        />
        <p id="local-direccion-ayuda" className="mt-1 text-sm break-all text-muted">
          ucomenu.com/m/{slug || "tu-local"}/{FIRST_BRANCH.slug}
        </p>
      </div>
      {choosePassword ? (
        <div>
          <label htmlFor="local-clave" className={labelClass}>
            Elegí una contraseña
          </label>
          <input id="local-clave" name="password" type="password" required minLength={PASSWORD_MIN_LENGTH} autoComplete="new-password" aria-describedby="local-clave-ayuda" className={`${inputClass} mt-1`} />
          <p id="local-clave-ayuda" className="mt-1 text-sm text-muted">
            Al menos {PASSWORD_MIN_LENGTH} caracteres. Con ella vas a ingresar la próxima vez.
          </p>
        </div>
      ) : null}
      <label className="flex items-start gap-3 text-base">
        <input type="checkbox" name="terms" required className="mt-1 size-5 shrink-0" />
        <span>
          Acepto los{" "}
          <Link href="/terminos" target="_blank" className="text-cobalt underline underline-offset-2">
            términos
          </Link>{" "}
          y la{" "}
          <Link href="/privacidad" target="_blank" className="text-cobalt underline underline-offset-2">
            política de privacidad
          </Link>
          .
        </span>
      </label>
      <div>
        <SubmitButton pendingLabel="Creando tu local…">Crear mi local</SubmitButton>
      </div>
    </>
  );
}

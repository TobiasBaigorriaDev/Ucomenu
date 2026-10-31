"use client";

import Image from "next/image";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/panel/action-form";
import { dangerButtonClass, labelClass } from "@/components/panel/styles";
import { MAX_IMAGE_BYTES } from "@/lib/carta/images";
import type { FormState } from "@/lib/form-state";
import { removePhotoAction, uploadPhotoAction } from "./actions";

/** Lado mayor de la foto que se sube. Alcanza de sobra para una carta en el celular. */
const MAX_SIDE = 1600;
/** Por debajo de esto (y de MAX_SIDE) la foto se sube tal cual. */
const KEEP_AS_IS_BYTES = 1.5 * 1024 * 1024;
const QUALITY = 0.85;

export const kb = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);

/**
 * Reduce la foto en el navegador (Canvas, sin dependencias): una foto de celular pesa 3 a 8 MB y el servidor
 * acepta hasta 2 MB. Respeta la orientación EXIF. Si algo falla devuelve la original (el servidor decide).
 */
export async function shrink(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= MAX_SIDE && file.size <= KEEP_AS_IS_BYTES) {
      bitmap.close();
      return file;
    }
    const scale = Math.min(1, MAX_SIDE / longest);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return file;
    }
    // Fondo blanco: un PNG con transparencia pasaría a JPEG con el fondo negro.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], "foto.jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

type Props = {
  orgSlug: string;
  productId: string;
  productName: string;
  /** URL pública de la foto actual, si hay. */
  currentUrl: string | null;
  canWrite: boolean;
};

type Pick = { note: { text: string; error: boolean }; preview: string | null; at: FormState };

export function PhotoForm({ orgSlug, productId, productName, currentUrl, canWrite }: Props) {
  const [state, formAction] = useActionState(uploadPhotoAction, {});
  // Lo que se muestra de la foto elegida vale hasta que el servidor responde: `at` es el estado de la acción
  // al elegirla, y cuando cambia (la acción terminó) el aviso «Foto lista…» y la vista previa dejan de mostrarse.
  const [picked, setPicked] = useState<Pick | null>(null);
  const [busy, setBusy] = useState(false);
  const current = picked && picked.at === state ? picked : null;

  // La vista previa es una URL `blob:` que mantiene la imagen en memoria hasta que se la revoca. Se crea una por foto elegida y
  // `previewUrl` guarda la única viva: se revoca al elegir otra foto, al descartarla, cuando deja de mostrarse (la acción
  // terminó) y al desmontar. Nunca mientras se muestra.
  const previewUrl = useRef<string | null>(null);
  const mounted = useRef(false);
  const dropPreview = useCallback(() => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      dropPreview();
    };
  }, [dropPreview]);

  // La acción terminó (`current` ya no coincide con el estado): la vista previa dejó de mostrarse y se libera.
  useEffect(() => {
    if (!current) dropPreview();
  }, [current, dropPreview]);

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const original = input.files?.[0];
    dropPreview();
    setPicked(null);
    if (!original) return;

    setBusy(true);
    const prepared = await shrink(original);
    // Si se desmontó mientras se reducía, no se crea una URL que nadie va a revocar.
    if (!mounted.current) return;
    setBusy(false);

    if (prepared.size > MAX_IMAGE_BYTES) {
      input.value = "";
      setPicked({
        note: { text: `La foto pesa ${kb(prepared.size)} y el máximo es ${kb(MAX_IMAGE_BYTES)}. Probá con otra.`, error: true },
        preview: null,
        at: state,
      });
      return;
    }
    if (prepared !== original) {
      // Reemplaza el archivo elegido por el reducido, para que el formulario envíe ese.
      const transfer = new DataTransfer();
      transfer.items.add(prepared);
      input.files = transfer.files;
    }
    dropPreview();
    previewUrl.current = URL.createObjectURL(prepared);
    setPicked({
      note: { text: `Foto lista (${kb(prepared.size)}). Tocá «Guardar foto».`, error: false },
      preview: previewUrl.current,
      at: state,
    });
  }

  return (
    <div className="mt-4 max-w-md">
      {currentUrl ? (
        <Image
          src={currentUrl}
          alt={`Foto de ${productName}`}
          width={640}
          height={480}
          unoptimized
          className="aspect-[4/3] w-full rounded-2xl border border-ink/15 object-cover"
        />
      ) : (
        <p className="rounded-2xl border border-dashed border-ink/40 px-4 py-6 text-base text-muted">Este plato todavía no tiene foto.</p>
      )}

      <form action={formAction} className="mt-4">
        {/* Mientras se reduce la foto no se puede enviar: subiría la original, que puede pesar varios MB. */}
        <fieldset disabled={!canWrite || busy} className="grid gap-3">
          <input type="hidden" name="org" value={orgSlug} />
          <input type="hidden" name="id" value={productId} />
          <div>
            <label htmlFor="plato-foto" className={labelClass}>
              {currentUrl ? "Reemplazar la foto" : "Elegir una foto"}
            </label>
            <input
              id="plato-foto"
              name="photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              required
              onChange={onChange}
              className="mt-1 block min-h-11 w-full text-base file:mr-3 file:min-h-11 file:rounded-full file:border file:border-ink/40 file:bg-transparent file:px-4 file:text-base"
            />
          </div>
          {current?.preview ? (
            // Vista previa local (blob:): no pasa por el optimizador de imágenes.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current.preview} alt="Vista previa de la foto elegida" className="aspect-[4/3] w-full rounded-2xl border border-ink/15 object-cover" />
          ) : null}
          {busy ? <p className="text-sm text-muted">Preparando la foto…</p> : null}
          {current ? (
            <p role={current.note.error ? "alert" : undefined} className={`text-base ${current.note.error ? "font-medium text-danger" : "text-muted"}`}>
              {current.note.text}
            </p>
          ) : null}
          <div>
            <SubmitButton pendingLabel="Subiendo…">Guardar foto</SubmitButton>
          </div>
        </fieldset>
        {state.error ? (
          <p role="alert" className="mt-3 text-base font-medium text-danger">
            {state.error}
          </p>
        ) : null}
        {state.message ? (
          <p role="status" className="mt-3 text-base font-medium text-ink">
            {state.message}
          </p>
        ) : null}
      </form>

      {currentUrl ? (
        <ActionForm action={removePhotoAction} className="mt-3">
          <fieldset disabled={!canWrite}>
            <input type="hidden" name="org" value={orgSlug} />
            <input type="hidden" name="id" value={productId} />
            <SubmitButton className={dangerButtonClass} pendingLabel="Quitando…">
              Quitar la foto
            </SubmitButton>
          </fieldset>
        </ActionForm>
      ) : null}
    </div>
  );
}

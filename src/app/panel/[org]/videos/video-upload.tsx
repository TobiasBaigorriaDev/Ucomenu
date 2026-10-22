"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { inputClass, labelClass, primaryButtonClass } from "@/components/panel/styles";
import { durationProblem, FILE_PROBLEM_MESSAGE, validateVideoFile } from "@/lib/videos/archivo";
import { MAX_TITLE_LENGTH, parseTitle } from "@/lib/videos/estado";
import { discardVideoUploadAction, startVideoUploadAction } from "./actions";

type Product = { id: string; name: string };
type Phase = "idle" | "preparing" | "uploading";

/** Lee la duración con un `<video>` sin cargar el archivo entero. `null` si el navegador no puede (p. ej. HEVC en Chrome). */
function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const finish = (value: number | null) => {
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 4000);
    video.preload = "metadata";
    video.onloadedmetadata = () => finish(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => finish(null);
    video.src = url;
  });
}

/** Un solo `PUT` con el archivo a la URL firmada de Mux, con el avance. */
function putFile(url: string, file: File, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };
    request.onload = () => (request.status >= 200 && request.status < 300 ? resolve() : reject(new Error(`Mux respondió ${request.status}`)));
    request.onerror = () => reject(new Error("Se cortó la conexión."));
    request.onabort = () => reject(new Error("Se canceló la subida."));
    request.send(file);
  });
}

/**
 * Subir un video (ficha videos-mux-parte-b): nombre, plato opcional y archivo. El servidor crea el borrador y le pide a Mux la
 * URL de subida; el archivo viaja directo del navegador a Mux. Si la subida falla, se descarta el borrador para no dejar basura.
 * El servidor vuelve a comprobar todo (plan, cuenta, tope, duración): esta pantalla ayuda a no subir en vano.
 */
export function UploadVideoForm({
  orgSlug,
  products,
  enabled,
  notice,
}: {
  orgSlug: string;
  products: Product[];
  /** `false` si no se puede subir ahora (solo lectura, sin credenciales de Mux…): `notice` explica por qué. */
  enabled: boolean;
  notice: string | null;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const busy = phase !== "idle";

  // Cerrar la pestaña a mitad de subida la corta: se avisa.
  useEffect(() => {
    if (phase !== "uploading") return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !enabled) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get("title") ?? "");
    const product = String(data.get("product") ?? "");
    const file = fileInput.current?.files?.[0] ?? null;

    setError(null);
    setMessage(null);
    const parsed = parseTitle(title);
    if (!parsed.ok) return setError(parsed.problem === "blank" ? "Escribí un nombre para el video." : `El nombre puede tener hasta ${MAX_TITLE_LENGTH} caracteres.`);
    if (!file) return setError(FILE_PROBLEM_MESSAGE.empty);
    const problem = validateVideoFile(file);
    if (problem) return setError(FILE_PROBLEM_MESSAGE[problem]);

    setPhase("preparing");
    setProgress(0);
    const tooLong = durationProblem(await readDuration(file));
    if (tooLong) {
      setPhase("idle");
      return setError(FILE_PROBLEM_MESSAGE[tooLong]);
    }

    const started = await startVideoUploadAction({ org: orgSlug, title: parsed.title, product }).catch(() => null);
    if (!started || !started.ok) {
      setPhase("idle");
      router.refresh();
      return setError(started ? started.error : "No se pudo preparar la subida. Probá de nuevo en unos minutos.");
    }

    setPhase("uploading");
    try {
      await putFile(started.uploadUrl, file, setProgress);
    } catch {
      await discardVideoUploadAction({ org: orgSlug, id: started.videoId }).catch(() => undefined);
      setPhase("idle");
      router.refresh();
      return setError("La subida falló y no se guardó nada. Revisá tu conexión y probá de nuevo.");
    }

    setPhase("idle");
    form.reset();
    setMessage("Listo: el video se subió y se está procesando. Aparece como «Listo» en unos instantes.");
    router.refresh();
  }

  return (
    <section aria-labelledby="subir-video" className="panel-cell mt-6" data-testid="subir-video">
      <h2 id="subir-video" className="font-display text-2xl">
        Subir un video
      </h2>
      <p className="mt-1 max-w-prose text-base text-muted">
        Hasta 30 segundos y 50 MB, en formato MP4 o MOV. Mejor en vertical, como se mira en el teléfono.
      </p>
      {notice ? (
        <p className="mt-3 max-w-prose text-base font-medium" data-testid="subir-video-aviso">
          {notice}
        </p>
      ) : null}
      <form onSubmit={onSubmit} className="mt-4 grid gap-3 sm:max-w-xl" aria-busy={busy}>
        <fieldset disabled={!enabled || busy} className="grid min-w-0 gap-3">
          <div>
            <label htmlFor="subir-titulo" className={labelClass}>
              Nombre del video
            </label>
            <input id="subir-titulo" name="title" type="text" maxLength={MAX_TITLE_LENGTH} autoComplete="off" required className={`${inputClass} mt-1`} />
          </div>
          <div>
            <label htmlFor="subir-plato" className={labelClass}>
              Plato que muestra (opcional)
            </label>
            <select id="subir-plato" name="product" defaultValue="" className={`${inputClass} mt-1`}>
              <option value="">Ninguno</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="subir-archivo" className={labelClass}>
              Archivo de video
            </label>
            <input
              id="subir-archivo"
              ref={fileInput}
              type="file"
              accept="video/mp4,video/quicktime,video/*"
              required
              className={`${inputClass} mt-1 file:mr-3 file:rounded-full file:border-0 file:bg-sand file:px-3 file:py-1`}
            />
          </div>
          <div>
            <button type="submit" className={primaryButtonClass}>
              {phase === "preparing" ? "Preparando…" : phase === "uploading" ? "Subiendo…" : "Subir video"}
            </button>
          </div>
        </fieldset>
        {phase === "uploading" ? (
          <div role="status" data-testid="subida-progreso">
            <label htmlFor="subida-avance" className="block text-sm text-muted">
              Subiendo: {progress}%. No cierres esta página hasta que termine.
            </label>
            <progress id="subida-avance" max={100} value={progress} className="mt-1 h-3 w-full" />
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-base font-medium text-danger" data-testid="subida-error">
            {error}
          </p>
        ) : null}
        {message ? (
          <p role="status" className="text-base font-medium text-ink" data-testid="subida-ok">
            {message}
          </p>
        ) : null}
      </form>
    </section>
  );
}

/** Mientras haya videos subiendo o procesando, la lista se actualiza sola (el estado llega por el webhook de Mux). */
export function VideosAutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const interval = setInterval(() => router.refresh(), 4000);
    const stop = setTimeout(() => clearInterval(interval), 15 * 60 * 1000);
    return () => {
      clearInterval(interval);
      clearTimeout(stop);
    };
  }, [router]);
  return null;
}

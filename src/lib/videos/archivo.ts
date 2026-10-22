import { MAX_UPLOAD_BYTES, MAX_VIDEO_SECONDS } from "./estado";

/**
 * Validación del archivo en el NAVEGADOR (ficha videos-mux-parte-b). Es una ayuda para no subir en vano: la autoridad sobre la
 * duración es el servidor (que borra en Mux lo que pasa de 30,5 s) y el peso no se puede hacer cumplir en el servidor (Mux no lo
 * informa), así que esta es la única comprobación de los 50 MB.
 */

export type FileProblem = "empty" | "type" | "size" | "too_long";

export const FILE_PROBLEM_MESSAGE: Record<FileProblem, string> = {
  empty: "Elegí un archivo de video.",
  type: "Ese archivo no parece un video. Probá con uno en formato MP4 o MOV.",
  size: "El video pesa más de 50 MB. Probá con uno más corto o de menor calidad.",
  too_long: "El video dura más de 30 segundos. Recortalo y probá de nuevo.",
};

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "m4v", "webm", "3gp", "mkv"]);

/** Tipo y peso. Algunos teléfonos no informan el tipo: se mira también la extensión. */
export function validateVideoFile(file: { name: string; type: string; size: number }): FileProblem | null {
  if (!file.size) return "empty";
  const extension = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
  const looksLikeVideo = file.type.toLowerCase().startsWith("video/") || (file.type === "" && VIDEO_EXTENSIONS.has(extension));
  if (!looksLikeVideo) return "type";
  if (file.size > MAX_UPLOAD_BYTES) return "size";
  return null;
}

/** La duración que el navegador pudo leer (`null` si no pudo: se sube igual y decide el servidor). */
export function durationProblem(seconds: number | null): FileProblem | null {
  return seconds !== null && Number.isFinite(seconds) && seconds > MAX_VIDEO_SECONDS ? "too_long" : null;
}

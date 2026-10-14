/**
 * Fotos de los platos: tipo por los BYTES (no por el `Content-Type` ni la extensión que declara el
 * navegador), tope de tamaño y armado de la ruta y de la URL pública. Ver ficha gestion-de-carta.
 */

export const IMAGE_BUCKET = "product-images";
/** Coincide con `file_size_limit` del bucket (migración product_images). */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export type ImageKind = { ext: "jpg" | "png" | "webp"; mime: "image/jpeg" | "image/png" | "image/webp" };

/** Reconoce JPEG, PNG y WebP por su firma. Cualquier otra cosa (HTML, SVG, GIF…) devuelve `null`. */
export function detectImage(bytes: Uint8Array): ImageKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((byte, i) => bytes[i] === byte)) {
    return { ext: "png", mime: "image/png" };
  }
  // WebP: "RIFF" + tamaño (4 bytes) + "WEBP"
  const ascii = (from: number, text: string) => [...text].every((ch, i) => bytes[from + i] === ch.charCodeAt(0));
  if (bytes.length >= 12 && ascii(0, "RIFF") && ascii(8, "WEBP")) {
    return { ext: "webp", mime: "image/webp" };
  }
  return null;
}

export function imagePath(orgId: string, productId: string, ext: ImageKind["ext"]): string {
  return `${orgId}/${productId}/${crypto.randomUUID()}.${ext}`;
}

/** La ruta guardada tiene que ser de la carpeta de ESTE plato (lo mismo que exige el `check` de la base). */
export function isOwnImagePath(path: string, orgId: string, productId: string): boolean {
  const prefix = `${orgId}/${productId}/`;
  return (
    path.startsWith(prefix) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/.test(path.slice(prefix.length))
  );
}

/** URL pública de una foto (bucket público). Sin ruta, sin foto. */
export function imageUrl(path: string | null | undefined): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!path || !base) return null;
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/${IMAGE_BUCKET}/${path}`;
}
